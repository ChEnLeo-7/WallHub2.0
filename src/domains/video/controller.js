'use strict';

const { createRemoteVideoStreamProxy } = require('./remoteStream');

function createVideoController(deps = {}) {
  const {
    createDepotStreamService,
    userAgent,
    jsonRes,
    send,
    getVideoCacheSettings,
    effectiveDownloaderMode,
    getServerStopping,
    isCacheItemTombstoned,
    getDownloadQueueService,
    getTaskQueue,
    createWorkshopQueueTask,
    getWorkshopCacheDir,
    waitForStartupPreparationForDownload,
    getFileDetails,
    detectVideoTag,
    isVideoExt,
    extFromUrl,
    extFromPath,
    mimeFromExt,
    getVideoMime,
    updateSteamCdnStatus,
    updateSteamCdnStatusFromText,
    steamCdnStatusSnapshot,
    getProxyCandidates,
    isSocksProxyProtocol,
    connectViaSocksProxy,
    proxyAuth,
    resolveDepotLogin,
    steamKitNeedsOwnedAccount,
    canUseDepotLogin,
    makeSteamKitLoginRequiredError,
    normalizeDepotError,
    shouldRetrySteamLoginRequiredError,
    refreshPersistentSteamLoginForRetry,
    codedError,
    depotCommandFor,
    getSteamKitStreamMaxDownloads,
    makeDepotLoginId,
    getSteamContentCellId,
    ensureDepotStreamDownloaderReady,
    ensureDir,
    runProcess,
    buildSteamContentEnv,
    buildDepotDotnetEnv,
    getSteamCdnRouteStrategy,
    describeSteamCdnRouteStrategy,
    fmtBytes,
    getDepotStreamCacheMaxBytes,
    hasFilesRecursive,
    sleep,
    logger = console,
    DEPOT_STREAM_PATCH_VERSION,
    DEPOT_CONFIG_DIR,
    DEPOT_STREAM_CACHE_DIR,
    DEPOT_STREAM_MAX_RANGE_BYTES,
    DEPOT_STREAM_FIRST_RANGE_BYTES,
    DEPOT_STREAM_TAIL_BYTES,
    DEPOT_STREAM_INITIAL_BUFFER_BYTES,
    DEPOT_STREAM_AHEAD_BYTES,
    DEPOT_STREAM_WORKER_IDLE_MS,
    DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK,
    DEPOT_STREAM_CACHE_CLEANUP_TARGET,
    DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS,
  } = deps;

  const VIDEO_TASK_MAP = new Map();
  const REMOTE_VIDEO_STREAMS = new Map();
  const DEPOT_VIDEO_STREAMS = new Map();
  let remoteVideoStreamProxy = null;
  let depotStreamService = null;

  function settings() {
    return getVideoCacheSettings ? getVideoCacheSettings() : {};
  }

  function findCachedVideoById(id) {
    if (isCacheItemTombstoned(id)) return null;
    return getDownloadQueueService().findCachedVideoById(id, VIDEO_TASK_MAP, getWorkshopCacheDir());
  }

  function itemLooksVideo(d) {
    return detectVideoTag(d) || isVideoExt(extFromUrl(d && d.file_url, ''));
  }

  function resolveWorkshopVideoSource(d) {
    const id = String(d && d.publishedfileid || '');
    const fileUrl = String(d && d.file_url || '').trim();
    const filename = String(d && d.filename || '').trim();
    const hcontent = String(d && (d.hcontent_file || d.hcontent_file_id || '') || '').trim();
    const ext = extFromUrl(fileUrl || filename, '');
    if (fileUrl && (!ext || isVideoExt(ext) || itemLooksVideo(d))) {
      return { kind: 'file_url', id, url: fileUrl, filename, ext: ext || extFromPath(filename, '.mp4') };
    }
    if (hcontent || d && d.consumer_appid) {
      return { kind: 'chunk', id, hcontent, filename, ext };
    }
    return { kind: 'unknown', id, filename, ext };
  }

  function steamKitDepotStreamingEnabled() {
    return effectiveDownloaderMode() === 'steamkit' && !!settings().steamKitDepotStreaming;
  }

  function createRemoteVideoStream(source) {
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    REMOTE_VIDEO_STREAMS.set(token, Object.assign({}, source, { createdAt: Date.now(), expiresAt: Date.now() + 20 * 60 * 1000 }));
    return token;
  }

  function createDepotVideoStream(source, info) {
    const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
    releaseOtherDepotVideoStreams(token, source && source.id);
    DEPOT_VIDEO_STREAMS.set(token, Object.assign({}, source, info || {}, {
      createdAt: Date.now(),
      expiresAt: Date.now() + 45 * 60 * 1000
    }));
    return token;
  }

  function releaseOtherDepotVideoStreams(keepToken = '', keepId = '') {
    const keepKey = String(keepToken || '');
    const keepVideoId = String(keepId || '');
    for (const [key, entry] of Array.from(DEPOT_VIDEO_STREAMS.entries())) {
      if (key === keepKey) continue;
      if (keepVideoId && String(entry && (entry.id || entry.publishedFileId) || '') === keepVideoId) continue;
      getDepotStreamService().releaseEntry(entry, 'superseded');
      DEPOT_VIDEO_STREAMS.delete(key);
    }
  }

  function releaseDepotVideoStream(token) {
    const key = String(token || '').trim();
    const entry = DEPOT_VIDEO_STREAMS.get(key);
    if (!entry) return { success: true, released: false };
    const result = getDepotStreamService().releaseEntry(entry, 'client-release');
    DEPOT_VIDEO_STREAMS.delete(key);
    return { success: true, released: true, stopped: !!result.stopped };
  }

  function releaseDepotVideoStreamUrl(streamUrl) {
    try {
      const parsed = new URL(String(streamUrl || ''), 'http://wallhub.local');
      if (parsed.pathname !== '/api/video/depot') return { success: true, released: false };
      return releaseDepotVideoStream(parsed.searchParams.get('token') || '');
    } catch {
      return { success: true, released: false };
    }
  }

  function getDepotVideoStream(token) {
    const key = String(token || '');
    const entry = DEPOT_VIDEO_STREAMS.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      DEPOT_VIDEO_STREAMS.delete(key);
      return null;
    }
    entry.expiresAt = Date.now() + 45 * 60 * 1000;
    return entry;
  }

  function getRemoteVideoStream(token) {
    const key = String(token || '');
    const entry = REMOTE_VIDEO_STREAMS.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      REMOTE_VIDEO_STREAMS.delete(key);
      return null;
    }
    return entry;
  }

  function cleanupRemoteVideoStreams() {
    const now = Date.now();
    for (const [key, entry] of REMOTE_VIDEO_STREAMS) {
      if (!entry || entry.expiresAt <= now) REMOTE_VIDEO_STREAMS.delete(key);
    }
    for (const [key, entry] of DEPOT_VIDEO_STREAMS) {
      if (!entry || entry.expiresAt <= now) DEPOT_VIDEO_STREAMS.delete(key);
    }
  }

  function getRemoteVideoStreamProxy() {
    if (!remoteVideoStreamProxy) {
      remoteVideoStreamProxy = createRemoteVideoStreamProxy({
        userAgent,
        getRemoteVideoStream,
        updateSteamCdnStatus,
        cleanupRemoteVideoStreams,
        extFromUrl,
        mimeFromExt,
        getProxyCandidates,
        isSocksProxyProtocol,
        connectViaSocksProxy,
        proxyAuth,
        jsonRes,
      });
    }
    return remoteVideoStreamProxy;
  }

  function getDepotStreamService() {
    if (!depotStreamService) {
      depotStreamService = createDepotStreamService({
        DEPOT_STREAM_PATCH_VERSION,
        DEPOT_CONFIG_DIR,
        DEPOT_STREAM_CACHE_DIR,
        DEPOT_STREAM_MAX_RANGE_BYTES,
        DEPOT_STREAM_FIRST_RANGE_BYTES,
        DEPOT_STREAM_TAIL_BYTES,
        DEPOT_STREAM_INITIAL_BUFFER_BYTES,
        DEPOT_STREAM_AHEAD_BYTES,
        DEPOT_STREAM_WORKER_IDLE_MS,
        DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK,
        DEPOT_STREAM_CACHE_CLEANUP_TARGET,
        DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS,
        depotCommandFor,
        getSteamKitStreamMaxDownloads,
        makeDepotLoginId,
        getSteamContentCellId,
        resolveDepotLogin,
        ensureDepotStreamDownloaderReady,
        ensureDir,
        runProcess,
        buildSteamContentEnv,
        buildDepotDotnetEnv,
        getSteamCdnRouteStrategy,
        updateSteamCdnStatusFromText,
        describeSteamCdnRouteStrategy,
        fmtBytes,
        getDepotStreamCacheMaxBytes,
        getDepotVideoStreams: () => DEPOT_VIDEO_STREAMS.values(),
        getDepotVideoStream,
        hasFilesRecursive,
        getVideoMime,
        steamKitNeedsOwnedAccount,
        canUseDepotLogin,
        makeSteamKitLoginRequiredError,
        normalizeDepotError,
        shouldRetrySteamLoginRequiredError,
        refreshPersistentSteamLoginForRetry,
        jsonRes,
        send,
        sleep,
      });
    }
    return depotStreamService;
  }

  async function tryCreateDepotVideoStream(source, detail) {
    if (!steamKitDepotStreamingEnabled()) return null;
    if (!source || source.kind !== 'chunk') return null;

    const id = String(source.id || (detail && detail.publishedfileid) || '').trim();
    if (!id) return null;
    const depotLogin = resolveDepotLogin(431960);
    if (steamKitNeedsOwnedAccount(431960) && !canUseDepotLogin(depotLogin)) {
      throw makeSteamKitLoginRequiredError();
    }
    try {
      const sourceEntry = Object.assign({}, source, { id, publishedFileId: id });
      let worker;
      try {
        worker = await getDepotStreamWorker(sourceEntry, depotLogin);
      } catch (workerError) {
        const err = normalizeDepotError(workerError);
        if (shouldRetrySteamLoginRequiredError && shouldRetrySteamLoginRequiredError(err) && refreshPersistentSteamLoginForRetry) {
          logger.warn(`[Depot Stream] Worker ${id} reported login required despite cached account; retrying once.`);
          const refreshed = await refreshPersistentSteamLoginForRetry(`depot-stream-worker:${id}`);
          if (refreshed) worker = await getDepotStreamWorker(sourceEntry, resolveDepotLogin(431960));
          else throw err;
        } else {
          throw err;
        }
      }
      const info = Object.assign({}, worker.info || {}, { workerKey: worker.key });
      const token = createDepotVideoStream(source, info);
      const entry = getDepotVideoStream(token);
      if (entry) scheduleDepotStreamInitialPrefetch(entry, depotLogin);
      logger.log(`[Video Source] id=${id} source=chunk/depot streaming=enabled status=ready file="${info.fileName || source.filename || ''}" size=${info.size || 0}`);
      return { streamUrl: `/api/video/depot?token=${encodeURIComponent(token)}`, info };
    } catch (e) {
      const err = normalizeDepotError(e);
      if (err && err.requiresSteamLogin) throw err;
      logger.warn(`[Video Source] id=${id} source=chunk/depot streaming=enabled status=failed error=${err.message}`);
      throw codedError(
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
    getDepotStreamService().setServerStopping(!!(getServerStopping && getServerStopping()));
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

  function proxyRemoteVideoStream(req, res, token) {
    return getRemoteVideoStreamProxy().proxy(req, res, token);
  }

  async function handleDepotVideoStream(req, res, token) {
    return getDepotStreamService().handleVideoStream(req, res, token);
  }

  async function handleDepotVideoRelease(req, res, token) {
    return jsonRes(res, 200, releaseDepotVideoStream(token));
  }

  async function handleVideoPlay(req, res, id, title) {
    let requestClosed = false;
    req.on('close', () => {
      if (!res.writableEnded) requestClosed = true;
    });
    const cancelled = () => requestClosed || res.destroyed;

    const wantId = parseInt(id);
    if (!wantId) return jsonRes(res, 400, { error: 'Invalid id' });

    const cached = findCachedVideoById(wantId);
    if (cached) {
      logger.log(`[Video Source] id=${wantId} source=local-cache path=${cached}`);
      return jsonRes(res, 200, { success: true, status: 'ready', streamUrl: '/api/video/stream?id=' + wantId });
    }

    await waitForStartupPreparationForDownload();
    if (cancelled()) return;

    let detail = null;
    try {
      const details = await getFileDetails([String(wantId)], 12000);
      detail = details && details[0] && details[0].result === 1 ? details[0] : null;
    } catch (e) {
      logger.warn(`[Video Source] id=${wantId} failed to inspect Steam file details: ${e.message}`);
    }
    if (cancelled()) return;
    if (detail) {
      const source = resolveWorkshopVideoSource(detail);
      if (source.kind === 'file_url') {
        let host = '';
        try { host = new URL(source.url).hostname; } catch {}
        const token = createRemoteVideoStream(source);
        if (host) updateSteamCdnStatus({ host, port: 443, source: 'remote', mode: 'steamkit' });
        logger.log(`[Video Source] id=${wantId} source=file_url host=${host || 'unknown'} filename="${source.filename || ''}"`);
        return jsonRes(res, 200, {
          success: true,
          status: 'ready',
          streamUrl: `/api/video/remote?token=${encodeURIComponent(token)}`,
          source: 'file_url',
          cdnHost: host || steamCdnStatusSnapshot().currentHost || ''
        });
      }
      if (source.kind === 'chunk') {
        if (steamKitDepotStreamingEnabled()) {
          const depotStream = await tryCreateDepotVideoStream(source, detail);
          if (cancelled()) {
            if (depotStream && depotStream.streamUrl) releaseDepotVideoStreamUrl(depotStream.streamUrl);
            return;
          }
          if (depotStream && depotStream.streamUrl) {
            return jsonRes(res, 200, {
              success: true,
              status: 'ready',
              streamUrl: depotStream.streamUrl,
              source: 'depot_stream',
              cdnHost: steamCdnStatusSnapshot().currentHost || ''
            });
          }
        } else {
          logger.log(`[Video Source] id=${wantId} source=chunk/depot streaming=disabled hcontent=${source.hcontent || 'none'} filename="${source.filename || ''}" fallback=download`);
        }
      } else {
        logger.log(`[Video Source] id=${wantId} source=unknown hcontent=${source.hcontent || 'none'} filename="${source.filename || ''}"`);
      }
    } else {
      logger.log(`[Video Source] id=${wantId} source=unknown detail=missing`);
    }

    if (cancelled()) return;
    const existing = getTaskQueue().find(t => String(t.id) === String(wantId));
    if (!existing) {
      try {
        await createWorkshopQueueTask(wantId, title, { isVideo: true, videoOnly: true });
      } catch (e) {
        return jsonRes(res, e.statusCode || 500, {
          error: e.message,
          code: e.code || '',
          requiresSteamLogin: !!e.requiresSteamLogin,
          requiresSteamGuard: !!e.requiresSteamGuard
        });
      }
    }

    return jsonRes(res, 200, { success: true, status: 'queued', streamUrl: '/api/video/stream?id=' + wantId });
  }

  function handleVideoStream(req, res, id) {
    const filePath = findCachedVideoById(id);
    if (!filePath) return jsonRes(res, 404, { error: 'Video not cached yet' });
    VIDEO_TASK_MAP.set(String(id), filePath);
    return streamFileWithRange(req, res, filePath);
  }

  function getDepotWorkerCount() {
    return getDepotStreamService().workers.size;
  }

  return {
    findCachedVideoById,
    steamKitDepotStreamingEnabled,
    getDepotStreamService,
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
    proxyRemoteVideoStream,
    handleDepotVideoStream,
    handleDepotVideoRelease,
    handleVideoPlay,
    handleVideoStream,
    getDepotWorkerCount,
  };
}

module.exports = {
  createVideoController,
};
