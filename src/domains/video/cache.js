'use strict';

function createVideoCache(deps = {}) {
  const {
    isCacheItemTombstoned,
    getDownloadQueueService,
    getWorkshopCacheDir,
    streamFileWithRange,
    jsonRes,
  } = deps;
  const videoTaskMap = new Map();

  function findCachedVideoById(id) {
    if (isCacheItemTombstoned(id)) return null;
    return getDownloadQueueService().findCachedVideoById(id, videoTaskMap, getWorkshopCacheDir());
  }

  function handleVideoStream(req, res, id) {
    const filePath = findCachedVideoById(id);
    if (!filePath) return jsonRes(res, 404, { error: 'Video not cached yet' });
    videoTaskMap.set(String(id), filePath);
    return streamFileWithRange(req, res, filePath);
  }

  return {
    findCachedVideoById,
    handleVideoStream,
  };
}

module.exports = {
  createVideoCache,
};
