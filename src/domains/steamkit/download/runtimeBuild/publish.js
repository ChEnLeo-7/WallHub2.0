'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const depotPatch = require('../../depotPatch');

function createRuntimePublisher(deps, buildEnvironment, sourceDownload, validation) {
  const {
    env = process.env,
    logger = console,
    STEAMKIT_ROOT,
    DEPOT_DOWNLOADER_DIR,
    DEPOT_STREAM_DOWNLOADER_DIR,
    DEPOT_JSON_PROGRESS_SOURCE_ZIP,
    DEPOT_JSON_PROGRESS_PATCH_VERSION,
    DEPOT_STREAM_PATCH_VERSION,
    ensureDir,
    runProcess,
    updateRuntimeSetup,
    effectiveDownloaderMode,
    VIDEO_CACHE_SETTINGS,
    getVideoCacheSettings,
    makeSteamKitJsonProgressRequiredError,
    shouldRejectDepotAppHostForAndroid,
  } = deps;
  let jsonProgressInstallPromise = null;
  let streamInstallPromise = null;
  let jsonProgressLoggedUnavailable = false;

  function videoCacheSettings() {
    return typeof getVideoCacheSettings === 'function'
      ? (getVideoCacheSettings() || {})
      : (VIDEO_CACHE_SETTINGS || {});
  }

  function findRecoverableDepotBuildOutput(root) {
    if (!root || !fs.existsSync(root)) return '';
    const matches = [];
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(file);
        } else if (entry.isFile() && entry.name.toLowerCase() === 'depotdownloader.dll') {
          const candidateDir = path.dirname(file);
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
    const ready = options.readyFn ? options.readyFn() : '';
    if (ready) return ready;
    let dotnet = '';
    try {
      dotnet = buildEnvironment.assertDotnet9BuildEnvironment();
    } catch (error) {
      if (!jsonProgressLoggedUnavailable) {
        jsonProgressLoggedUnavailable = true;
        logger.warn(`[SteamKit] .NET 9 build environment is not ready: ${error.message}`);
      }
      updateRuntimeSetup({
        mode: 'steamkit',
        status: 'error',
        progress: 0,
        message: error.message,
        error: error.message,
        runnerDir: STEAMKIT_ROOT,
      });
      throw error;
    }

    const dotnetBuildEnv = buildEnvironment.buildDepotDotnetBuildEnv();
    await buildEnvironment.warmupDotnetForDepotBuild(dotnet, dotnetBuildEnv);
    updateRuntimeSetup({ mode: 'steamkit', status: 'installing', progress: 82, message: `正在构建 ${label}`, runnerDir: STEAMKIT_ROOT });
    const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-depot-src-'));
    const tmpZip = path.join(tmpRoot, 'depotdownloader-source.zip');
    let keepTmpRoot = false;
    try {
      await sourceDownload.downloadFileBuffer(DEPOT_JSON_PROGRESS_SOURCE_ZIP, tmpZip);
      await sourceDownload.extractZip(tmpZip, tmpRoot);
      const projectPath = sourceDownload.findFileRecursive(tmpRoot, 'DepotDownloader.csproj');
      if (!projectPath) throw new Error('DepotDownloader source project not found');
      patchDepotDownloaderForJsonProgress(path.dirname(projectPath), { includeStream });
      if (fs.existsSync(runtimeDir)) {
        logger.log(`[SteamKit] Rebuilding ${label} in ${runtimeDir}`);
        fs.rmSync(runtimeDir, { recursive: true, force: true });
      }
      ensureDir(runtimeDir);
      const publishArgs = buildEnvironment.buildDepotPublishArgs(projectPath, runtimeDir);
      try {
        await runProcess(dotnet, publishArgs, 600000, { env: dotnetBuildEnv });
      } catch (buildError) {
        if (!isRecoverableDotnetPostBuildCrash(buildError)) throw buildError;
        const recovered = recoverDepotRuntimeFromBuildOutput(tmpRoot, runtimeDir);
        if (!recovered) throw buildError;
        logger.warn(`[SteamKit] ${label} dotnet build reported a native post-build crash after producing DepotDownloader.dll; recovered framework DLL from build output: ${recovered}`);
      }
      const found = options.resolvePathFn({ requireStamp: false });
      if (!found) throw new Error(`${label} executable not found after build`);
      if (process.platform !== 'win32' && path.extname(found).toLowerCase() !== '.dll') {
        try { await runProcess('chmod', ['+x', found], 5000); } catch {}
      }
      fs.writeFileSync(stampPath, JSON.stringify({
        patchVersion,
        builtAt: new Date().toISOString(),
        executablePath: found,
        includeStream,
      }, null, 2), 'utf8');
      logger.log(`[SteamKit] ${label} ready: ${found}`);
      updateRuntimeSetup({
        mode: 'steamkit',
        status: 'ready',
        progress: 100,
        message: `${label}已就绪`,
        executablePath: found,
        runnerDir: STEAMKIT_ROOT,
      });
      return found;
    } catch (error) {
      keepTmpRoot = true;
      const sourceMessage = `保留构建源码用于诊断: ${tmpRoot}`;
      logger.warn(`[SteamKit] ${label} build failed: ${error.message}`);
      logger.warn(`[SteamKit] ${sourceMessage}`);
      updateRuntimeSetup({
        mode: 'steamkit',
        status: 'error',
        progress: 0,
        message: `${label}构建失败: ${error.message}；${sourceMessage}`,
        error: `${error.message}；${sourceMessage}`,
        runnerDir: STEAMKIT_ROOT,
      });
      throw error;
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
    validation.cleanupLegacyDepotJsonProgressDir();
    return buildPatchedDepotDownloaderRuntime({
      runtimeDir: DEPOT_DOWNLOADER_DIR,
      stampPath: validation.depotJsonProgressStampPath(),
      patchVersion: DEPOT_JSON_PROGRESS_PATCH_VERSION,
      includeStream: false,
      label: 'SteamKit JSON 真实进度下载器',
      readyFn: validation.depotJsonProgressBuildReady,
      resolvePathFn: validation.resolveDepotJsonProgressDownloaderPath,
    });
  }

  async function buildDepotStreamDownloader() {
    return buildPatchedDepotDownloaderRuntime({
      runtimeDir: DEPOT_STREAM_DOWNLOADER_DIR,
      stampPath: validation.depotStreamStampPath(),
      patchVersion: DEPOT_STREAM_PATCH_VERSION,
      includeStream: true,
      label: 'SteamKit 分块在线播放下载器',
      readyFn: validation.depotStreamBuildReady,
      resolvePathFn: validation.resolveDepotStreamDownloaderPath,
    });
  }

  async function ensureJsonProgressDepotDownloaderReady() {
    const ready = validation.depotJsonProgressBuildReady();
    if (ready) return ready;
    if (!jsonProgressInstallPromise) {
      jsonProgressInstallPromise = buildJsonProgressDepotDownloader().finally(() => { jsonProgressInstallPromise = null; });
    }
    return jsonProgressInstallPromise;
  }

  async function ensureDepotStreamDownloaderReady() {
    let found = validation.depotStreamBuildReady();
    if (!found) {
      if (!streamInstallPromise) {
        streamInstallPromise = buildDepotStreamDownloader().finally(() => { streamInstallPromise = null; });
      }
      found = await streamInstallPromise;
    }
    validation.assertDepotDotnetRuntimeReady(found);
    await buildEnvironment.assertDepotExecutableStarts(found, 'SteamKit 分块在线播放下载器');
    return found;
  }

  function warmupDepotStreamDownloader(reason = '') {
    if (effectiveDownloaderMode() !== 'steamkit' || !videoCacheSettings().steamKitDepotStreaming) return;
    if (validation.depotStreamBuildReady()) return;
    if (!streamInstallPromise) {
      logger.log(`[SteamKit] Warming up SteamKit 分块在线播放下载器${reason ? ` (${reason})` : ''}`);
      streamInstallPromise = buildDepotStreamDownloader().finally(() => { streamInstallPromise = null; });
    }
    streamInstallPromise.catch((error) => {
      logger.warn(`[SteamKit] SteamKit 分块在线播放下载器预热失败: ${error.message}`);
    });
  }

  async function ensureDepotDownloaderReady() {
    const found = await ensureJsonProgressDepotDownloaderReady();
    if (!found) throw makeSteamKitJsonProgressRequiredError();
    validation.assertDepotDotnetRuntimeReady(found);
    await buildEnvironment.assertDepotExecutableStarts(found, 'SteamKit JSON 真实进度下载器');
    if (shouldRejectDepotAppHostForAndroid() && process.platform === 'android' && path.extname(found).toLowerCase() !== '.dll') {
      logger.warn('[SteamKit] Native Termux usually needs the framework build with dotnet; self-contained Linux binaries may require proot Debian/Ubuntu.');
    }
    updateRuntimeSetup({
      mode: 'steamkit',
      status: 'ready',
      progress: 100,
      message: 'SteamKit JSON 真实进度下载器已就绪',
      executablePath: found,
      runnerDir: STEAMKIT_ROOT,
    });
    return found;
  }

  return {
    findRecoverableDepotBuildOutput,
    recoverDepotRuntimeFromBuildOutput,
    isRecoverableDotnetPostBuildCrash,
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
  };
}

module.exports = { createRuntimePublisher };
