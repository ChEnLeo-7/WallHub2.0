'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { steamKitPreSpawnWarmupTimeoutMs } = require('./watchdog');
const { createActiveTaskRegistry } = require('./activeTaskRegistry');
const { createProcessSession } = require('./processSession');
const { createResultPublisher } = require('./resultPublisher');
const { createDownloadRetryPolicy } = require('./retryPolicy');

function delay(ms, value) {
  return new Promise(resolve => setTimeout(() => resolve(value), Math.max(0, ms)));
}

function createDownloadTaskRunner(deps, auth, resume) {
  const {
    STEAM_CREDENTIALS,
    DEPOT_CONFIG_DIR,
    STEAMKIT_CONFIG_DIR,
    ensureDir,
    waitForStartupPreparationForDownload,
    warmupSteamAccessControlPlane = async () => null,
    depotCommandFor,
    getSteamKitMaxDownloads,
    getSteamContentCellId,
    ensureDepotDownloaderReady,
    describeSteamCdnRouteStrategy,
    logger = console,
  } = deps;

  function makeCancelledError(stage) {
    const error = auth.codedError(stage ? `Download cancelled during ${stage}` : 'Download cancelled', 'CANCELLED', 409);
    error.name = 'AbortError';
    return error;
  }

  function throwIfDownloadCancelled(options, stage) {
    const task = options && options.task;
    if ((options && options.signal && options.signal.aborted) || (task && task.status === 'cancelled')) {
      throw makeCancelledError(stage);
    }
    if (task && task.status === 'paused') throw makeCancelledError(stage || 'pause');
  }

  const activeTasks = createActiveTaskRegistry();
  const processSession = createProcessSession(deps, auth, resume, throwIfDownloadCancelled);
  const resultPublisher = createResultPublisher(deps, throwIfDownloadCancelled);
  const retryPolicy = createDownloadRetryPolicy(deps, auth);

  async function warmupControlPlane(options) {
    if (options.task) options.task.progressStage = 'SteamKit 正在快速检查 Steam WebAPI 控制连接';
    try {
      const warmupStartedAt = Date.now();
      const warmupTimeoutMs = steamKitPreSpawnWarmupTimeoutMs();
      const warmupPromise = Promise.resolve(warmupSteamAccessControlPlane('steamkit-download', { forceRefresh: false }));
      const warmupRace = await Promise.race([
        warmupPromise.then(result => ({ type: 'result', result }), error => ({ type: 'error', error })),
        delay(warmupTimeoutMs, { type: 'timeout' }),
      ]);
      throwIfDownloadCancelled(options, 'Steam WebAPI route warmup');
      if (warmupRace.type === 'timeout') {
        logger.warn(`[SteamKit] Steam WebAPI control-plane warmup still running after ${warmupTimeoutMs}ms; spawning DepotDownloader and refreshing routes in background.`);
        warmupPromise.then((warmup) => {
          if (warmup && warmup.ok > 0) logger.log(`[SteamKit] Steam WebAPI control-plane routes warmed in background: ${warmup.ok}/${warmup.total || 0}`);
          else logger.warn('[SteamKit] Steam WebAPI control-plane background warmup returned no ready route');
        }).catch((error) => {
          logger.warn('[SteamKit] Steam WebAPI control-plane background warmup failed:', error.message);
        });
      } else if (warmupRace.type === 'error') {
        throw warmupRace.error;
      } else {
        const elapsed = Date.now() - warmupStartedAt;
        const warmup = warmupRace.result;
        if (warmup && warmup.ok > 0) logger.log(`[SteamKit] Steam WebAPI control-plane routes ready: ${warmup.ok}/${warmup.total || 0} (${elapsed}ms)`);
        else logger.warn(`[SteamKit] Steam WebAPI control-plane route warmup returned no ready route (${elapsed}ms)`);
      }
    } catch (error) {
      if (error && (error.code === 'CANCELLED' || error.name === 'AbortError')) throw error;
      logger.warn('[SteamKit] Steam WebAPI control-plane route warmup failed:', error.message);
    }
  }

  function initializeResumeTask(options, rawRoot, appId, publishedFileId) {
    const resumeSeed = options.task
      ? resume.seedTaskProgress(options.task, rawRoot, appId, publishedFileId)
      : { source: resume.readTrustedResumeCheckpoint(rawRoot, appId, publishedFileId) ? 'checkpoint' : 'none', downloaded: 0, total: 0 };
    if (resumeSeed.source === 'checkpoint') {
      logger.log(`[SteamKit resume] item ${publishedFileId}: loaded checkpoint downloaded=${resumeSeed.downloaded} total=${resumeSeed.total} progress=${resumeSeed.total ? ((resumeSeed.downloaded / resumeSeed.total) * 100).toFixed(1) : '0.0'}%`);
    } else if (resumeSeed.source === 'partial-files') {
      logger.log(`[SteamKit resume] item ${publishedFileId}: partial files found; file sizes are untrusted and DepotDownloader validation will determine resumable chunks`);
    } else {
      logger.log(`[SteamKit resume] item ${publishedFileId}: no trusted checkpoint or partial files found at ${rawRoot}`);
    }
    if (options.task) {
      options.task.progressIndeterminate = options.task.progressIndeterminate !== false;
      options.task.progressStage = options.task.progressStage || 'SteamKit 正在连接 Steam3，等待下载器返回真实进度';
      options.task.progress = Math.max(0, Number(options.task.progress || 0));
      options.task.downloaded = Math.max(0, Number(options.task.downloaded || 0));
      options.task.speed = 0;
      options.task._depotIdleTimeout = false;
      options.task._depotIdleStage = '';
    }
    return resumeSeed;
  }

  async function downloadViaSteamKit(publishedFileId, appId, title, options = {}) {
    options = options || {};
    throwIfDownloadCancelled(options, 'start');
    const depotLogin = auth.resolveLogin(appId);
    if (auth.steamKitNeedsOwnedAccount(appId) && !auth.canUseLogin(depotLogin)) throw auth.makeLoginRequiredError();
    const executable = await ensureDepotDownloaderReady();
    throwIfDownloadCancelled(options, 'runtime preparation');
    await warmupControlPlane(options);
    throwIfDownloadCancelled(options, 'Steam WebAPI route warmup');
    ensureDir(DEPOT_CONFIG_DIR);

    const forceSharedDir = !!options.forceSharedDir;
    const tempRoot = forceSharedDir || STEAM_CREDENTIALS.isPersistent
      ? STEAMKIT_CONFIG_DIR
      : fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-steamkit-'));
    ensureDir(tempRoot);
    const rawRoot = path.join(tempRoot, 'depotdownloader', 'downloads', String(appId), String(publishedFileId));
    ensureDir(rawRoot);
    const resumeSeed = initializeResumeTask(options, rawRoot, appId, publishedFileId);
    const resumeCheckpointAtStart = resumeSeed.source === 'checkpoint' || resumeSeed.source === 'partial-files';
    const { command } = depotCommandFor(executable);
    const loginSlotLease = auth.acquireSteamKitLoginSlot(appId, depotLogin.user);
    const built = auth.buildArgs(executable, publishedFileId, appId, tempRoot, rawRoot, Object.assign({}, options, {
      depotLogin,
      jsonProgress: true,
      steamKitLoginId: loginSlotLease && loginSlotLease.loginId,
    }));
    logger.log(`[SteamKit] DepotDownloader item ${publishedFileId} -> ${rawRoot}`);
    logger.log(`[SteamKit] Running JSON progress DepotDownloader: ${command} args=${JSON.stringify(auth.redactDepotArgs(built.args))}`);
    logger.log(`[SteamKit] Downloader runtime: ${executable}`);
    logger.log(`[SteamKit] Steam CDN route: ${describeSteamCdnRouteStrategy()} · max ${getSteamKitMaxDownloads()}${getSteamContentCellId() ? ` · cell ${getSteamContentCellId()}` : ''}`);
    if (options.steam3ProtocolOverride) logger.log(`[SteamKit] Steam3 protocol retry: ${options.steam3ProtocolOverride}`);
    if (depotLogin.user) {
      logger.log(`[SteamKit] Using ${depotLogin.source} account: ${depotLogin.user}${depotLogin.pass ? ' (password supplied)' : ' (remembered session)'}`);
      if (loginSlotLease) logger.log(`[SteamKit] Reusing account-level login slot #${loginSlotLease.slot} for remembered SteamKit tokens`);
    }

    await processSession.run({
      publishedFileId,
      appId,
      options,
      depotLogin,
      rawRoot,
      built,
      command,
      loginSlotLease,
      resumeSeed,
      resumeCheckpointAtStart,
    });
    return resultPublisher.publishResult({ rawRoot, tempRoot, appId, publishedFileId, title, options });
  }

  async function downloadWorkshopItem(publishedFileId, appId, title, options = {}) {
    options = options || {};
    throwIfDownloadCancelled(options, 'startup preparation');
    await waitForStartupPreparationForDownload(options.task);
    throwIfDownloadCancelled(options, 'startup preparation');
    const activeKey = `${appId || 431960}:${publishedFileId}`;
    const existing = activeTasks.get(activeKey);
    if (existing) {
      if (options.task) {
        options.task.progressIndeterminate = true;
        options.task.progressStage = '同一项目已在下载，正在复用当前 DepotDownloader 任务';
      }
      return existing;
    }
    return activeTasks.run(activeKey, async () => {
      try {
        throwIfDownloadCancelled(options, 'before SteamKit download');
        return await downloadViaSteamKit(publishedFileId, appId, title, options);
      } catch (error) {
        return retryPolicy.retry(error, { publishedFileId, appId, title, options, download: downloadViaSteamKit });
      }
    });
  }

  return {
    normalizeOutput: resultPublisher.normalizeOutput,
    downloadViaSteamKit,
    downloadWorkshopItem,
  };
}

module.exports = { createDownloadTaskRunner };
