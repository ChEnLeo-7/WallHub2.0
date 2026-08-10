'use strict';

function createRuntimeStartup(deps, validation, publisher) {
  const {
    env = process.env,
    logger = console,
    STEAMKIT_ROOT,
    DOWNLOADS_DIR,
    updateRuntimeSetup,
    runtimeSetupSnapshot,
    ensureSteamConfigDir,
    reconcileCachedSteamLogin,
  } = deps;
  let startupPreparePromise = null;

  function prepareRuntimeOnStartup() {
    if (startupPreparePromise) return startupPreparePromise;
    const mode = 'steamkit';
    startupPreparePromise = (async () => {
      validation.cleanupLegacyDepotJsonProgressDir();
      updateRuntimeSetup({
        mode,
        requestedMode: 'steamkit',
        status: 'checking',
        progress: 5,
        message: '正在检查 SteamKit 运行文件',
        runnerDir: STEAMKIT_ROOT,
        downloadsDir: DOWNLOADS_DIR,
        error: '',
      });
      ensureSteamConfigDir();
      try {
        const executable = await publisher.ensureDepotDownloaderReady();
        updateRuntimeSetup({
          mode,
          status: 'ready',
          progress: 100,
          message: 'SteamKit JSON 真实进度下载器已就绪',
          executablePath: executable,
          runnerDir: STEAMKIT_ROOT,
          downloadsDir: DOWNLOADS_DIR,
          error: '',
        });
        if (env.WALLHUB_VALIDATE_STEAM_LOGIN_ON_STARTUP === '1') await reconcileCachedSteamLogin(mode);
        publisher.warmupDepotStreamDownloader('startup');
      } catch (error) {
        const message = error.message || String(error);
        updateRuntimeSetup({
          mode,
          status: 'error',
          progress: 0,
          message: message || '运行文件准备失败',
          error: message,
          runnerDir: STEAMKIT_ROOT,
          downloadsDir: DOWNLOADS_DIR,
        });
        logger.warn('[Runtime] Startup preparation failed:', message);
      }
    })();
    return startupPreparePromise;
  }

  async function waitForStartupPreparationForDownload(task) {
    const promise = startupPreparePromise || prepareRuntimeOnStartup();
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
      // Startup preparation records its own failure in runtime setup.
    }
  }

  return { prepareRuntimeOnStartup, waitForStartupPreparationForDownload };
}

module.exports = { createRuntimeStartup };
