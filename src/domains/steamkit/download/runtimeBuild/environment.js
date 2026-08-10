'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const depotTools = require('../../depotTools');
const dotnetRuntime = require('../../dotnetRuntime');

function createBuildEnvironment(deps) {
  const {
    env = process.env,
    logger = console,
    STEAMKIT_ROOT,
    DEPOT_CONFIG_DIR,
    DEPOT_HOME_DIR,
    DEPOT_DOTNET_CLI_HOME_DIR,
    DEPOT_XDG_DATA_HOME_DIR,
    DEPOT_XDG_CONFIG_HOME_DIR,
    DEPOT_LOCALAPPDATA_DIR,
    DEPOT_APPDATA_DIR,
    ensureDir,
    runProcess,
    updateRuntimeSetup,
    isTermuxLikeEnv,
    isAndroidHostLikeEnv,
  } = deps;
  const executableStartChecks = new Set();
  let depotDotnetEnvLogged = false;

  function commandExists(command) {
    const name = String(command || '').trim();
    if (!name) return '';
    const isWin = process.platform === 'win32';
    const hasPathSep = name.includes('/') || name.includes('\\');
    const pathExts = isWin
      ? String(env.PATHEXT || '.EXE;.CMD;.BAT;.COM').split(';').map(s => s.trim()).filter(Boolean)
      : [''];
    const candidates = [];
    const addCandidate = (base) => {
      if (!base) return;
      candidates.push(base);
      if (isWin && !path.extname(base)) pathExts.forEach(ext => candidates.push(base + ext));
    };
    if (hasPathSep) {
      addCandidate(name);
    } else {
      String(env.PATH || '').split(path.delimiter).map(s => s.trim()).filter(Boolean).forEach(dir => addCandidate(path.join(dir, name)));
    }
    for (const candidate of candidates) {
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
      } catch {}
    }
    try {
      const shQuote = (value) => `'${String(value).replace(/'/g, `'\\''`)}'`;
      const finder = isWin ? 'where.exe' : 'sh';
      const args = isWin ? [name] : ['-lc', `command -v ${shQuote(name)}`];
      const out = execFileSync(finder, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      return String(out || '').split(/\r?\n/).map(s => s.trim()).find(Boolean) || '';
    } catch {
      return '';
    }
  }

  function parseVersionParts(version) {
    return depotTools.parseVersionParts(version);
  }

  function formatMajorMinor(version) {
    return depotTools.formatMajorMinor(version);
  }

  function getInstalledDotnetRuntimeVersions(dotnetCommand) {
    return dotnetRuntime.getInstalledDotnetRuntimeVersions(dotnetCommand);
  }

  function resolveDotnetRoot(dotnetCommand) {
    return dotnetRuntime.resolveDotnetRoot({ env, dotnetCommand, commandExists });
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
    if (!dotnet) throw new Error(dotnet9InstallMessage('未检测到 dotnet 命令。'));
    const runtimes = getInstalledDotnetRuntimeVersions(dotnet);
    const sdks = getInstalledDotnetSdkVersions(dotnet);
    const hasRuntime9 = dotnetMajorInstalled(runtimes, 9);
    const hasSdk9 = dotnetMajorInstalled(sdks, 9);
    if (!hasRuntime9 || !hasSdk9) {
      const missing = [hasSdk9 ? '' : '.NET 9 SDK', hasRuntime9 ? '' : '.NET 9 Runtime'].filter(Boolean).join(' 和 ');
      throw new Error(dotnet9InstallMessage(`SteamKit JSON 真实进度下载器需要 ${missing}。`, { runtimes, sdks }));
    }
    return dotnet;
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
      DEPOT_APPDATA_DIR,
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
    const heapMb = parseInt(String(env.WALLHUB_DEPOT_DOTNET_GC_HEAP_MB || '').trim(), 10);
    const heapHex = depotTools.hexBytesFromMb(Number.isFinite(heapMb) && heapMb > 0 ? heapMb : (isAndroidHostLikeEnv() ? 192 : 256), 256);
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
    if (!depotDotnetEnvLogged) {
      depotDotnetEnvLogged = true;
      logger.log(`[SteamKit] .NET GC compatibility enabled for DepotDownloader (heap ${parseInt(heapHex, 16) / 1024 / 1024} MB)`);
    }
    return depotEnv;
  }

  function buildDepotDotnetBuildEnv() {
    const buildEnv = Object.assign({}, buildDepotDotnetEnv(), {
      DOTNET_CLI_TELEMETRY_OPTOUT: '1',
      DOTNET_SKIP_FIRST_TIME_EXPERIENCE: '1',
      DOTNET_NOLOGO: '1',
      NUGET_XMLDOC_MODE: 'skip',
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
      updateRuntimeSetup({ mode: 'steamkit', status: 'installing', progress: 78, message: '正在预热 Termux .NET 运行环境', runnerDir: STEAMKIT_ROOT });
      await runProcess(dotnet, ['--info'], 60000, { env: buildEnv });
    } catch (error) {
      logger.warn(`[SteamKit] .NET warmup failed, continuing build: ${error.message}`);
    }
  }

  function buildDepotPublishArgs(projectPath, runtimeDir) {
    const androidLike = isTermuxLikeEnv() || isAndroidHostLikeEnv();
    const args = [
      'publish', projectPath,
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
    const found = installedVersions && installedVersions.length ? ` 当前检测到: ${installedVersions.join(', ')}。` : '';
    if (isTermuxLikeEnv()) {
      return `DepotDownloader 已下载，但需要 .NET ${formatMajorMinor(required)} 运行时。${found}Termux 请执行: pkg update && pkg install ${packageName}，然后重启服务。`;
    }
    return `DepotDownloader framework build requires .NET ${formatMajorMinor(required)} runtime.${found} Install ${packageName} or use a self-contained DepotDownloader binary.`;
  }

  function assertDepotDotnetRuntimeReady(executable, getRequiredVersion) {
    if (path.extname(executable).toLowerCase() !== '.dll') return;
    const dotnet = commandExists('dotnet');
    const requiredVersion = getRequiredVersion(executable);
    if (!dotnet) throw new Error(depotDotnetMissingMessage(requiredVersion, []));
    const installedVersions = getInstalledDotnetRuntimeVersions(dotnet);
    if (requiredVersion && !dotnetRuntimeSatisfies(requiredVersion, installedVersions)) {
      throw new Error(depotDotnetMissingMessage(requiredVersion, installedVersions));
    }
  }

  function depotCommandFor(executable) {
    const ext = path.extname(executable).toLowerCase();
    return ext === '.dll' ? { command: 'dotnet', argsPrefix: [executable] } : { command: executable, argsPrefix: [] };
  }

  async function assertDepotExecutableStarts(executable, label = 'DepotDownloader') {
    const resolved = path.resolve(String(executable || ''));
    if (!resolved) throw new Error(`${label} executable path is empty`);
    if (executableStartChecks.has(resolved)) return;
    ensureDir(DEPOT_CONFIG_DIR);
    const { command, argsPrefix } = depotCommandFor(resolved);
    try {
      await runProcess(command, [...argsPrefix, '-V'], 20000, {
        cwd: DEPOT_CONFIG_DIR,
        closeStdin: true,
        env: buildDepotDotnetEnv(),
      });
      executableStartChecks.add(resolved);
    } catch (error) {
      const message = error && error.message ? error.message : String(error || 'unknown error');
      throw new Error(`${label} 无法启动: ${message}`);
    }
  }

  return {
    commandExists,
    parseVersionParts,
    formatMajorMinor,
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
    depotCommandFor,
    assertDepotExecutableStarts,
    buildDepotDotnetEnv,
  };
}

module.exports = { createBuildEnvironment };
