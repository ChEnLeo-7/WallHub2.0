'use strict';

function createVideoDepot(deps = {}) {
  const { registry, logger = console } = deps;
  let streamService = null;

  function settings() {
    return deps.getVideoCacheSettings ? deps.getVideoCacheSettings() : {};
  }

  function steamKitDepotStreamingEnabled() {
    return deps.effectiveDownloaderMode() === 'steamkit' && !!settings().steamKitDepotStreaming;
  }

  function getDepotStreamService() {
    if (!streamService) {
      streamService = deps.createDepotStreamService({
        DEPOT_STREAM_PATCH_VERSION: deps.DEPOT_STREAM_PATCH_VERSION,
        DEPOT_CONFIG_DIR: deps.DEPOT_CONFIG_DIR,
        DEPOT_STREAM_CACHE_DIR: deps.DEPOT_STREAM_CACHE_DIR,
        DEPOT_STREAM_MAX_RANGE_BYTES: deps.DEPOT_STREAM_MAX_RANGE_BYTES,
        DEPOT_STREAM_FIRST_RANGE_BYTES: deps.DEPOT_STREAM_FIRST_RANGE_BYTES,
        DEPOT_STREAM_TAIL_BYTES: deps.DEPOT_STREAM_TAIL_BYTES,
        DEPOT_STREAM_INITIAL_BUFFER_BYTES: deps.DEPOT_STREAM_INITIAL_BUFFER_BYTES,
        DEPOT_STREAM_AHEAD_BYTES: deps.DEPOT_STREAM_AHEAD_BYTES,
        DEPOT_STREAM_WORKER_IDLE_MS: deps.DEPOT_STREAM_WORKER_IDLE_MS,
        DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK: deps.DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK,
        DEPOT_STREAM_CACHE_CLEANUP_TARGET: deps.DEPOT_STREAM_CACHE_CLEANUP_TARGET,
        DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS: deps.DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS,
        depotCommandFor: deps.depotCommandFor,
        getSteamKitStreamMaxDownloads: deps.getSteamKitStreamMaxDownloads,
        makeDepotLoginId: deps.makeDepotLoginId,
        getSteamContentCellId: deps.getSteamContentCellId,
        resolveDepotLogin: deps.resolveDepotLogin,
        ensureDepotStreamDownloaderReady: deps.ensureDepotStreamDownloaderReady,
        ensureDir: deps.ensureDir,
        runProcess: deps.runProcess,
        buildSteamContentEnv: deps.buildSteamContentEnv,
        buildDepotDotnetEnv: deps.buildDepotDotnetEnv,
        getSteamCdnRouteStrategy: deps.getSteamCdnRouteStrategy,
        updateSteamCdnStatusFromText: deps.updateSteamCdnStatusFromText,
        describeSteamCdnRouteStrategy: deps.describeSteamCdnRouteStrategy,
        fmtBytes: deps.fmtBytes,
        getDepotStreamCacheMaxBytes: deps.getDepotStreamCacheMaxBytes,
        getDepotVideoStreams: registry.getDepotStreams,
        getDepotVideoStream: registry.getDepot,
        hasFilesRecursive: deps.hasFilesRecursive,
        getVideoMime: deps.getVideoMime,
        steamKitNeedsOwnedAccount: deps.steamKitNeedsOwnedAccount,
        canUseDepotLogin: deps.canUseDepotLogin,
        makeSteamKitLoginRequiredError: deps.makeSteamKitLoginRequiredError,
        normalizeDepotError: deps.normalizeDepotError,
        shouldRetrySteamLoginRequiredError: deps.shouldRetrySteamLoginRequiredError,
        refreshPersistentSteamLoginForRetry: deps.refreshPersistentSteamLoginForRetry,
        jsonRes: deps.jsonRes,
        send: deps.send,
        sleep: deps.sleep,
      });
    }
    return streamService;
  }

  async function tryCreateVideoStream(source, detail, cancelled = () => false) {
    if (!steamKitDepotStreamingEnabled() || !source || source.kind !== 'chunk') return null;

    const id = String(source.id || (detail && detail.publishedfileid) || '').trim();
    if (!id) return null;
    const depotLogin = deps.resolveDepotLogin(431960);
    if (deps.steamKitNeedsOwnedAccount(431960) && !deps.canUseDepotLogin(depotLogin)) {
      throw deps.makeSteamKitLoginRequiredError();
    }
    try {
      const sourceEntry = Object.assign({}, source, { id, publishedFileId: id });
      let worker;
      try {
        worker = await getDepotStreamWorker(sourceEntry, depotLogin);
      } catch (workerError) {
        const err = deps.normalizeDepotError(workerError);
        if (deps.shouldRetrySteamLoginRequiredError && deps.shouldRetrySteamLoginRequiredError(err) && deps.refreshPersistentSteamLoginForRetry) {
          logger.warn(`[Depot Stream] Worker ${id} reported login required despite cached account; retrying once.`);
          const refreshed = await deps.refreshPersistentSteamLoginForRetry(`depot-stream-worker:${id}`);
          if (!refreshed) throw err;
          worker = await getDepotStreamWorker(sourceEntry, deps.resolveDepotLogin(431960));
        } else {
          throw err;
        }
      }
      const info = Object.assign({}, worker.info || {}, { workerKey: worker.key });
      if (cancelled()) {
        registry.releaseDepotEntryIfUnreferenced(info, 'request-aborted');
        return null;
      }
      const token = registry.createDepot(source, info);
      const entry = registry.getDepot(token);
      if (entry) scheduleDepotStreamInitialPrefetch(entry, depotLogin);
      logger.log(`[Video Source] id=${id} source=chunk/depot streaming=enabled status=ready file="${info.fileName || source.filename || ''}" size=${info.size || 0}`);
      return { streamUrl: `/api/video/depot?token=${encodeURIComponent(token)}`, info };
    } catch (error) {
      const err = deps.normalizeDepotError(error);
      if (err && err.requiresSteamLogin) throw err;
      logger.warn(`[Video Source] id=${id} source=chunk/depot streaming=enabled status=failed error=${err.message}`);
      throw deps.codedError(
        `SteamKit 分块在线播放初始化失败：${err.message || '请稍后重试'}`,
        'DEPOT_STREAM_FAILED',
        503
      );
    }
  }

  function buildDepotStreamArgs(executable, publishedFileId, appId, options) {
    return getDepotStreamService().buildArgs(executable, publishedFileId, appId, options);
  }

  async function getDepotVideoStreamInfo(publishedFileId, depotLogin) {
    return getDepotStreamService().getInfo(publishedFileId, depotLogin);
  }

  function streamFileWithRange(req, res, filePath) {
    return getDepotStreamService().streamFileWithRange(req, res, filePath);
  }

  function normalizeDepotStreamRange(req, total) {
    return getDepotStreamService().normalizeRange(req, total);
  }

  function findDepotStreamCachedRange(entry, start, end) {
    return getDepotStreamService().findCachedRange(entry, start, end);
  }

  function pipeDepotStreamCachedRange(res, cache, start, end, headers, statusCode, entry) {
    return getDepotStreamService().pipeCachedRange(res, cache, start, end, headers, statusCode, entry);
  }

  function stopAllDepotStreamWorkers(reason = 'settings-changed') {
    getDepotStreamService().setServerStopping(!!(deps.getServerStopping && deps.getServerStopping()));
    return getDepotStreamService().stopAllWorkers(reason);
  }

  async function getDepotStreamWorker(entry, depotLogin) {
    return getDepotStreamService().getWorker(entry, depotLogin);
  }

  async function ensureDepotStreamRangeCached(entry, start, end, depotLogin, options = {}) {
    return getDepotStreamService().ensureRangeCached(entry, start, end, depotLogin, options);
  }

  function scheduleDepotStreamInitialPrefetch(entry, depotLogin) {
    return getDepotStreamService().scheduleInitialPrefetch(entry, depotLogin);
  }

  function scheduleDepotStreamAheadPrefetch(entry, currentStart, currentEnd, depotLogin) {
    return getDepotStreamService().scheduleAheadPrefetch(entry, currentStart, currentEnd, depotLogin);
  }

  function cleanupDepotStreamCache(options = {}) {
    return getDepotStreamService().cleanupCache(options);
  }

  function scheduleDepotStreamCacheCleanup(reason = 'scheduled') {
    return getDepotStreamService().scheduleCacheCleanup(reason);
  }

  function maybeScheduleDepotStreamCacheCleanupAfterWrite(addedBytes = 0) {
    return getDepotStreamService().maybeScheduleCacheCleanupAfterWrite(addedBytes);
  }

  function getDepotStreamCacheStats() {
    return getDepotStreamService().getCacheStats();
  }

  function clearDepotStreamCacheNow() {
    return getDepotStreamService().clearCacheNow();
  }

  async function handleDepotVideoStream(req, res, token) {
    return getDepotStreamService().handleVideoStream(req, res, token);
  }

  async function handleDepotVideoRelease(req, res, token) {
    return deps.jsonRes(res, 200, registry.releaseDepot(token));
  }

  function getDepotWorkerCount() {
    return getDepotStreamService().workers.size;
  }

  return {
    steamKitDepotStreamingEnabled,
    getDepotStreamService,
    tryCreateVideoStream,
    releaseVideoStreamUrl: registry.releaseDepotUrl,
    buildDepotStreamArgs,
    getDepotVideoStreamInfo,
    streamFileWithRange,
    normalizeDepotStreamRange,
    findDepotStreamCachedRange,
    pipeDepotStreamCachedRange,
    stopAllDepotStreamWorkers,
    getDepotStreamWorker,
    ensureDepotStreamRangeCached,
    scheduleDepotStreamInitialPrefetch,
    scheduleDepotStreamAheadPrefetch,
    cleanupDepotStreamCache,
    scheduleDepotStreamCacheCleanup,
    maybeScheduleDepotStreamCacheCleanupAfterWrite,
    getDepotStreamCacheStats,
    clearDepotStreamCacheNow,
    handleDepotVideoStream,
    handleDepotVideoRelease,
    getDepotWorkerCount,
  };
}

module.exports = {
  createVideoDepot,
};
