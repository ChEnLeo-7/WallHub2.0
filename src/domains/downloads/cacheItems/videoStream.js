'use strict';

const fs = require('fs');
const path = require('path');

function createCachedVideoStreamHandler(deps) {
  const {
    getWorkshopCacheDir,
    findFirstVideoInDir,
    streamFileWithRange,
    isCacheItemTombstoned,
    jsonRes,
    safeNumericId,
  } = deps;

  return function handleCachedVideoStream(req, res, key) {
    const safeKey = safeNumericId(key);
    if (!safeKey) return jsonRes(res, 400, { error: 'Invalid key' });
    if (isCacheItemTombstoned(safeKey)) {
      return jsonRes(res, 404, { error: 'Cached item was deleted' });
    }
    const dir = path.join(getWorkshopCacheDir(), safeKey);
    if (!fs.existsSync(dir)) return jsonRes(res, 404, { error: 'Cached item not found' });
    const video = findFirstVideoInDir(dir);
    if (!video) return jsonRes(res, 404, { error: 'Cached video not found' });
    return streamFileWithRange(req, res, video);
  };
}

module.exports = { createCachedVideoStreamHandler };
