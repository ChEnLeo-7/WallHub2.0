'use strict';

const fs = require('fs');
const path = require('path');

const { createCacheInventory } = require('./cacheItems/inventory');
const { createMetadataEnricher } = require('./cacheItems/metadataEnrichment');
const { createCachedVideoStreamHandler } = require('./cacheItems/videoStream');
const { createSafeFilesystem } = require('./cacheItems/safeFilesystem');
const { createRuntimeResidueCleanup } = require('./cacheItems/runtimeResidueCleanup');

function safeNumericId(id) {
  return String(id || '').replace(/[^\d]/g, '');
}

function createCacheItemsService(deps) {
  const {
    getWorkshopCacheDir,
    getTaskQueue,
    getMpkgBuildPromises,
    getMpkgService,
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

  function invalidateCacheSnapshot() {
    cachedItemsSnapshot = null;
    cachedItemsRevision += 1;
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

  function markCacheItemDeleted(id, ttlMs = 10 * 60 * 1000) {
    const sid = safeNumericId(id);
    if (!sid) return;
    deletedCacheTombstones.set(sid, Date.now() + ttlMs);
    cachedItemMeta.delete(sid);
    invalidateCacheSnapshot();
  }

  const enrichMetadata = createMetadataEnricher({
    getFileDetails: deps.getFileDetails,
    cleanText: deps.cleanText,
    detectVideoTag: deps.detectVideoTag,
    workshopTypeFromDetails: deps.workshopTypeFromDetails,
    cachedItemMeta,
    logger,
  });
  const scanCachedItems = createCacheInventory({
    getWorkshopContentDir: deps.getWorkshopContentDir,
    findFirstVideoInDir: deps.findFirstVideoInDir,
    isSceneWorkshopDir: deps.isSceneWorkshopDir,
    ensureDir: deps.ensureDir,
    isCacheItemTombstoned,
    enrichMetadata,
  });
  const handleCachedVideoStream = createCachedVideoStreamHandler({
    getWorkshopCacheDir,
    findFirstVideoInDir: deps.findFirstVideoInDir,
    streamFileWithRange: deps.streamFileWithRange,
    isCacheItemTombstoned,
    jsonRes,
    safeNumericId,
  });
  const safeFilesystem = createSafeFilesystem({ logger });
  const runtimeCleanup = createRuntimeResidueCleanup({
    getDownloadsDir: deps.getDownloadsDir,
    getSteamKitConfigDir: deps.getSteamKitConfigDir,
    hasFilesRecursive: deps.hasFilesRecursive,
    currentTaskQueue,
    deletePathIfInside: safeFilesystem.deletePathIfInside,
    logger,
  });

  function findCachedItemDir(id) {
    const sid = safeNumericId(id);
    if (!sid || isCacheItemTombstoned(sid)) return null;
    const dir = path.join(getWorkshopCacheDir(), sid);
    return fs.existsSync(dir) ? dir : null;
  }

  function cacheSnapshotInfo() {
    return {
      revision: cachedItemsRevision,
      updatedAt: cachedItemsSnapshot ? cachedItemsSnapshot.updatedAt : 0,
    };
  }

  async function listCachedItems(options = {}) {
    if (!options.force && cachedItemsSnapshot) return cachedItemsSnapshot.items;
    if (cachedItemsSnapshotPromise) return cachedItemsSnapshotPromise;

    const snapshotRevision = cachedItemsRevision;
    const work = scanCachedItems()
      .then((items) => {
        // Do not publish a scan invalidated while metadata was loading.
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
    const deletedOrHidden = !fs.existsSync(dir) ||
      safeFilesystem.quarantinePathForBackgroundDelete(dir, `cache-${safeKey}`);
    runtimeCleanup.cleanupTaskFiles({ id: safeKey, appId: 431960, skipFinalDownloadDir: true });
    return { success: true, pendingCleanup: !deletedOrHidden };
  }

  function handleCachedItemDelete(res, key) {
    try {
      return jsonRes(res, 200, deleteCachedItemFiles(key));
    } catch (error) {
      return jsonRes(res, error.statusCode || 500, { error: error.message });
    }
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
    removePathWithRetry: safeFilesystem.removePathWithRetry,
    quarantinePathForBackgroundDelete: safeFilesystem.quarantinePathForBackgroundDelete,
    deletePathIfInside: safeFilesystem.deletePathIfInside,
    cleanupTaskFiles: runtimeCleanup.cleanupTaskFiles,
    cleanupRuntimeDownloadResidues: runtimeCleanup.cleanupRuntimeDownloadResidues,
    cleanupOrphanDepotDownloaderDownloads: runtimeCleanup.cleanupOrphanDepotDownloaderDownloads,
    runtimeResidueKeepIds: runtimeCleanup.runtimeResidueKeepIds,
  };
}

module.exports = { createCacheItemsService };
