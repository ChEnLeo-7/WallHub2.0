'use strict';

const { createVideoCache } = require('./cache');
const { createVideoDepot } = require('./depot');
const { createRemoteVideoPreparation } = require('./remotePreparation');
const { createVideoSourceSelector } = require('./sourceSelection');
const { createVideoTokenRegistry } = require('./tokenRegistry');

function createVideoController(deps = {}) {
  const { jsonRes, logger = console } = deps;
  let depot;
  const registry = createVideoTokenRegistry({
    releaseDepotEntry: (entry, reason) => depot.getDepotStreamService().releaseEntry(entry, reason),
  });
  depot = createVideoDepot(Object.assign({}, deps, { registry }));
  const cache = createVideoCache({
    isCacheItemTombstoned: deps.isCacheItemTombstoned,
    getDownloadQueueService: deps.getDownloadQueueService,
    getWorkshopCacheDir: deps.getWorkshopCacheDir,
    streamFileWithRange: depot.streamFileWithRange,
    jsonRes,
  });
  const sourceSelector = createVideoSourceSelector({
    detectVideoTag: deps.detectVideoTag,
    isVideoExt: deps.isVideoExt,
    extFromUrl: deps.extFromUrl,
    extFromPath: deps.extFromPath,
  });
  const remotePreparation = createRemoteVideoPreparation(Object.assign({}, deps, { registry }));
  let videoPlayDemandGeneration = 0;

  async function handleVideoPlay(req, res, id, title) {
    const demandGeneration = ++videoPlayDemandGeneration;
    let requestClosed = false;
    req.on('close', () => {
      if (!res.writableEnded) requestClosed = true;
    });
    const cancelled = () => (
      requestClosed
      || res.destroyed
      || demandGeneration !== videoPlayDemandGeneration
    );

    const wantId = parseInt(id);
    if (!wantId) return jsonRes(res, 400, { error: 'Invalid id' });

    const cached = cache.findCachedVideoById(wantId);
    if (cached) {
      logger.log(`[Video Source] id=${wantId} source=local-cache path=${cached}`);
      return jsonRes(res, 200, {
        success: true,
        status: 'ready',
        streamUrl: '/api/video/stream?id=' + wantId,
      });
    }

    await deps.waitForStartupPreparationForDownload();
    if (cancelled()) return;

    let detail = null;
    try {
      const details = await deps.getFileDetails([String(wantId)], 12000);
      detail = details && details[0] && details[0].result === 1 ? details[0] : null;
    } catch (error) {
      logger.warn(`[Video Source] id=${wantId} failed to inspect Steam file details: ${error.message}`);
    }
    if (cancelled()) return;

    if (detail) {
      const source = sourceSelector.resolve(detail);
      if (source.kind === 'file_url') {
        return jsonRes(res, 200, remotePreparation.prepare(source, wantId));
      }
      if (source.kind === 'chunk') {
        if (depot.steamKitDepotStreamingEnabled()) {
          const depotStream = await depot.tryCreateVideoStream(source, detail, cancelled);
          if (cancelled()) {
            if (depotStream && depotStream.streamUrl) depot.releaseVideoStreamUrl(depotStream.streamUrl);
            return;
          }
          if (depotStream && depotStream.streamUrl) {
            return jsonRes(res, 200, {
              success: true,
              status: 'ready',
              streamUrl: depotStream.streamUrl,
              source: 'depot_stream',
              cdnHost: deps.steamCdnStatusSnapshot().currentHost || '',
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
    const existing = deps.getTaskQueue().find(task => String(task.id) === String(wantId));
    if (!existing) {
      try {
        await deps.createWorkshopQueueTask(wantId, title, { isVideo: true, videoOnly: true });
      } catch (error) {
        return jsonRes(res, error.statusCode || 500, {
          error: error.message,
          code: error.code || '',
          requiresSteamLogin: !!error.requiresSteamLogin,
          requiresSteamGuard: !!error.requiresSteamGuard,
        });
      }
    }

    return jsonRes(res, 200, {
      success: true,
      status: 'queued',
      streamUrl: '/api/video/stream?id=' + wantId,
    });
  }

  return {
    findCachedVideoById: cache.findCachedVideoById,
    steamKitDepotStreamingEnabled: depot.steamKitDepotStreamingEnabled,
    getDepotStreamService: depot.getDepotStreamService,
    buildDepotStreamArgs: depot.buildDepotStreamArgs,
    getDepotVideoStreamInfo: depot.getDepotVideoStreamInfo,
    streamFileWithRange: depot.streamFileWithRange,
    normalizeDepotStreamRange: depot.normalizeDepotStreamRange,
    findDepotStreamCachedRange: depot.findDepotStreamCachedRange,
    pipeDepotStreamCachedRange: depot.pipeDepotStreamCachedRange,
    stopAllDepotStreamWorkers: depot.stopAllDepotStreamWorkers,
    getDepotStreamWorker: depot.getDepotStreamWorker,
    ensureDepotStreamRangeCached: depot.ensureDepotStreamRangeCached,
    scheduleDepotStreamInitialPrefetch: depot.scheduleDepotStreamInitialPrefetch,
    scheduleDepotStreamAheadPrefetch: depot.scheduleDepotStreamAheadPrefetch,
    cleanupDepotStreamCache: depot.cleanupDepotStreamCache,
    scheduleDepotStreamCacheCleanup: depot.scheduleDepotStreamCacheCleanup,
    maybeScheduleDepotStreamCacheCleanupAfterWrite: depot.maybeScheduleDepotStreamCacheCleanupAfterWrite,
    getDepotStreamCacheStats: depot.getDepotStreamCacheStats,
    clearDepotStreamCacheNow: depot.clearDepotStreamCacheNow,
    proxyRemoteVideoStream: remotePreparation.proxy,
    handleDepotVideoStream: depot.handleDepotVideoStream,
    handleDepotVideoRelease: depot.handleDepotVideoRelease,
    handleVideoPlay,
    handleVideoStream: cache.handleVideoStream,
    getDepotWorkerCount: depot.getDepotWorkerCount,
  };
}

module.exports = {
  createVideoController,
};
