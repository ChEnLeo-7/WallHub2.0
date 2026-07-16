'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createCacheItemsService } = require('./cacheItems');

function createService(root) {
  return createCacheItemsService({
    getDownloadsDir: () => root,
    getWorkshopCacheDir: () => root,
    getSteamKitConfigDir: () => root,
    getTaskQueue: () => [],
    getMpkgBuildPromises: () => new Map(),
    getMpkgService: () => ({ buildPromises: new Map() }),
    getFileDetails: async () => [],
    getWorkshopContentDir: () => root,
    findFirstVideoInDir: () => null,
    isSceneWorkshopDir: () => false,
    cleanText: (value) => String(value || ''),
    detectVideoTag: () => false,
    workshopTypeFromDetails: () => '',
    streamFileWithRange: () => {},
    hasFilesRecursive: () => false,
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    jsonRes: () => {},
    logger: { warn() {}, log() {} },
  });
}

test('cached-item list reuses its snapshot until a download or delete invalidates it', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-cache-items-'));
  try {
    const itemDir = path.join(root, '123');
    fs.mkdirSync(itemDir, { recursive: true });
    fs.writeFileSync(path.join(itemDir, 'scene.pkg'), 'content');
    const service = createService(root);

    const first = await service.listCachedItems();
    fs.rmSync(itemDir, { recursive: true, force: true });
    const cached = await service.listCachedItems();
    service.invalidateCacheSnapshot();
    const refreshed = await service.listCachedItems();

    assert.equal(first, cached);
    assert.equal(cached.length, 1);
    assert.deepEqual(refreshed, []);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
