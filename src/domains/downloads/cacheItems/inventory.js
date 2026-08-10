'use strict';

const fs = require('fs');
const path = require('path');

function directorySize(root) {
  let totalSize = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) stack.push(full);
      else if (entry.isFile()) {
        try { totalSize += fs.statSync(full).size; } catch {}
      }
    }
  }
  return totalSize;
}

function createCacheInventory(deps) {
  const {
    getWorkshopContentDir,
    findFirstVideoInDir,
    isSceneWorkshopDir,
    ensureDir,
    isCacheItemTombstoned,
    enrichMetadata,
  } = deps;

  return async function scanCachedItems() {
    const root = getWorkshopContentDir(431960);
    ensureDir(root);
    const items = [];

    for (const name of fs.readdirSync(root)) {
      if (String(name || '').startsWith('.wallhub-deleting-')) continue;
      if (isCacheItemTombstoned(name)) continue;
      const full = path.join(root, name);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (!stat.isDirectory()) continue;

      const itemId = String(name);
      const videoPath = findFirstVideoInDir(full);
      const totalSize = directorySize(full);
      items.push({
        source: 'cache',
        key: itemId,
        id: parseInt(itemId, 10) || itemId,
        cacheKey: itemId,
        appId: 431960,
        name: itemId,
        title: itemId,
        size: totalSize || 0,
        total: totalSize || 0,
        downloaded: totalSize || 0,
        progress: 100,
        speed: 0,
        mtime: stat.mtimeMs || 0,
        addTime: stat.mtimeMs || 0,
        status: 'completed',
        type: videoPath ? 'video' : 'folder',
        isVideo: !!videoPath,
        workshopType: isSceneWorkshopDir(full) ? 'Scene' : (videoPath ? 'Video' : ''),
        canPlay: !!videoPath,
      });
    }

    await enrichMetadata(items);
    items.sort((a, b) => b.mtime - a.mtime);
    return items;
  };
}

module.exports = { createCacheInventory };
