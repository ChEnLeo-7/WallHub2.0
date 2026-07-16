'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function safeNumericId(id) {
  return String(id || '').replace(/[^\d]/g, '');
}

function createCacheItemsService(deps) {
  const {
    getDownloadsDir,
    getWorkshopCacheDir,
    getSteamKitConfigDir,
    getTaskQueue,
    getMpkgBuildPromises,
    getMpkgService,
    getFileDetails,
    getWorkshopContentDir,
    findFirstVideoInDir,
    isSceneWorkshopDir,
    cleanText,
    detectVideoTag,
    workshopTypeFromDetails,
    streamFileWithRange,
    hasFilesRecursive,
    ensureDir,
    jsonRes,
    logger = console,
  } = deps;

  const cachedItemMeta = new Map();
  const deletedCacheTombstones = new Map();
  let cachedItemsSnapshot = null;
  let cachedItemsSnapshotPromise = null;
  let cachedItemsRevision = 0;

  function currentTaskQueue() {
    const queue = getTaskQueue && getTaskQueue();
    return Array.isArray(queue) ? queue : [];
  }

  function findCachedItemDir(id) {
    const sid = safeNumericId(id);
    if (!sid || isCacheItemTombstoned(sid)) return null;
    const dir = path.join(getWorkshopCacheDir(), sid);
    return fs.existsSync(dir) ? dir : null;
  }

  function markCacheItemDeleted(id, ttlMs = 10 * 60 * 1000) {
    const sid = safeNumericId(id);
    if (!sid) return;
    deletedCacheTombstones.set(sid, Date.now() + ttlMs);
    cachedItemMeta.delete(sid);
    invalidateCacheSnapshot();
  }

  function isCacheItemTombstoned(id) {
    const sid = safeNumericId(id);
    if (!sid) return false;
    const expiresAt = deletedCacheTombstones.get(sid);
    if (!expiresAt) return false;
    if (expiresAt <= Date.now()) {
      deletedCacheTombstones.delete(sid);
      return false;
    }
    return true;
  }

  function invalidateCacheSnapshot() {
    cachedItemsSnapshot = null;
    cachedItemsRevision += 1;
  }

  function cacheSnapshotInfo() {
    return {
      revision: cachedItemsRevision,
      updatedAt: cachedItemsSnapshot ? cachedItemsSnapshot.updatedAt : 0,
    };
  }

  async function scanCachedItems() {
    ensureDir(getWorkshopContentDir(431960));
    const items = [];
    const root = getWorkshopContentDir(431960);
    for (const name of fs.readdirSync(root)) {
      if (String(name || '').startsWith('.wallhub-deleting-')) continue;
      if (isCacheItemTombstoned(name)) continue;
      const full = path.join(root, name);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (!st.isDirectory()) continue;
      const itemId = String(name);
      const videoPath = findFirstVideoInDir(full);
      let totalSize = 0;
      const stack = [full];
      while (stack.length) {
        const dir = stack.pop();
        let ents = [];
        try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
        for (const ent of ents) {
          const fp = path.join(dir, ent.name);
          if (ent.isDirectory()) stack.push(fp);
          else if (ent.isFile()) {
            try { totalSize += fs.statSync(fp).size; } catch {}
          }
        }
      }
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
        mtime: st.mtimeMs || 0,
        addTime: st.mtimeMs || 0,
        status: 'completed',
        type: videoPath ? 'video' : 'folder',
        isVideo: !!videoPath,
        workshopType: isSceneWorkshopDir(full) ? 'Scene' : (videoPath ? 'Video' : ''),
        canPlay: !!videoPath
      });
    }

    const ids = items.map(item => String(item.id)).filter(Boolean);
    for (const item of items) {
      const cached = cachedItemMeta.get(String(item.id));
      if (cached) Object.assign(item, cached);
    }
    const missingIds = ids.filter(id => !cachedItemMeta.has(id));
    if (missingIds.length) {
      try {
        const details = await getFileDetails(missingIds);
        const detailMap = {};
        for (const detail of details || []) {
          if (detail && detail.publishedfileid) detailMap[String(detail.publishedfileid)] = detail;
        }
        for (const item of items) {
          const detail = detailMap[String(item.id)];
          if (!detail) continue;
          const hydrated = {
            title: cleanText(detail.title) || item.title,
            name: cleanText(detail.title) || item.name,
            coverUrl: String(detail.preview_url || ''),
            total: parseInt(detail.file_size, 10) || item.total,
            size: parseInt(detail.file_size, 10) || item.size,
            isVideo: item.isVideo || detectVideoTag(detail),
            workshopType: workshopTypeFromDetails(detail),
          };
          hydrated.downloaded = hydrated.total;
          hydrated.canPlay = !!hydrated.isVideo;
          cachedItemMeta.set(String(item.id), hydrated);
          Object.assign(item, hydrated);
        }
      } catch (error) {
        logger.warn('[Cache] Failed to hydrate cached item metadata:', error.message);
      }
    }
    items.sort((a, b) => b.mtime - a.mtime);
    return items;
  }

  async function listCachedItems(options = {}) {
    if (!options.force && cachedItemsSnapshot) return cachedItemsSnapshot.items;
    if (cachedItemsSnapshotPromise) return cachedItemsSnapshotPromise;

    const snapshotRevision = cachedItemsRevision;
    const work = scanCachedItems()
      .then((items) => {
        // A delete or completed download can happen while metadata is being
        // hydrated. Do not publish that stale scan as the next library view.
        if (snapshotRevision === cachedItemsRevision) {
          cachedItemsSnapshot = { items, updatedAt: Date.now() };
        }
        return items;
      })
      .finally(() => {
        if (cachedItemsSnapshotPromise === work) cachedItemsSnapshotPromise = null;
      });
    cachedItemsSnapshotPromise = work;
    return work;
  }

  function handleCachedVideoStream(req, res, key) {
    const safeKey = safeNumericId(key);
    if (!safeKey) return jsonRes(res, 400, { error: 'Invalid key' });
    if (isCacheItemTombstoned(safeKey)) return jsonRes(res, 404, { error: 'Cached item was deleted' });
    const dir = path.join(getWorkshopCacheDir(), safeKey);
    if (!fs.existsSync(dir)) return jsonRes(res, 404, { error: 'Cached item not found' });
    const video = findFirstVideoInDir(dir);
    if (!video) return jsonRes(res, 404, { error: 'Cached video not found' });
    return streamFileWithRange(req, res, video);
  }

  function deleteCachedItemFiles(key) {
    const safeKey = safeNumericId(key);
    if (!safeKey) {
      const error = new Error('Invalid key');
      error.statusCode = 400;
      throw error;
    }
    const dir = path.join(getWorkshopCacheDir(), safeKey);
    const activeMpkgKey = `${path.resolve(dir)}|${safeKey}`;
    const localBuildPromises = getMpkgBuildPromises && getMpkgBuildPromises();
    const mpkgService = getMpkgService && getMpkgService();
    if ((localBuildPromises && localBuildPromises.has(activeMpkgKey)) ||
        (mpkgService && mpkgService.buildPromises && mpkgService.buildPromises.has(activeMpkgKey))) {
      const error = new Error('MPKG 正在转换，请等待完成后再删除项目');
      error.statusCode = 409;
      error.code = 'MPKG_BUILDING';
      throw error;
    }
    markCacheItemDeleted(safeKey);
    const queue = currentTaskQueue();
    for (let index = queue.length - 1; index >= 0; index--) {
      const task = queue[index];
      if (String(task.id) !== safeKey) continue;
      if (['completed', 'cancelled', 'error'].includes(String(task.status || '')) || task.source === 'cache') {
        queue.splice(index, 1);
      }
    }
    const deletedOrHidden = !fs.existsSync(dir) || quarantinePathForBackgroundDelete(dir, `cache-${safeKey}`);
    cleanupTaskFiles({ id: safeKey, appId: 431960, skipFinalDownloadDir: true });
    return { success: true, pendingCleanup: !deletedOrHidden };
  }

  function handleCachedItemDelete(res, key) {
    try {
      const result = deleteCachedItemFiles(key);
      return jsonRes(res, 200, result);
    } catch (error) {
      return jsonRes(res, error.statusCode || 500, { error: error.message });
    }
  }

  function removePathWithRetry(target) {
    if (!target || !fs.existsSync(target)) return;
    const resolved = path.resolve(target);
    const remove = () => {
      if (!fs.existsSync(resolved)) return;
      const st = fs.statSync(resolved);
      if (st.isDirectory()) fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 1, retryDelay: 80 });
      else fs.rmSync(resolved, { force: true, maxRetries: 1, retryDelay: 80 });
    };
    try {
      remove();
    } catch (error) {
      logger.warn('[Cleanup] Immediate cleanup failed:', error.message);
    }
    if (!fs.existsSync(resolved)) return;
    const delays = [500, 1500, 3500, 7000, 15000, 30000];
    delays.forEach(delay => {
      setTimeout(() => {
        try { remove(); }
        catch (error) { logger.warn(`[Cleanup] Delayed cleanup failed after ${delay}ms:`, error.message); }
      }, delay).unref?.();
    });
  }

  function quarantinePathForBackgroundDelete(target, label = 'delete') {
    if (!target || !fs.existsSync(target)) return true;
    const resolved = path.resolve(target);
    const parent = path.dirname(resolved);
    const base = path.basename(resolved);
    const hiddenName = `.wallhub-deleting-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const hidden = path.join(parent, hiddenName);
    try {
      fs.renameSync(resolved, hidden);
      logger.log(`[Cleanup] Moved ${label} to background cleanup: ${hidden}`);
      removePathWithRetry(hidden);
      return true;
    } catch (error) {
      logger.warn(`[Cleanup] Failed to quarantine ${label}:`, error.message);
      removePathWithRetry(resolved);
      return !fs.existsSync(resolved);
    }
  }

  function deletePathIfInside(target, allowedRoots) {
    if (!target) return;
    const resolved = path.resolve(target);
    const allowed = allowedRoots
      .map(root => path.resolve(root))
      .some(root => resolved === root || resolved.startsWith(root + path.sep));
    if (!allowed || !fs.existsSync(resolved)) return;
    removePathWithRetry(resolved);
  }

  function cleanupTaskFiles(task) {
    const targetId = String(task.id);
    const appId = String(task.appId || 431960);
    const downloadsDir = getDownloadsDir();
    const steamKitConfigDir = getSteamKitConfigDir();
    const steamKitWsDir = path.join(steamKitConfigDir, 'steamapps', 'workshop');
    const steamKitDepotDownloadsDir = path.join(steamKitConfigDir, 'depotdownloader', 'downloads');
    const allowedRoots = [downloadsDir, steamKitWsDir, os.tmpdir(), steamKitConfigDir];

    deletePathIfInside(task.outputPath, allowedRoots);
    deletePathIfInside(task.filePath, allowedRoots);
    if (!task.skipFinalDownloadDir) deletePathIfInside(path.join(downloadsDir, targetId), allowedRoots);
    deletePathIfInside(path.join(steamKitDepotDownloadsDir, appId, targetId), allowedRoots);
    deletePathIfInside(path.join(steamKitWsDir, 'downloads', appId, targetId), allowedRoots);
    deletePathIfInside(path.join(steamKitWsDir, 'content', appId, targetId), allowedRoots);
    deletePathIfInside(path.join(steamKitWsDir, 'temp', appId, targetId), allowedRoots);

    const depotAppDir = path.join(steamKitDepotDownloadsDir, appId);
    if (fs.existsSync(depotAppDir) && fs.readdirSync(depotAppDir).length === 0) {
      try { fs.rmdirSync(depotAppDir); } catch {}
    }

    const dlRoot = path.join(steamKitWsDir, 'downloads');
    if (fs.existsSync(dlRoot)) {
      for (const fileName of fs.readdirSync(dlRoot)) {
        if (fileName.endsWith('.patch') && fileName.includes(targetId)) {
          deletePathIfInside(path.join(dlRoot, fileName), allowedRoots);
        }
      }
    }

    const appWorkshopFile = path.join(steamKitWsDir, `appworkshop_${appId}.acf`);
    const hasOtherActiveSameApp = currentTaskQueue().some(activeTask =>
      String(activeTask.id) !== targetId &&
      String(activeTask.appId || 431960) === appId &&
      ['pending', 'downloading', 'paused'].includes(String(activeTask.status || ''))
    );
    if (!hasOtherActiveSameApp && fs.existsSync(appWorkshopFile)) {
      try {
        const text = fs.readFileSync(appWorkshopFile, 'utf8');
        if (text.includes(targetId)) deletePathIfInside(appWorkshopFile, allowedRoots);
      } catch {}
    }

    const dlAppDir = path.join(steamKitWsDir, 'downloads', appId);
    if (fs.existsSync(dlAppDir) && fs.readdirSync(dlAppDir).length === 0) {
      try { fs.rmdirSync(dlAppDir); } catch {}
    }
  }

  function removeEmptyParents(startDir, stopDir) {
    let current = path.resolve(startDir || '');
    const stop = path.resolve(stopDir || '');
    while (current && current !== stop && current.startsWith(stop + path.sep)) {
      try {
        if (!fs.existsSync(current) || fs.readdirSync(current).length > 0) break;
        fs.rmdirSync(current);
      } catch {
        break;
      }
      current = path.dirname(current);
    }
  }

  function cleanupRuntimeDownloadChildren(root, options = {}) {
    const resolvedRoot = path.resolve(root || '');
    if (!resolvedRoot || !fs.existsSync(resolvedRoot)) return 0;
    const keep = new Set(Array.from(options.keepIds || []).map(id => String(id)));
    const allowedRoots = (options.allowedRoots || [resolvedRoot]).map(item => path.resolve(item));
    let removed = 0;
    let ents = [];
    try { ents = fs.readdirSync(resolvedRoot, { withFileTypes: true }); } catch { return 0; }
    for (const ent of ents) {
      if (!ent.isDirectory() || !/^\d+$/.test(ent.name)) continue;
      if (keep.has(ent.name)) continue;
      const full = path.join(resolvedRoot, ent.name);
      const finalDir = path.join(getDownloadsDir(), ent.name);
      const shouldDelete = !!options.deleteAll || fs.existsSync(finalDir) || !hasFilesRecursive(full);
      if (!shouldDelete) continue;
      try {
        deletePathIfInside(full, allowedRoots);
        removed++;
      } catch (error) {
        logger.warn(`[Cleanup] Failed to remove runtime residue ${full}:`, error.message);
      }
    }
    removeEmptyParents(resolvedRoot, path.dirname(resolvedRoot));
    return removed;
  }

  function cleanupRuntimeDownloadResidues(appId = 431960, keepIds = []) {
    const app = String(appId || 431960);
    const keep = new Set(Array.from(keepIds || []).map(id => String(id)));
    const steamKitConfigDir = getSteamKitConfigDir();
    let removed = 0;
    const specs = [
      {
        root: path.join(steamKitConfigDir, 'depotdownloader', 'downloads', app),
        allowedRoots: [steamKitConfigDir],
        deleteAll: true
      },
      {
        root: path.join(steamKitConfigDir, 'steamapps', 'workshop', 'downloads', app),
        allowedRoots: [steamKitConfigDir],
        deleteAll: true
      },
      {
        root: path.join(steamKitConfigDir, 'steamapps', 'workshop', 'content', app),
        allowedRoots: [steamKitConfigDir],
        deleteAll: false
      },
    ];
    for (const spec of specs) {
      removed += cleanupRuntimeDownloadChildren(spec.root, {
        keepIds: keep,
        allowedRoots: spec.allowedRoots,
        deleteAll: spec.deleteAll
      });
    }
    if (removed > 0) logger.log(`[Cleanup] Removed ${removed} runtime workshop residue director${removed === 1 ? 'y' : 'ies'}`);
    return removed;
  }

  function cleanupOrphanDepotDownloaderDownloads(appId, keepIds) {
    const app = String(appId || 431960);
    const keep = new Set(Array.from(keepIds || []).map(id => String(id)));
    const steamKitConfigDir = getSteamKitConfigDir();
    const root = path.join(steamKitConfigDir, 'depotdownloader', 'downloads', app);
    if (!fs.existsSync(root)) return;
    const allowedRoots = [steamKitConfigDir];
    for (const name of fs.readdirSync(root)) {
      const full = path.join(root, name);
      let st;
      try { st = fs.statSync(full); } catch { continue; }
      if (!st.isDirectory()) continue;
      if (keep.has(String(name))) continue;
      deletePathIfInside(full, allowedRoots);
    }
    try {
      if (fs.existsSync(root) && fs.readdirSync(root).length === 0) fs.rmdirSync(root);
    } catch {}
  }

  function runtimeResidueKeepIds(excludeId = '') {
    const excluded = String(excludeId || '');
    return currentTaskQueue()
      .filter(task => String(task.id) !== excluded)
      .filter(task => ['pending', 'downloading', 'paused'].includes(String(task.status || '')))
      .map(task => task.id);
  }

  return {
    cachedItemMeta,
    deletedCacheTombstones,
    invalidateCacheSnapshot,
    cacheSnapshotInfo,
    findCachedItemDir,
    markCacheItemDeleted,
    isCacheItemTombstoned,
    listCachedItems,
    handleCachedVideoStream,
    deleteCachedItemFiles,
    handleCachedItemDelete,
    removePathWithRetry,
    quarantinePathForBackgroundDelete,
    deletePathIfInside,
    cleanupTaskFiles,
    cleanupRuntimeDownloadResidues,
    cleanupOrphanDepotDownloaderDownloads,
    runtimeResidueKeepIds,
  };
}

module.exports = { createCacheItemsService };
