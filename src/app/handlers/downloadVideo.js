'use strict';

function createDownloadVideoHandlers(options = {}) {
  const { getVideoController, getCacheItemsService, getDownloadsController, readBody } = options;

  async function handleDepotVideoFeedback(req, res, token) {
    const body = await readBody(req, 4096);
    let payload;
    try { payload = JSON.parse(body || '{}'); }
    catch { throw Object.assign(new Error('Invalid playback feedback JSON'), { statusCode: 400 }); }
    return getVideoController().handleDepotVideoFeedback(req, res, token, payload);
  }

  return {
    proxyRemoteVideoStream: (...args) => getVideoController().proxyRemoteVideoStream(...args),
    handleDepotVideoStream: (...args) => getVideoController().handleDepotVideoStream(...args),
    handleDepotVideoRelease: (...args) => getVideoController().handleDepotVideoRelease(...args),
    handleDepotVideoFeedback,
    handleDepotVideoFullCacheStart: (...args) => getVideoController().handleDepotVideoFullCacheStart(...args),
    handleDepotVideoFullCacheStatus: (...args) => getVideoController().handleDepotVideoFullCacheStatus(...args),
    handleDepotVideoFullCacheCancel: (...args) => getVideoController().handleDepotVideoFullCacheCancel(...args),
    handleVideoPlay: (...args) => getVideoController().handleVideoPlay(...args),
    handleVideoStream: (...args) => getVideoController().handleVideoStream(...args),
    handleCachedVideoStream: (...args) => getCacheItemsService().handleCachedVideoStream(...args),
    handleCachedItemDelete: (...args) => getCacheItemsService().handleCachedItemDelete(...args),
    handleMpkgDownload: (...args) => getDownloadsController().handleMpkgDownload(...args),
    handleMpkgPreparationStart: (...args) => getDownloadsController().handleMpkgPreparationStart(...args),
    handleMpkgPreparationStatus: (...args) => getDownloadsController().handleMpkgPreparationStatus(...args),
    handleClientDownload: (...args) => getDownloadsController().handleClientDownload(...args),
    handleDownload: (...args) => getDownloadsController().handleDownload(...args),
    listQueueItems: (...args) => getDownloadsController().listQueueItems(...args),
    handleQueueAction: (...args) => getDownloadsController().handleQueueAction(...args),
  };
}

module.exports = { createDownloadVideoHandlers };
