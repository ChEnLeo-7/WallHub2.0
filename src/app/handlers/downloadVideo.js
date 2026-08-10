'use strict';

function createDownloadVideoHandlers(options = {}) {
  const { getVideoController, getCacheItemsService, getDownloadsController } = options;

  return {
    proxyRemoteVideoStream: (...args) => getVideoController().proxyRemoteVideoStream(...args),
    handleDepotVideoStream: (...args) => getVideoController().handleDepotVideoStream(...args),
    handleDepotVideoRelease: (...args) => getVideoController().handleDepotVideoRelease(...args),
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
