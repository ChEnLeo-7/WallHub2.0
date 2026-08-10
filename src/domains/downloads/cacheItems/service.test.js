'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createCacheItemsService } = require('../cacheItems');

test('createCacheItemsService preserves its public API', () => {
  const service = createCacheItemsService({
    getDownloadsDir: () => '.',
    getWorkshopCacheDir: () => '.',
    getSteamKitConfigDir: () => '.',
    getTaskQueue: () => [],
    getFileDetails: async () => [],
    getWorkshopContentDir: () => '.',
    findFirstVideoInDir: () => null,
    isSceneWorkshopDir: () => false,
    cleanText: value => String(value || ''),
    detectVideoTag: () => false,
    workshopTypeFromDetails: () => '',
    streamFileWithRange: () => {},
    hasFilesRecursive: () => false,
    ensureDir: () => {},
    jsonRes: () => {},
    logger: { log() {}, warn() {} },
  });

  assert.deepEqual(Object.keys(service).sort(), [
    'cacheSnapshotInfo',
    'cachedItemMeta',
    'cleanupOrphanDepotDownloaderDownloads',
    'cleanupRuntimeDownloadResidues',
    'cleanupTaskFiles',
    'deleteCachedItemFiles',
    'deletePathIfInside',
    'deletedCacheTombstones',
    'findCachedItemDir',
    'handleCachedItemDelete',
    'handleCachedVideoStream',
    'invalidateCacheSnapshot',
    'isCacheItemTombstoned',
    'listCachedItems',
    'markCacheItemDeleted',
    'quarantinePathForBackgroundDelete',
    'removePathWithRetry',
    'runtimeResidueKeepIds',
  ]);
});
