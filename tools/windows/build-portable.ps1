[CmdletBinding()]
param(
    [ValidateSet("x64")]
    [string]$Architecture = "x64",
    [switch]$SkipUiBuild,
    [switch]$SkipSteamKitBuild,
    [switch]$SkipArchive,
    [switch]$UseInstalledDotnetRuntime,
    [switch]$BuildInstaller,
    [string]$IsccPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$RepoRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot "..\.."))
$BuildRoot = Join-Path $RepoRoot "build\windows-$Architecture"
$WorkDir = Join-Path $BuildRoot "work"
$StageDir = Join-Path $BuildRoot "WallHub"
$CacheDir = Join-Path $RepoRoot "build\windows-cache"
$DistDir = Join-Path $RepoRoot "dist"
$Versions = Get-Content (Join-Path $PSScriptRoot "runtime-versions.json") -Raw | ConvertFrom-Json
$Package = Get-Content (Join-Path $RepoRoot "package.json") -Raw | ConvertFrom-Json

function Write-Step([string]$Message) {
    Write-Host "`n==> $Message" -ForegroundColor Cyan
}

function Assert-ChildPath([string]$Path, [string]$Parent) {
    $fullPath = [IO.Path]::GetFullPath($Path).TrimEnd('\', '/')
    $fullParent = [IO.Path]::GetFullPath($Parent).TrimEnd('\', '/')
    if (-not $fullPath.StartsWith($fullParent + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Refusing to modify path outside $fullParent`: $fullPath"
    }
}

function Reset-Directory([string]$Path) {
    Assert-ChildPath $Path $BuildRoot
    if (Test-Path -LiteralPath $Path) {
        Remove-Item -LiteralPath $Path -Recurse -Force
    }
    New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Get-CachedFile([string]$Url, [string]$FileName) {
    New-Item -ItemType Directory -Path $CacheDir -Force | Out-Null
    $target = Join-Path $CacheDir $FileName
    if (-not (Test-Path -LiteralPath $target)) {
        Write-Host "Downloading $Url"
        $temporary = "$target.partial"
        if (Test-Path -LiteralPath $temporary) { Remove-Item -LiteralPath $temporary -Force }
        Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $temporary
        Move-Item -LiteralPath $temporary -Destination $target
    }
    return $target
}

function Invoke-Checked([string]$Executable, [string[]]$Arguments, [string]$WorkingDirectory = $RepoRoot) {
    Push-Location $WorkingDirectory
    try {
        & $Executable @Arguments
        if ($LASTEXITCODE -ne 0) {
            throw "$Executable exited with code $LASTEXITCODE"
        }
    }
    finally {
        Pop-Location
    }
}

function Write-Utf8NoBomFile([string]$Path, [string]$Content) {
    $encoding = [Text.UTF8Encoding]::new($false)
    [IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Get-Sha256([string]$Path) {
    $stream = [IO.File]::OpenRead($Path)
    try {
        $sha256 = [Security.Cryptography.SHA256]::Create()
        try {
            return ([BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "").ToLowerInvariant()
        }
        finally {
            $sha256.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function New-WallHubIcon([string]$Destination) {
    $svg = Get-Content (Join-Path $RepoRoot "public\favicon.svg") -Raw
    $match = [regex]::Match($svg, 'base64,([^"'']+)')
    if (-not $match.Success) { throw "public/favicon.svg does not contain an embedded PNG" }
    $base64 = [regex]::Replace($match.Groups[1].Value, '\s+', '')
    $png = [Convert]::FromBase64String($base64)
    $stream = [IO.File]::Open($Destination, [IO.FileMode]::Create, [IO.FileAccess]::Write)
    try {
        $writer = New-Object IO.BinaryWriter($stream)
        $writer.Write([UInt16]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]1)
        $writer.Write([Byte]128)
        $writer.Write([Byte]128)
        $writer.Write([Byte]0)
        $writer.Write([Byte]0)
        $writer.Write([UInt16]1)
        $writer.Write([UInt16]32)
        $writer.Write([UInt32]$png.Length)
        $writer.Write([UInt32]22)
        $writer.Write($png)
        $writer.Flush()
    }
    finally {
        $stream.Dispose()
    }
}

function Install-NodeRuntime {
    Write-Step "Preparing Node.js $($Versions.node)"
    $nodeArchiveName = "node-v$($Versions.node)-win-$Architecture.zip"
    $nodeArchive = Get-CachedFile "https://nodejs.org/dist/v$($Versions.node)/$nodeArchiveName" $nodeArchiveName
    $extractRoot = Join-Path $WorkDir "node-extract"
    Reset-Directory $extractRoot
    Expand-Archive -LiteralPath $nodeArchive -DestinationPath $extractRoot -Force
    $nodeDistribution = Get-ChildItem -LiteralPath $extractRoot -Directory | Select-Object -First 1
    if (-not $nodeDistribution) { throw "Node archive layout is invalid" }

    $runtimeDir = Join-Path $StageDir "runtime\node"
    New-Item -ItemType Directory -Path $runtimeDir -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $nodeDistribution.FullName "node.exe") -Destination $runtimeDir
    Copy-Item -LiteralPath (Join-Path $nodeDistribution.FullName "LICENSE") -Destination (Join-Path $runtimeDir "LICENSE.node.txt")
    return $nodeDistribution.FullName
}

function Install-PythonRuntime {
    Write-Step "Preparing embedded Python $($Versions.python) and MPKG modules"
    $pythonArchitecture = if ($Architecture -eq "x64") { "amd64" } else { "arm64" }
    $pythonArchiveName = "python-$($Versions.python)-embed-$pythonArchitecture.zip"
    $pythonArchive = Get-CachedFile "https://www.python.org/ftp/python/$($Versions.python)/$pythonArchiveName" $pythonArchiveName
    $pythonDir = Join-Path $StageDir "runtime\python"
    New-Item -ItemType Directory -Path $pythonDir -Force | Out-Null
    Expand-Archive -LiteralPath $pythonArchive -DestinationPath $pythonDir -Force

    $pth = Get-ChildItem -LiteralPath $pythonDir -Filter "python*._pth" | Select-Object -First 1
    if (-not $pth) { throw "Embedded Python _pth file is missing" }
    $pthLines = @(Get-Content -LiteralPath $pth.FullName)
    $updated = New-Object Collections.Generic.List[string]
    foreach ($line in $pthLines) {
        if ($line.Trim() -eq "#import site") { $updated.Add("import site") } else { $updated.Add($line) }
    }
    if (-not ($updated -contains "Lib\site-packages")) { $updated.Insert([Math]::Max(0, $updated.Count - 1), "Lib\site-packages") }
    Set-Content -LiteralPath $pth.FullName -Value $updated -Encoding ASCII

    $hostPython = (Get-Command python -ErrorAction Stop).Source
    $hostVersion = & $hostPython -c "import sys; print(f'{sys.version_info[0]}.{sys.version_info[1]}')"
    if ($LASTEXITCODE -ne 0 -or $hostVersion.Trim() -ne "3.11") {
        throw "Building the embedded MPKG environment requires a host Python 3.11 interpreter"
    }
    $sitePackages = Join-Path $pythonDir "Lib\site-packages"
    New-Item -ItemType Directory -Path $sitePackages -Force | Out-Null
    Invoke-Checked $hostPython @(
        "-m", "pip", "install",
        "--disable-pip-version-check", "--no-cache-dir", "--no-compile", "--ignore-installed", "--no-warn-conflicts", "--only-binary=:all:",
        "--target", $sitePackages,
        "-r", (Join-Path $RepoRoot "tools\mpkg\requirements.txt")
    )

    $probe = "from PIL import Image; import lz4.block,etcpak,texture2ddecoder; assert callable(getattr(etcpak,'compress_etc2_rgba',None)); assert callable(getattr(texture2ddecoder,'decode_bc3',None)); print('ok')"
    Invoke-Checked (Join-Path $pythonDir "python.exe") @("-c", $probe) $StageDir
}

function Copy-InstalledDotnetRuntime([string]$Destination) {
    $dotnetCommand = (Get-Command dotnet -ErrorAction Stop).Source
    $dotnetRoot = Split-Path $dotnetCommand -Parent
    $runtimeVersion = [string]$Versions.dotnetRuntime
    $required = @(
        (Join-Path $dotnetRoot "host\fxr\$runtimeVersion"),
        (Join-Path $dotnetRoot "shared\Microsoft.NETCore.App\$runtimeVersion"),
        (Join-Path $dotnetRoot "shared\Microsoft.WindowsDesktop.App\$runtimeVersion")
    )
    foreach ($path in $required) {
        if (-not (Test-Path -LiteralPath $path)) { throw "Installed .NET runtime component is missing: $path" }
    }

    New-Item -ItemType Directory -Path (Join-Path $Destination "host\fxr") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $Destination "shared\Microsoft.NETCore.App") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $Destination "shared\Microsoft.WindowsDesktop.App") -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $dotnetRoot "dotnet.exe") -Destination $Destination
    foreach ($name in @("LICENSE.txt", "ThirdPartyNotices.txt")) {
        $source = Join-Path $dotnetRoot $name
        if (Test-Path -LiteralPath $source) { Copy-Item -LiteralPath $source -Destination $Destination }
    }
    Copy-Item -LiteralPath $required[0] -Destination (Join-Path $Destination "host\fxr") -Recurse
    Copy-Item -LiteralPath $required[1] -Destination (Join-Path $Destination "shared\Microsoft.NETCore.App") -Recurse
    Copy-Item -LiteralPath $required[2] -Destination (Join-Path $Destination "shared\Microsoft.WindowsDesktop.App") -Recurse
}

function Install-DotnetRuntime {
    Write-Step "Preparing .NET Desktop Runtime $($Versions.dotnetRuntime)"
    $dotnetDir = Join-Path $StageDir "runtime\dotnet"
    New-Item -ItemType Directory -Path $dotnetDir -Force | Out-Null
    if ($UseInstalledDotnetRuntime) {
        Copy-InstalledDotnetRuntime $dotnetDir
    }
    else {
        $installScript = Get-CachedFile "https://dot.net/v1/dotnet-install.ps1" "dotnet-install.ps1"
        & $installScript -Runtime dotnet -Version ([string]$Versions.dotnetRuntime) -Architecture $Architecture -InstallDir $dotnetDir -NoPath
        if ($LASTEXITCODE -ne 0) { throw "dotnet-install.ps1 core runtime install exited with code $LASTEXITCODE" }
        & $installScript -Runtime windowsdesktop -Version ([string]$Versions.dotnetRuntime) -Architecture $Architecture -InstallDir $dotnetDir -NoPath
        if ($LASTEXITCODE -ne 0) { throw "dotnet-install.ps1 desktop runtime install exited with code $LASTEXITCODE" }
    }
    $runtimeList = & (Join-Path $dotnetDir "dotnet.exe") --list-runtimes
    if ($LASTEXITCODE -ne 0 -or -not ($runtimeList -match "Microsoft\.NETCore\.App 9\.")) {
        throw "Bundled .NET 9 runtime validation failed"
    }
}

function Copy-ApplicationSources {
    Write-Step "Copying clean WallHub application sources"
    foreach ($file in @("server.js", "package.json", "package-lock.json", "LICENSE", "README.md")) {
        Copy-Item -LiteralPath (Join-Path $RepoRoot $file) -Destination $StageDir
    }
    Copy-Item -LiteralPath (Join-Path $RepoRoot "src") -Destination (Join-Path $StageDir "src") -Recurse
    Get-ChildItem -LiteralPath (Join-Path $StageDir "src") -Filter "*.test.js" -Recurse -File | Remove-Item -Force
    $mpkgDir = Join-Path $StageDir "tools\mpkg"
    New-Item -ItemType Directory -Path $mpkgDir -Force | Out-Null
    foreach ($file in @("mobile_mpkg.py", "wallpaper_engine_toolkit.py", "requirements.txt")) {
        Copy-Item -LiteralPath (Join-Path $RepoRoot "tools\mpkg\$file") -Destination $mpkgDir
    }
    $updateDir = Join-Path $StageDir "tools\update"
    New-Item -ItemType Directory -Path $updateDir -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $RepoRoot "tools\update\apply-update.js") -Destination $updateDir
    Copy-Item -LiteralPath (Join-Path $PSScriptRoot "PORTABLE-README.zh-CN.txt") -Destination (Join-Path $StageDir "README-Windows.txt")
}

function Build-UserInterface([string]$NodeDistribution) {
    Write-Step "Building the React user interface"
    $node = Join-Path $NodeDistribution "node.exe"
    $npm = Join-Path $NodeDistribution "npm.cmd"
    if (-not $SkipUiBuild) {
        if (-not (Test-Path -LiteralPath (Join-Path $RepoRoot "node_modules\vite\bin\vite.js"))) {
            Invoke-Checked $npm @("ci", "--no-audit", "--no-fund") $RepoRoot
        }
        $publicDir = Join-Path $StageDir "public"
        Invoke-Checked $node @(
            (Join-Path $RepoRoot "node_modules\vite\bin\vite.js"),
            "build", "--outDir", $publicDir, "--emptyOutDir"
        ) $RepoRoot
    }
    else {
        Copy-Item -LiteralPath (Join-Path $RepoRoot "public") -Destination (Join-Path $StageDir "public") -Recurse
    }
}

function Install-ProductionNodeModules([string]$NodeDistribution) {
    Write-Step "Installing production Node dependencies"
    $npm = Join-Path $NodeDistribution "npm.cmd"
    $npmCache = Join-Path $CacheDir "npm"
    New-Item -ItemType Directory -Path $npmCache -Force | Out-Null
    $oldPath = $env:PATH
    try {
        $env:PATH = "$NodeDistribution;$oldPath"
        Invoke-Checked $npm @(
            "ci", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund",
            "--cache", $npmCache
        ) $StageDir
    }
    finally {
        $env:PATH = $oldPath
    }
    $productionPackagePath = Join-Path $StageDir "package.json"
    $productionPackage = Get-Content -LiteralPath $productionPackagePath -Raw | ConvertFrom-Json
    $productionPackage.scripts = [ordered]@{
        start = "node server.js"
        "start:nsfw" = "node server.js --NSFW"
    }
    $productionPackage.PSObject.Properties.Remove("devDependencies")
    $productionPackage | ConvertTo-Json -Depth 20 | Set-Content -LiteralPath $productionPackagePath -Encoding UTF8
}

function Build-SteamKitRuntimes([string]$NodeDistribution) {
    Write-Step "Preparing the two patched SteamKit runtimes"
    $steamBuildRoot = Join-Path $WorkDir "SteamKit"
    if ($SkipSteamKitBuild) {
        foreach ($name in @("DepotDownloader", "DepotDownloaderStream")) {
            $source = Join-Path $RepoRoot "SteamKit\$name"
            if (-not (Test-Path -LiteralPath (Join-Path $source "DepotDownloader.exe"))) {
                throw "-SkipSteamKitBuild requires an existing $source runtime"
            }
            New-Item -ItemType Directory -Path $steamBuildRoot -Force | Out-Null
            Copy-Item -LiteralPath $source -Destination $steamBuildRoot -Recurse
        }
    }
    else {
        New-Item -ItemType Directory -Path $steamBuildRoot -Force | Out-Null
        $saved = @{}
        foreach ($name in @("STEAMKIT_DIR", "DEPOTDOWNLOADER_CONFIG_DIR", "WALLHUB_DEPOT_DOTNET_CLI_HOME")) {
            $saved[$name] = [Environment]::GetEnvironmentVariable($name)
        }
        try {
            $env:STEAMKIT_DIR = $steamBuildRoot
            $env:DEPOTDOWNLOADER_CONFIG_DIR = Join-Path $steamBuildRoot "account"
            $env:WALLHUB_DEPOT_DOTNET_CLI_HOME = Join-Path $steamBuildRoot "dotnet-home"
            Invoke-Checked (Join-Path $NodeDistribution "node.exe") @(
                (Join-Path $StageDir "server.js"), "--build-depot-runtime"
            ) $StageDir
        }
        finally {
            foreach ($name in $saved.Keys) {
                if ($null -eq $saved[$name]) { Remove-Item "Env:$name" -ErrorAction SilentlyContinue }
                else { [Environment]::SetEnvironmentVariable($name, [string]$saved[$name]) }
            }
        }
    }

    $steamStage = Join-Path $StageDir "SteamKit"
    New-Item -ItemType Directory -Path $steamStage -Force | Out-Null
    foreach ($name in @("DepotDownloader", "DepotDownloaderStream")) {
        Copy-Item -LiteralPath (Join-Path $steamBuildRoot $name) -Destination $steamStage -Recurse
    }
    Get-ChildItem -LiteralPath $steamStage -Filter "*.pdb" -Recurse -File | Remove-Item -Force

    $stampRows = @(
        @{ File = "DepotDownloader\.wallhub-json-progress-build.json"; Executable = "SteamKit\DepotDownloader\DepotDownloader.exe" },
        @{ File = "DepotDownloaderStream\.wallhub-stream-build.json"; Executable = "SteamKit\DepotDownloaderStream\DepotDownloader.exe" }
    )
    foreach ($row in $stampRows) {
        $stampPath = Join-Path $steamStage $row.File
        $stamp = Get-Content -LiteralPath $stampPath -Raw | ConvertFrom-Json
        $stamp.executablePath = $row.Executable
        Write-Utf8NoBomFile $stampPath ($stamp | ConvertTo-Json -Depth 8)
    }
    $settings = Join-Path $StageDir "cache-settings.json"
    if (Test-Path -LiteralPath $settings) { Remove-Item -LiteralPath $settings -Force }
    $nugetBuildCache = Join-Path $StageDir "NuGet"
    if (Test-Path -LiteralPath $nugetBuildCache) {
        Assert-ChildPath $nugetBuildCache $StageDir
        Remove-Item -LiteralPath $nugetBuildCache -Recurse -Force
    }
}

function Test-SteamKitRuntimeStamps([string]$NodeDistribution) {
    Write-Step "Validating packaged SteamKit runtime stamps"
    $node = Join-Path $NodeDistribution "node.exe"
    $probe = @'
const fs = require('fs');
const path = require('path');
const root = process.argv[1];
const rows = [
  ['SteamKit/DepotDownloader/.wallhub-json-progress-build.json', 'wallhub-json-progress-v36-user-files-bridge-only'],
  ['SteamKit/DepotDownloaderStream/.wallhub-stream-build.json', 'wallhub-stream-v37-cancellable-ranges'],
];
for (const [relativeStamp, expectedPatch] of rows) {
  const stampPath = path.join(root, ...relativeStamp.split('/'));
  const bytes = fs.readFileSync(stampPath);
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    throw new Error(`${relativeStamp} contains a UTF-8 BOM`);
  }
  const stamp = JSON.parse(bytes.toString('utf8'));
  if (stamp.patchVersion !== expectedPatch) {
    throw new Error(`${relativeStamp} has patch ${stamp.patchVersion || '<missing>'}`);
  }
  const executable = path.resolve(root, stamp.executablePath || '');
  if (!stamp.executablePath || !fs.existsSync(executable)) {
    throw new Error(`${relativeStamp} points to a missing executable`);
  }
}
console.log('SteamKit runtime stamps: ok');
'@
    Invoke-Checked $node @("-e", $probe, $StageDir) $RepoRoot
}

function Build-Launcher([string]$IconPath) {
    Write-Step "Building WallHub.exe"
    $launcherOutput = Join-Path $WorkDir "launcher"
    Reset-Directory $launcherOutput
    $project = Join-Path $PSScriptRoot "WallHub.Launcher\WallHub.Launcher.csproj"
    Invoke-Checked "dotnet" @(
        "publish", $project,
        "-c", "Release",
        "-r", "win-$Architecture",
        "--self-contained", "false",
        "-p:Version=$($Package.version)",
        "-p:ApplicationIcon=$IconPath",
        "-p:PublishReadyToRun=false",
        "-o", $launcherOutput
    ) $RepoRoot
    Copy-Item -Path (Join-Path $launcherOutput "*") -Destination $StageDir -Recurse -Force
    if (-not (Test-Path -LiteralPath (Join-Path $StageDir "WallHub.exe"))) {
        throw "WallHub.exe was not produced"
    }
}

function Write-PortableManifest {
    $manifest = [ordered]@{
        name = "WallHub"
        version = [string]$Package.version
        architecture = "win-$Architecture"
        builtAt = [DateTime]::UtcNow.ToString("o")
        runtimes = [ordered]@{
            node = [string]$Versions.node
            python = [string]$Versions.python
            dotnet = [string]$Versions.dotnetRuntime
        }
        dataLayout = "project-root"
    }
    $manifest | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $StageDir "portable-manifest.json") -Encoding UTF8
}

function Find-Iscc {
    if ($IsccPath) { return $IsccPath }
    $command = Get-Command ISCC.exe -ErrorAction SilentlyContinue
    if ($command) { return $command.Source }
    foreach ($candidate in @(
        "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
        "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
        "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
    )) {
        if ($candidate -and (Test-Path -LiteralPath $candidate)) { return $candidate }
    }
    throw "Inno Setup 6 was not found. Install JRSoftware.InnoSetup or pass -IsccPath."
}

function Build-Setup([string]$IconPath) {
    Write-Step "Building the graphical Windows installer"
    $iscc = Find-Iscc
    $chineseMessages = Get-CachedFile `
        "https://raw.githubusercontent.com/jrsoftware/issrc/main/Files/Languages/ChineseSimplified.isl" `
        "ChineseSimplified.isl"
    Invoke-Checked $iscc @(
        "/DSourceDir=$StageDir",
        "/DOutputDir=$DistDir",
        "/DAppVersion=$($Package.version)",
        "/DArchitecture=$Architecture",
        "/DSetupIcon=$IconPath",
        "/DChineseMessages=$chineseMessages",
        (Join-Path $PSScriptRoot "WallHub.iss")
    ) $RepoRoot
    $setup = Join-Path $DistDir "WallHub-Setup-win-$Architecture.exe"
    if (-not (Test-Path -LiteralPath $setup)) { throw "The Windows installer was not produced: $setup" }
    $hash = Get-Sha256 $setup
    "$hash  $([IO.Path]::GetFileName($setup))" | Set-Content -LiteralPath "$setup.sha256" -Encoding ASCII
    Write-Host "Installer: $setup"
    Write-Host "SHA-256: $hash"
}

Write-Step "Initializing clean Windows package directories"
New-Item -ItemType Directory -Path $BuildRoot -Force | Out-Null
Reset-Directory $WorkDir
Reset-Directory $StageDir
New-Item -ItemType Directory -Path $DistDir -Force | Out-Null

$iconPath = Join-Path $WorkDir "WallHub.ico"
New-WallHubIcon $iconPath
$nodeDistribution = Install-NodeRuntime
Copy-ApplicationSources
Build-UserInterface $nodeDistribution
Install-ProductionNodeModules $nodeDistribution
Install-PythonRuntime
Install-DotnetRuntime
Build-SteamKitRuntimes $nodeDistribution
Test-SteamKitRuntimeStamps $nodeDistribution
Build-Launcher $iconPath
Write-PortableManifest

if (-not $SkipArchive) {
    Write-Step "Creating Portable ZIP"
    $archive = Join-Path $DistDir "WallHub-Portable-win-$Architecture.zip"
    if (Test-Path -LiteralPath $archive) { Remove-Item -LiteralPath $archive -Force }
    Compress-Archive -Path (Join-Path $StageDir '*') -DestinationPath $archive -CompressionLevel Optimal
    $hash = Get-Sha256 $archive
    "$hash  $([IO.Path]::GetFileName($archive))" | Set-Content -LiteralPath "$archive.sha256" -Encoding ASCII
    Write-Host "Portable archive: $archive"
    Write-Host "SHA-256: $hash"
}

if ($BuildInstaller) { Build-Setup $iconPath }

Write-Step "Windows package completed"
Write-Host "Portable directory: $StageDir"
