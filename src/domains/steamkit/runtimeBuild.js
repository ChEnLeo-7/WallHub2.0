'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const depotTools = require('./depotTools');
const { createDepotRuntimePaths } = require('./depotRuntimePaths');
const dotnetRuntime = require('./dotnetRuntime');
const githubSource = require('./githubSource');
const depotPatch = require('./depotPatch');

function createSteamKitRuntimeBuildService(deps) {
  const {
    env = process.env,
    logger = console,
    STEAMKIT_ROOT,
    STEAMKIT_CONFIG_DIR,
    DOWNLOADS_DIR,
    DEPOT_DOWNLOADER_DIR,
    DEPOT_STREAM_DOWNLOADER_DIR,
    DEPOT_JSON_PROGRESS_DIR,
    DEPOT_JSON_PROGRESS_SOURCE_ZIP,
    DEPOT_JSON_PROGRESS_PATCH_VERSION,
    DEPOT_STREAM_PATCH_VERSION,
    DEPOT_CONFIG_DIR,
    DEPOT_HOME_DIR,
    DEPOT_DOTNET_CLI_HOME_DIR,
    DEPOT_XDG_DATA_HOME_DIR,
    DEPOT_XDG_CONFIG_HOME_DIR,
    DEPOT_LOCALAPPDATA_DIR,
    DEPOT_APPDATA_DIR,
    GITHUB_ACCELERATOR_MODE,
    UA,
    GET,
    ensureDir,
    runProcess,
    psQuote,
    updateRuntimeSetup,
    runtimeSetupSnapshot,
    effectiveDownloaderMode,
    startupDownloaderMode,
    ensureSteamConfigDir,
    reconcileCachedSteamLogin,
    VIDEO_CACHE_SETTINGS,
    getVideoCacheSettings,
    makeSteamKitJsonProgressRequiredError,
    isTermuxLikeEnv,
    isAndroidHostLikeEnv,
    shouldRejectDepotAppHostForAndroid,
  } = deps;

  function videoCacheSettings() {
    return typeof getVideoCacheSettings === 'function'
      ? (getVideoCacheSettings() || {})
      : (VIDEO_CACHE_SETTINGS || {});
  }

  if (typeof ensureDir !== 'function') throw new Error('ensureDir is required');
  if (typeof runProcess !== 'function') throw new Error('runProcess is required');
  if (typeof updateRuntimeSetup !== 'function') throw new Error('updateRuntimeSetup is required');

  const depotRuntimePaths = createDepotRuntimePaths({
    isTermuxLikeEnv,
    isAndroidHostLikeEnv,
    logger,
  });

  let DEPOT_JSON_PROGRESS_INSTALL_PROMISE = null;
  let DEPOT_STREAM_INSTALL_PROMISE = null;
  let DEPOT_JSON_PROGRESS_LOGGED_UNAVAILABLE = false;
  const DEPOT_EXECUTABLE_START_CHECKS = new Set();
  let STARTUP_PREPARE_PROMISE = null;
  let DEPOT_DOTNET_ENV_LOGGED = false;
  let GOOGLE_REACHABILITY_PROMISE = null;

function googlePingArgs() {
  const host = 'www.google.com';
  if (process.platform === 'win32') return ['-n', '1', '-w', '2000', host];
  if (process.platform === 'darwin') return ['-c', '1', '-W', '2000', host];
  return ['-c', '1', '-W', '2', host];
}

async function checkGoogleReachability() {
  if (GOOGLE_REACHABILITY_PROMISE) return GOOGLE_REACHABILITY_PROMISE;

  GOOGLE_REACHABILITY_PROMISE = (async () => {
    try {
      logger.log('[GitHub] Pinging www.google.com before selecting a DepotDownloader source route');
      await runProcess('ping', googlePingArgs(), 5000);
      logger.log('[GitHub] Google ping succeeded');
      return true;
    } catch (error) {
      logger.warn(`[GitHub] Google ping failed; using GitHub accelerator: ${error.message || error}`);
      return false;
    }
  })();

  return GOOGLE_REACHABILITY_PROMISE;
}

function prepareRuntimeOnStartup() {
  if (STARTUP_PREPARE_PROMISE) return STARTUP_PREPARE_PROMISE;
  const mode = 'steamkit';
  STARTUP_PREPARE_PROMISE = (async () => {
    cleanupLegacyDepotJsonProgressDir();
    updateRuntimeSetup({
      mode,
      requestedMode: 'steamkit',
      status: 'checking',
      progress: 5,
      message: '正在检查 SteamKit 运行文件',
      runnerDir: STEAMKIT_ROOT,
      downloadsDir: DOWNLOADS_DIR,
      error: ''
    });
    ensureSteamConfigDir();
    try {
      const executable = await ensureDepotDownloaderReady();
      updateRuntimeSetup({
        mode,
        status: 'ready',
        progress: 100,
        message: 'SteamKit JSON 真实进度下载器已就绪',
        executablePath: executable,
        runnerDir: STEAMKIT_ROOT,
        downloadsDir: DOWNLOADS_DIR,
        error: ''
      });
      if (env.WALLHUB_VALIDATE_STEAM_LOGIN_ON_STARTUP === '1') {
        await reconcileCachedSteamLogin(mode);
      }
      warmupDepotStreamDownloader('startup');
    } catch (error) {
      const errMsg = error.message || String(error);
      updateRuntimeSetup({
        mode,
        status: 'error',
        progress: 0,
        message: errMsg || '运行文件准备失败',
        error: errMsg,
        runnerDir: STEAMKIT_ROOT,
        downloadsDir: DOWNLOADS_DIR
      });
      logger.warn('[Runtime] Startup preparation failed:', errMsg);
    }
  })();
  return STARTUP_PREPARE_PROMISE;
}

async function waitForStartupPreparationForDownload(task) {
  const promise = STARTUP_PREPARE_PROMISE || prepareRuntimeOnStartup();
  if (!promise) return;
  const setup = runtimeSetupSnapshot();
  if (task && ['checking', 'installing', 'validating-login', 'idle'].includes(String(setup.status || ''))) {
    task.progressIndeterminate = true;
    task.progressStage = '正在等待运行文件和 Steam 登录会话准备完成';
    task.speed = 0;
  }
  try {
    await promise;
  } catch {
    // prepareRuntimeOnStartup already records the failure in runtime setup.
  }
}

function commandExists(command) {
  const name = String(command || '').trim();
  if (!name) return '';
  const isWin = process.platform === 'win32';
  const hasPathSep = name.includes('/') || name.includes('\\');
  const pathExts = isWin
    ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM')
        .split(';')
        .map(s => s.trim())
        .filter(Boolean)
    : [''];
  const candidates = [];
  const addCandidate = (base) => {
    if (!base) return;
    candidates.push(base);
    if (isWin && !path.extname(base)) {
      pathExts.forEach(ext => candidates.push(base + ext));
    }
  };

  if (hasPathSep) {
    addCandidate(name);
  } else {
    String(env.PATH || '')
      .split(path.delimiter)
      .map(s => s.trim())
      .filter(Boolean)
      .forEach(dir => addCandidate(path.join(dir, name)));
  }
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
    } catch {}
  }

  try {
    const shQuote = (v) => `'${String(v).replace(/'/g, `'\\''`)}'`;
    const finder = isWin ? 'where.exe' : 'sh';
    const args = isWin
      ? [name]
      : ['-lc', `command -v ${shQuote(name)}`];
    const out = execFileSync(finder, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return String(out || '').split(/\r?\n/).map(s => s.trim()).find(Boolean) || '';
  } catch {
    return '';
  }
}

function pathLooksExecutable(p) {
  return depotRuntimePaths.pathLooksExecutable(p);
}

function depotExecutableNames() {
  return depotRuntimePaths.depotExecutableNames();
}

function resolveDepotDownloaderPath() {
  return depotRuntimePaths.resolveDepotDownloaderPath({
    directPath: env.DEPOTDOWNLOADER_PATH,
    downloaderDir: DEPOT_DOWNLOADER_DIR
  });
}

function cleanupLegacyDepotJsonProgressDir() {
  const legacyDir = path.join(STEAMKIT_ROOT, 'DepotDownloaderJsonProgress');
  if (path.resolve(legacyDir) === path.resolve(DEPOT_DOWNLOADER_DIR)) return;
  if (!fs.existsSync(legacyDir)) return;
  try {
    fs.rmSync(legacyDir, { recursive: true, force: true });
    logger.log(`[SteamKit] Removed legacy JSON progress runtime directory: ${legacyDir}`);
  } catch (e) {
    logger.warn('[SteamKit] Failed to remove legacy JSON progress runtime:', e.message);
  }
}

function resolveDepotRuntimePath(runtimeDir, directPath, options = {}) {
  return depotRuntimePaths.resolveDepotRuntimePath(runtimeDir, directPath, options);
}

function resolveDepotJsonProgressDownloaderPath(options = {}) {
  return resolveDepotRuntimePath(
    DEPOT_JSON_PROGRESS_DIR,
    env.WALLHUB_DEPOT_JSON_PROGRESS_PATH,
    Object.assign({
      stampPath: depotJsonProgressStampPath(),
      patchVersion: DEPOT_JSON_PROGRESS_PATCH_VERSION
    }, options)
  );
}

function resolveDepotStreamDownloaderPath(options = {}) {
  return resolveDepotRuntimePath(
    DEPOT_STREAM_DOWNLOADER_DIR,
    env.WALLHUB_DEPOT_STREAM_PATH,
    Object.assign({
      stampPath: depotStreamStampPath(),
      patchVersion: DEPOT_STREAM_PATCH_VERSION
    }, options)
  );
}

function findDepotDownloaderRecursive(root) {
  return depotRuntimePaths.findDepotDownloaderRecursive(root);
}

function parseCsvEnv(name) {
  return githubSource.parseCsvEnv(env, name);
}

function isGithubDownloadUrl(url) {
  return githubSource.isGithubDownloadUrl(url);
}

function buildGithubProxyUrl(proxy, url) {
  return githubSource.buildGithubProxyUrl(proxy, url);
}

function githubProxyCandidates(url) {
  return githubSource.githubProxyCandidates(url, {
    env: env,
    acceleratorMode: GITHUB_ACCELERATOR_MODE
  });
}

async function chooseGithubDownloadRoutes(url) {
  return githubSource.chooseGithubDownloadRoutes(url, {
    env: env,
    acceleratorMode: GITHUB_ACCELERATOR_MODE,
    logger,
    checkGoogleReachability,
  });
}

async function downloadFileBuffer(url, dest) {
  return githubSource.downloadFileBuffer(url, dest, {
    env: env,
    acceleratorMode: GITHUB_ACCELERATOR_MODE,
    logger,
    GET,
    userAgent: UA,
    timeoutMs: 120000,
    checkGoogleReachability,
  });
}

async function downloadGithubRouteToFile(routes, dest) {
  return githubSource.downloadGithubRouteToFile(routes, dest, {
    logger,
    GET,
    userAgent: UA,
    timeoutMs: 120000
  });
}

function looksLikeZipBuffer(buf) {
  return githubSource.looksLikeZipBuffer(buf);
}

function parseVersionParts(version) {
  return depotTools.parseVersionParts(version);
}

function formatMajorMinor(version) {
  return depotTools.formatMajorMinor(version);
}

function findDepotRuntimeConfig(executable) {
  return depotRuntimePaths.findDepotRuntimeConfig(executable);
}

function getDepotRequiredDotnetVersion(executable) {
  return depotRuntimePaths.getDepotRequiredDotnetVersion(executable);
}

function getInstalledDotnetRuntimeVersions(dotnetCommand) {
  return dotnetRuntime.getInstalledDotnetRuntimeVersions(dotnetCommand);
}

function resolveDotnetRoot(dotnetCommand) {
  return dotnetRuntime.resolveDotnetRoot({
    env: env,
    dotnetCommand,
    commandExists
  });
}

function getInstalledDotnetSdkVersions(dotnetCommand) {
  return dotnetRuntime.getInstalledDotnetSdkVersions(dotnetCommand);
}

function dotnetRuntimeSatisfies(required, installedVersions) {
  return depotTools.dotnetRuntimeSatisfies(required, installedVersions);
}

function dotnetMajorInstalled(installedVersions, major) {
  return depotTools.dotnetMajorInstalled(installedVersions, major);
}

function dotnet9InstallMessage(reason, details = {}) {
  const runtimes = details.runtimes && details.runtimes.length ? ` 当前 Runtime: ${details.runtimes.join(', ')}。` : '';
  const sdks = details.sdks && details.sdks.length ? ` 当前 SDK: ${details.sdks.join(', ')}。` : '';
  if (isTermuxLikeEnv()) {
    return `${reason}${runtimes}${sdks}Termux 请安装 .NET 9 SDK/Runtime 后重启服务；可先尝试: pkg update && pkg install dotnet-sdk-9.0 dotnet-runtime-9.0。`;
  }
  if (process.platform === 'linux') {
    return `${reason}${runtimes}${sdks}Linux 请安装 .NET 9 SDK/Runtime 后重启服务，例如 Ubuntu/Debian: sudo apt install dotnet-sdk-9.0 dotnet-runtime-9.0。`;
  }
  if (process.platform === 'win32') {
    return `${reason}${runtimes}${sdks}Windows 请安装 .NET 9 SDK 和 .NET 9 Runtime 后重启服务，可使用 winget install Microsoft.DotNet.SDK.9。`;
  }
  return `${reason}${runtimes}${sdks}请安装 .NET 9 SDK/Runtime 后重启服务。`;
}

function assertDotnet9BuildEnvironment() {
  const dotnet = commandExists('dotnet');
  if (!dotnet) {
    throw new Error(dotnet9InstallMessage('未检测到 dotnet 命令。'));
  }
  const runtimes = getInstalledDotnetRuntimeVersions(dotnet);
  const sdks = getInstalledDotnetSdkVersions(dotnet);
  const hasRuntime9 = dotnetMajorInstalled(runtimes, 9);
  const hasSdk9 = dotnetMajorInstalled(sdks, 9);
  if (!hasRuntime9 || !hasSdk9) {
    const missing = [
      hasSdk9 ? '' : '.NET 9 SDK',
      hasRuntime9 ? '' : '.NET 9 Runtime'
    ].filter(Boolean).join(' 和 ');
    throw new Error(dotnet9InstallMessage(`SteamKit JSON 真实进度下载器需要 ${missing}。`, { runtimes, sdks }));
  }
  return dotnet;
}

function buildDepotDotnetBuildEnv() {
  const buildEnv = Object.assign({}, buildDepotDotnetEnv(), {
    DOTNET_CLI_TELEMETRY_OPTOUT: '1',
    DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
    DOTNET_NOLOGO: '1',
    NUGET_XMLDOC_MODE: 'skip'
  });
  if (isTermuxLikeEnv() || isAndroidHostLikeEnv()) {
    buildEnv.DOTNET_MULTILEVEL_LOOKUP = buildEnv.DOTNET_MULTILEVEL_LOOKUP || '0';
    buildEnv.MSBUILDDISABLENODEREUSE = buildEnv.MSBUILDDISABLENODEREUSE || '1';
    buildEnv.DOTNET_CLI_USE_MSBUILD_SERVER = buildEnv.DOTNET_CLI_USE_MSBUILD_SERVER || '0';
    buildEnv.DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE = buildEnv.DOTNET_CLI_WORKLOAD_UPDATE_NOTIFY_DISABLE || '1';
    buildEnv.DOTNET_SYSTEM_NET_SOCKETS_INLINE_COMPLETIONS = buildEnv.DOTNET_SYSTEM_NET_SOCKETS_INLINE_COMPLETIONS || '1';
    buildEnv.DOTNET_SYSTEM_NET_SOCKETS_THREAD_COUNT = buildEnv.DOTNET_SYSTEM_NET_SOCKETS_THREAD_COUNT || '1';
  }
  const dotnetRoot = resolveDotnetRoot();
  if (dotnetRoot) {
    buildEnv.DOTNET_ROOT = buildEnv.DOTNET_ROOT || dotnetRoot;
    buildEnv.DOTNET_ROOT_ARM64 = buildEnv.DOTNET_ROOT_ARM64 || dotnetRoot;
  }
  return buildEnv;
}

async function warmupDotnetForDepotBuild(dotnet, buildEnv) {
  if (!dotnet || String(env.WALLHUB_DOTNET_WARMUP || '1').trim() === '0') return;
  if (!isTermuxLikeEnv() && !isAndroidHostLikeEnv()) return;
  try {
    updateRuntimeSetup({
      mode: 'steamkit',
      status: 'installing',
      progress: 78,
      message: '正在预热 Termux .NET 运行环境',
      runnerDir: STEAMKIT_ROOT
    });
    await runProcess(dotnet, ['--info'], 60000, { env: buildEnv });
  } catch (e) {
    logger.warn(`[SteamKit] .NET warmup failed, continuing build: ${e.message}`);
  }
}

function buildDepotPublishArgs(projectPath, runtimeDir) {
  const androidLike = isTermuxLikeEnv() || isAndroidHostLikeEnv();
  const args = [
    'publish',
    projectPath,
    '-c', 'Release',
    '-o', runtimeDir,
    '--self-contained', 'false',
    `-p:UseAppHost=${androidLike ? 'false' : 'true'}`,
  ];
  if (androidLike) {
    args.push(
      '--disable-build-servers',
      '-p:UseSharedCompilation=false',
      '-p:BuildInParallel=false',
      '-p:RunAnalyzersDuringBuild=false',
      '-p:RunAnalyzersDuringLiveAnalysis=false',
      '-nodeReuse:false',
      '-m:1'
    );
  }
  return args;
}

function depotDotnetMissingMessage(requiredVersion, installedVersions) {
  const required = requiredVersion || '9.0.0';
  const packageName = `dotnet-runtime-${formatMajorMinor(required)}`;
  const found = (installedVersions && installedVersions.length)
    ? ` 当前检测到: ${installedVersions.join(', ')}。`
    : '';
  if (isTermuxLikeEnv()) {
    return `DepotDownloader 已下载，但需要 .NET ${formatMajorMinor(required)} 运行时。${found}Termux 请执行: pkg update && pkg install ${packageName}，然后重启服务。`;
  }
  return `DepotDownloader framework build requires .NET ${formatMajorMinor(required)} runtime.${found} Install ${packageName} or use a self-contained DepotDownloader binary.`;
}

function assertDepotDotnetRuntimeReady(executable) {
  if (path.extname(executable).toLowerCase() !== '.dll') return;
  const dotnet = commandExists('dotnet');
  const requiredVersion = getDepotRequiredDotnetVersion(executable);
  if (!dotnet) {
    throw new Error(depotDotnetMissingMessage(requiredVersion, []));
  }
  const installedVersions = getInstalledDotnetRuntimeVersions(dotnet);
  if (requiredVersion && !dotnetRuntimeSatisfies(requiredVersion, installedVersions)) {
    throw new Error(depotDotnetMissingMessage(requiredVersion, installedVersions));
  }
}

async function extractZip(zipPath, destDir) {
  ensureDir(destDir);
  if (process.platform === 'win32') {
    const cmd = `Expand-Archive -Path '${psQuote(zipPath)}' -DestinationPath '${psQuote(destDir)}' -Force`;
    await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], 240000);
    return;
  }
  const unzip = commandExists('unzip');
  if (unzip) {
    await runProcess(unzip, ['-o', zipPath, '-d', destDir], 240000);
    return;
  }
  const python = commandExists(env.PYTHON || '') ||
    commandExists(env.PYTHON3 || '') ||
    commandExists('python3') ||
    commandExists('python');
  if (python) {
    const script = [
      'import sys, zipfile',
      'zip_path, dest_dir = sys.argv[1], sys.argv[2]',
      'with zipfile.ZipFile(zip_path) as z:',
      '    z.extractall(dest_dir)',
    ].join('\n');
    await runProcess(python, ['-c', script, zipPath, destDir], 240000);
    return;
  }
  throw new Error('未找到 unzip 或 Python zipfile。Linux/Termux 请安装 unzip 或 python3。');
}

function findFileRecursive(root, name) {
  if (!root || !fs.existsSync(root)) return '';
  const target = String(name || '').toLowerCase();
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of ents) {
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(fp);
      else if (ent.isFile() && ent.name.toLowerCase() === target) return fp;
    }
  }
  return '';
}

function findRecoverableDepotBuildOutput(root) {
  if (!root || !fs.existsSync(root)) return '';
  const matches = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of ents) {
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(fp);
      else if (ent.isFile() && ent.name.toLowerCase() === 'depotdownloader.dll') {
        const candidateDir = path.dirname(fp);
        const hasRuntimeConfig = fs.existsSync(path.join(candidateDir, 'DepotDownloader.runtimeconfig.json'));
        const hasDeps = fs.existsSync(path.join(candidateDir, 'DepotDownloader.deps.json'));
        matches.push({
          dir: candidateDir,
          score: (hasRuntimeConfig ? 4 : 0) + (hasDeps ? 4 : 0) + (/[/\\]bin[/\\]Release[/\\]/.test(candidateDir) ? 2 : 0),
        });
      }
    }
  }
  matches.sort((a, b) => b.score - a.score || a.dir.length - b.dir.length);
  return matches.length ? matches[0].dir : '';
}

function recoverDepotRuntimeFromBuildOutput(tmpRoot, runtimeDir) {
  const outputDir = findRecoverableDepotBuildOutput(tmpRoot);
  if (!outputDir) return '';
  ensureDir(runtimeDir);
  fs.cpSync(outputDir, runtimeDir, { recursive: true, force: true });
  const recovered = path.join(runtimeDir, 'DepotDownloader.dll');
  return fs.existsSync(recovered) ? recovered : '';
}

function isRecoverableDotnetPostBuildCrash(error) {
  const message = String((error && error.message) || error || '');
  return /SIGSEGV|Native Crash Reporting|mono runtime/i.test(message);
}

function depotJsonProgressStampPath() {
  return path.join(DEPOT_JSON_PROGRESS_DIR, '.wallhub-json-progress-build.json');
}

function depotStreamStampPath() {
  return path.join(DEPOT_STREAM_DOWNLOADER_DIR, '.wallhub-stream-build.json');
}

function depotRuntimeStampCandidates(executable, fallbackStampPath) {
  return depotRuntimePaths.depotRuntimeStampCandidates(executable, fallbackStampPath);
}

function depotRuntimeStampMatches(executable, fallbackStampPath, patchVersion) {
  return depotRuntimePaths.depotRuntimeStampMatches(executable, fallbackStampPath, patchVersion);
}

function depotJsonProgressBuildReady() {
  const exe = resolveDepotJsonProgressDownloaderPath();
  const stamp = depotJsonProgressStampPath();
  if (!exe) return '';
  if (shouldRejectDepotAppHostForAndroid() && path.extname(exe).toLowerCase() !== '.dll') {
    logger.warn('[SteamKit] Existing Termux DepotDownloader apphost is not portable, rebuilding as framework DLL.');
    return '';
  }
  return depotRuntimeStampMatches(exe, stamp, DEPOT_JSON_PROGRESS_PATCH_VERSION) ? exe : '';
}

function depotStreamBuildReady() {
  const exe = resolveDepotStreamDownloaderPath();
  const stamp = depotStreamStampPath();
  if (!exe) return '';
  if (shouldRejectDepotAppHostForAndroid() && path.extname(exe).toLowerCase() !== '.dll') {
    logger.warn('[SteamKit] Existing Termux DepotDownloader stream apphost is not portable, rebuilding as framework DLL.');
    return '';
  }
  return depotRuntimeStampMatches(exe, stamp, DEPOT_STREAM_PATCH_VERSION) ? exe : '';
}

function replaceSourceOnce(source, needle, replacement, description) {
  return depotPatch.replaceSourceOnce(source, needle, replacement, description);
}

function replaceSourceRegexOnce(source, regex, replacement, description) {
  return depotPatch.replaceSourceRegexOnce(source, regex, replacement, description);
}

function patchDepotDownloaderForJsonProgress(projectDir, options = {}) {
  return depotPatch.patchDepotDownloaderForJsonProgress(projectDir, options);
}

async function buildPatchedDepotDownloaderRuntime(options) {
  const runtimeDir = options.runtimeDir;
  const stampPath = options.stampPath;
  const patchVersion = options.patchVersion;
  const includeStream = !!options.includeStream;
  const label = options.label || 'DepotDownloader';
  const readyFn = options.readyFn;
  const resolvePathFn = options.resolvePathFn;
  const ready = readyFn ? readyFn() : '';
  if (ready) return ready;
  let dotnet = '';
  try {
    dotnet = assertDotnet9BuildEnvironment();
  } catch (e) {
    if (!DEPOT_JSON_PROGRESS_LOGGED_UNAVAILABLE) {
      DEPOT_JSON_PROGRESS_LOGGED_UNAVAILABLE = true;
      logger.warn(`[SteamKit] .NET 9 build environment is not ready: ${e.message}`);
    }
    updateRuntimeSetup({
      mode: 'steamkit',
      status: 'error',
      progress: 0,
      message: e.message,
      error: e.message,
      runnerDir: STEAMKIT_ROOT
    });
    throw e;
  }

  const dotnetBuildEnv = buildDepotDotnetBuildEnv();
  await warmupDotnetForDepotBuild(dotnet, dotnetBuildEnv);
  updateRuntimeSetup({ mode: 'steamkit', status: 'installing', progress: 82, message: `正在构建 ${label}`, runnerDir: STEAMKIT_ROOT });
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-depot-src-'));
  const tmpZip = path.join(tmpRoot, 'depotdownloader-source.zip');
  let keepTmpRoot = false;
  try {
    await downloadFileBuffer(DEPOT_JSON_PROGRESS_SOURCE_ZIP, tmpZip);
    await extractZip(tmpZip, tmpRoot);
    const projectPath = findFileRecursive(tmpRoot, 'DepotDownloader.csproj');
    if (!projectPath) throw new Error('DepotDownloader source project not found');
    patchDepotDownloaderForJsonProgress(path.dirname(projectPath), { includeStream });

    if (fs.existsSync(runtimeDir)) {
      logger.log(`[SteamKit] Rebuilding ${label} in ${runtimeDir}`);
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
    ensureDir(runtimeDir);
    const publishArgs = buildDepotPublishArgs(projectPath, runtimeDir);
    try {
      await runProcess(dotnet, publishArgs, 600000, { env: dotnetBuildEnv });
    } catch (buildError) {
      if (!isRecoverableDotnetPostBuildCrash(buildError)) throw buildError;
      const recovered = recoverDepotRuntimeFromBuildOutput(tmpRoot, runtimeDir);
      if (!recovered) throw buildError;
      logger.warn(`[SteamKit] ${label} dotnet build reported a native post-build crash after producing DepotDownloader.dll; recovered framework DLL from build output: ${recovered}`);
    }

    const found = resolvePathFn({ requireStamp: false });
    if (!found) throw new Error(`${label} executable not found after build`);
    if (process.platform !== 'win32' && path.extname(found).toLowerCase() !== '.dll') {
      try { await runProcess('chmod', ['+x', found], 5000); } catch {}
    }
    fs.writeFileSync(stampPath, JSON.stringify({
      patchVersion,
      builtAt: new Date().toISOString(),
      executablePath: found,
      includeStream
    }, null, 2), 'utf8');
    logger.log(`[SteamKit] ${label} ready: ${found}`);
    updateRuntimeSetup({
      mode: 'steamkit',
      status: 'ready',
      progress: 100,
      message: `${label}已就绪`,
      executablePath: found,
      runnerDir: STEAMKIT_ROOT
    });
    return found;
  } catch (e) {
    keepTmpRoot = true;
    const sourceMessage = `保留构建源码用于诊断: ${tmpRoot}`;
    logger.warn(`[SteamKit] ${label} build failed: ${e.message}`);
    logger.warn(`[SteamKit] ${sourceMessage}`);
    updateRuntimeSetup({
      mode: 'steamkit',
      status: 'error',
      progress: 0,
      message: `${label}构建失败: ${e.message}；${sourceMessage}`,
      error: `${e.message}；${sourceMessage}`,
      runnerDir: STEAMKIT_ROOT
    });
    throw e;
  } finally {
    if (!keepTmpRoot && env.WALLHUB_KEEP_DEPOT_BUILD_SOURCE !== '1') {
      try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch {}
    } else {
      logger.warn(`[SteamKit] Kept ${label} build source: ${tmpRoot}`);
    }
  }
}

async function buildJsonProgressDepotDownloader() {
  const mode = String(env.WALLHUB_DEPOT_JSON_PROGRESS || 'auto').trim().toLowerCase();
  if (mode === 'off' || mode === '0' || mode === 'false') {
    throw new Error('SteamKit 模式必须启用 JSON 真实进度下载器，请移除 WALLHUB_DEPOT_JSON_PROGRESS=off。');
  }
  cleanupLegacyDepotJsonProgressDir();
  return buildPatchedDepotDownloaderRuntime({
    runtimeDir: DEPOT_DOWNLOADER_DIR,
    stampPath: depotJsonProgressStampPath(),
    patchVersion: DEPOT_JSON_PROGRESS_PATCH_VERSION,
    includeStream: false,
    label: 'SteamKit JSON 真实进度下载器',
    readyFn: depotJsonProgressBuildReady,
    resolvePathFn: resolveDepotJsonProgressDownloaderPath
  });
}

async function buildDepotStreamDownloader() {
  return buildPatchedDepotDownloaderRuntime({
    runtimeDir: DEPOT_STREAM_DOWNLOADER_DIR,
    stampPath: depotStreamStampPath(),
    patchVersion: DEPOT_STREAM_PATCH_VERSION,
    includeStream: true,
    label: 'SteamKit 分块在线播放下载器',
    readyFn: depotStreamBuildReady,
    resolvePathFn: resolveDepotStreamDownloaderPath
  });
}

async function ensureJsonProgressDepotDownloaderReady() {
  const ready = depotJsonProgressBuildReady();
  if (ready) return ready;
  if (!DEPOT_JSON_PROGRESS_INSTALL_PROMISE) {
    DEPOT_JSON_PROGRESS_INSTALL_PROMISE = buildJsonProgressDepotDownloader().finally(() => { DEPOT_JSON_PROGRESS_INSTALL_PROMISE = null; });
  }
  return DEPOT_JSON_PROGRESS_INSTALL_PROMISE;
}

async function ensureDepotStreamDownloaderReady() {
  const ready = depotStreamBuildReady();
  let found = ready;
  if (!found) {
    if (!DEPOT_STREAM_INSTALL_PROMISE) {
      DEPOT_STREAM_INSTALL_PROMISE = buildDepotStreamDownloader().finally(() => { DEPOT_STREAM_INSTALL_PROMISE = null; });
    }
    found = await DEPOT_STREAM_INSTALL_PROMISE;
  }
  assertDepotDotnetRuntimeReady(found);
  await assertDepotExecutableStarts(found, 'SteamKit 分块在线播放下载器');
  return found;
}

function warmupDepotStreamDownloader(reason = '') {
  if (effectiveDownloaderMode() !== 'steamkit' || !videoCacheSettings().steamKitDepotStreaming) return;
  if (depotStreamBuildReady()) return;
  if (!DEPOT_STREAM_INSTALL_PROMISE) {
    logger.log(`[SteamKit] Warming up SteamKit 分块在线播放下载器${reason ? ` (${reason})` : ''}`);
    DEPOT_STREAM_INSTALL_PROMISE = buildDepotStreamDownloader().finally(() => { DEPOT_STREAM_INSTALL_PROMISE = null; });
  }
  DEPOT_STREAM_INSTALL_PROMISE.catch((e) => {
    logger.warn(`[SteamKit] SteamKit 分块在线播放下载器预热失败: ${e.message}`);
  });
}

async function ensureDepotDownloaderReady() {
  const found = await ensureJsonProgressDepotDownloaderReady();
  if (!found) throw makeSteamKitJsonProgressRequiredError();
  assertDepotDotnetRuntimeReady(found);
  await assertDepotExecutableStarts(found, 'SteamKit JSON 真实进度下载器');
  if (shouldRejectDepotAppHostForAndroid() && process.platform === 'android' && path.extname(found).toLowerCase() !== '.dll') {
    logger.warn('[SteamKit] Native Termux usually needs the framework build with dotnet; self-contained Linux binaries may require proot Debian/Ubuntu.');
  }
  updateRuntimeSetup({
    mode: 'steamkit',
    status: 'ready',
    progress: 100,
    message: 'SteamKit JSON 真实进度下载器已就绪',
    executablePath: found,
    runnerDir: STEAMKIT_ROOT
  });
  return found;
}

function depotCommandFor(executable) {
  const ext = path.extname(executable).toLowerCase();
  if (ext === '.dll') {
    return { command: 'dotnet', argsPrefix: [executable] };
  }
  return { command: executable, argsPrefix: [] };
}

async function assertDepotExecutableStarts(executable, label = 'DepotDownloader') {
  const resolved = path.resolve(String(executable || ''));
  if (!resolved) throw new Error(`${label} executable path is empty`);
  if (DEPOT_EXECUTABLE_START_CHECKS.has(resolved)) return;
  ensureDir(DEPOT_CONFIG_DIR);
  const { command, argsPrefix } = depotCommandFor(resolved);
  const args = [...argsPrefix, '-V'];
  try {
    await runProcess(command, args, 20000, {
      cwd: DEPOT_CONFIG_DIR,
      closeStdin: true,
      env: buildDepotDotnetEnv()
    });
    DEPOT_EXECUTABLE_START_CHECKS.add(resolved);
  } catch (e) {
    const message = e && e.message ? e.message : String(e || 'unknown error');
    throw new Error(`${label} 无法启动: ${message}`);
  }
}

function parsePositiveInt(raw, fallback) {
  const parsed = parseInt(String(raw || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function hexBytesFromMb(mb) {
  return depotTools.hexBytesFromMb(mb, 256);
}

function buildDepotDotnetEnv() {
  const depotEnv = {};
  const useSystemProfile = String(env.WALLHUB_DEPOT_USE_SYSTEM_PROFILE || '').trim() === '1';
  for (const dir of [
    DEPOT_CONFIG_DIR,
    DEPOT_HOME_DIR,
    DEPOT_DOTNET_CLI_HOME_DIR,
    DEPOT_XDG_DATA_HOME_DIR,
    DEPOT_XDG_CONFIG_HOME_DIR,
    DEPOT_LOCALAPPDATA_DIR,
    DEPOT_APPDATA_DIR
  ]) {
    try { ensureDir(dir); } catch {}
  }
  if (!useSystemProfile) {
    depotEnv.DOTNET_CLI_HOME = DEPOT_DOTNET_CLI_HOME_DIR;
    depotEnv.HOME = DEPOT_HOME_DIR;
    depotEnv.XDG_DATA_HOME = DEPOT_XDG_DATA_HOME_DIR;
    depotEnv.XDG_CONFIG_HOME = DEPOT_XDG_CONFIG_HOME_DIR;
    depotEnv.LOCALAPPDATA = DEPOT_LOCALAPPDATA_DIR;
    depotEnv.APPDATA = DEPOT_APPDATA_DIR;
    depotEnv.USERPROFILE = DEPOT_HOME_DIR;
  }
  if (env.WALLHUB_DEPOT_ACCOUNT_STORE_DIR) {
    depotEnv.WALLHUB_DEPOT_ACCOUNT_STORE_DIR = env.WALLHUB_DEPOT_ACCOUNT_STORE_DIR;
  } else if (!useSystemProfile) {
    depotEnv.WALLHUB_DEPOT_ACCOUNT_STORE_DIR = path.join(DEPOT_CONFIG_DIR, 'account-store');
  }
  const isLinuxLike = process.platform === 'linux' || process.platform === 'android' || isTermuxLikeEnv() || isAndroidHostLikeEnv();
  const forceCompat = String(env.WALLHUB_DEPOT_DOTNET_GC_COMPAT || '').trim() === '1';
  const disableCompat = String(env.WALLHUB_DEPOT_DOTNET_GC_COMPAT || '').trim() === '0';
  if ((!isLinuxLike && !forceCompat) || disableCompat) return depotEnv;

  const heapMb = parsePositiveInt(env.WALLHUB_DEPOT_DOTNET_GC_HEAP_MB || '', isAndroidHostLikeEnv() ? 192 : 256);
  const heapHex = hexBytesFromMb(heapMb);
  const setDefault = (key, value) => {
    if (env[key] === undefined || env[key] === '') depotEnv[key] = value;
  };

  setDefault('COMPlus_gcServer', '0');
  setDefault('DOTNET_gcServer', '0');
  setDefault('COMPlus_GCHeapCount', '1');
  setDefault('DOTNET_GCHeapCount', '1');
  setDefault('COMPlus_GCConserveMemory', '9');
  setDefault('DOTNET_GCConserveMemory', '9');
  setDefault('COMPlus_GCHeapHardLimit', heapHex);
  setDefault('DOTNET_GCHeapHardLimit', heapHex);
  setDefault('DOTNET_CLI_TELEMETRY_OPTOUT', '1');
  setDefault('DOTNET_SKIP_FIRST_TIME_EXPERIENCE', '1');
  const dotnetRoot = resolveDotnetRoot();
  if (dotnetRoot) {
    setDefault('DOTNET_ROOT', dotnetRoot);
    setDefault('DOTNET_ROOT_ARM64', dotnetRoot);
  }

  if (!DEPOT_DOTNET_ENV_LOGGED) {
    DEPOT_DOTNET_ENV_LOGGED = true;
    logger.log(`[SteamKit] .NET GC compatibility enabled for DepotDownloader (heap ${parseInt(heapHex, 16) / 1024 / 1024} MB)`);
  }
  return depotEnv;
}


  return {
    prepareRuntimeOnStartup,
    waitForStartupPreparationForDownload,
    cleanupLegacyDepotJsonProgressDir,
    commandExists,
    pathLooksExecutable,
    depotExecutableNames,
    resolveDepotDownloaderPath,
    resolveDepotRuntimePath,
    resolveDepotJsonProgressDownloaderPath,
    resolveDepotStreamDownloaderPath,
    findDepotDownloaderRecursive,
    parseCsvEnv,
    isGithubDownloadUrl,
    buildGithubProxyUrl,
    githubProxyCandidates,
    checkGoogleReachability,
    chooseGithubDownloadRoutes,
    downloadFileBuffer,
    downloadGithubRouteToFile,
    looksLikeZipBuffer,
    parseVersionParts,
    formatMajorMinor,
    findDepotRuntimeConfig,
    getDepotRequiredDotnetVersion,
    getInstalledDotnetRuntimeVersions,
    resolveDotnetRoot,
    getInstalledDotnetSdkVersions,
    dotnetRuntimeSatisfies,
    dotnetMajorInstalled,
    dotnet9InstallMessage,
    assertDotnet9BuildEnvironment,
    buildDepotDotnetBuildEnv,
    buildDepotPublishArgs,
    warmupDotnetForDepotBuild,
    depotDotnetMissingMessage,
    assertDepotDotnetRuntimeReady,
    extractZip,
    findFileRecursive,
    findRecoverableDepotBuildOutput,
    recoverDepotRuntimeFromBuildOutput,
    isRecoverableDotnetPostBuildCrash,
    depotJsonProgressStampPath,
    depotStreamStampPath,
    depotRuntimeStampCandidates,
    depotRuntimeStampMatches,
    depotJsonProgressBuildReady,
    depotStreamBuildReady,
    replaceSourceOnce,
    replaceSourceRegexOnce,
    patchDepotDownloaderForJsonProgress,
    buildPatchedDepotDownloaderRuntime,
    buildJsonProgressDepotDownloader,
    buildDepotStreamDownloader,
    ensureJsonProgressDepotDownloaderReady,
    ensureDepotStreamDownloaderReady,
    warmupDepotStreamDownloader,
    ensureDepotDownloaderReady,
    depotCommandFor,
    assertDepotExecutableStarts,
    buildDepotDotnetEnv,
  };
}

module.exports = { createSteamKitRuntimeBuildService };
