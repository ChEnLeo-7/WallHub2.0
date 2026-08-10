'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createCacheInventory } = require('./inventory');
const { createMetadataEnricher } = require('./metadataEnrichment');
const { createCachedVideoStreamHandler } = require('./videoStream');
const { createSafeFilesystem } = require('./safeFilesystem');
const { createRuntimeResidueCleanup } = require('./runtimeResidueCleanup');

function createTempDir(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), name));
}

function hasFilesRecursive(root) {
  if (!fs.existsSync(root)) return false;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile()) return true;
    if (entry.isDirectory() && hasFilesRecursive(path.join(root, entry.name))) return true;
  }
  return false;
}

const quietLogger = { log() {}, warn() {} };

test('inventory scans visible item directories and delegates metadata enrichment', async () => {
  const root = createTempDir('wallhub-cache-inventory-');
  try {
    fs.mkdirSync(path.join(root, '123', 'nested'), { recursive: true });
    fs.writeFileSync(path.join(root, '123', 'scene.pkg'), 'abc');
    fs.writeFileSync(path.join(root, '123', 'nested', 'asset.bin'), '12345');
    fs.mkdirSync(path.join(root, '456'));
    fs.mkdirSync(path.join(root, '.wallhub-deleting-789'));
    fs.writeFileSync(path.join(root, 'not-a-directory'), 'ignored');
    let enrichedItems;
    const scan = createCacheInventory({
      getWorkshopContentDir: () => root,
      findFirstVideoInDir: dir => dir.endsWith(`${path.sep}123`) ? path.join(dir, 'video.mp4') : null,
      isSceneWorkshopDir: () => false,
      ensureDir: dir => fs.mkdirSync(dir, { recursive: true }),
      isCacheItemTombstoned: id => id === '456',
      enrichMetadata: async (items) => {
        enrichedItems = items;
        items[0].title = 'Hydrated';
      },
    });

    const items = await scan();

    assert.equal(items, enrichedItems);
    assert.equal(items.length, 1);
    assert.equal(items[0].id, 123);
    assert.equal(items[0].size, 8);
    assert.equal(items[0].title, 'Hydrated');
    assert.equal(items[0].type, 'video');
    assert.equal(items[0].canPlay, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('metadata enrichment reuses cached values and fetches only missing ids', async () => {
  const cachedItemMeta = new Map([['1', { title: 'Cached title' }]]);
  const requests = [];
  const enrich = createMetadataEnricher({
    getFileDetails: async (ids) => {
      requests.push(ids);
      return [{
        publishedfileid: '2',
        title: '  Hydrated title  ',
        preview_url: 'https://example.test/cover.jpg',
        file_size: '42',
      }];
    },
    cleanText: value => String(value || '').trim(),
    detectVideoTag: () => true,
    workshopTypeFromDetails: () => 'Video',
    cachedItemMeta,
    logger: quietLogger,
  });
  const items = [
    { id: 1, title: '1', name: '1', total: 5, size: 5, isVideo: false },
    { id: 2, title: '2', name: '2', total: 7, size: 7, isVideo: false },
  ];

  await enrich(items);
  await enrich(items);

  assert.deepEqual(requests, [['2']]);
  assert.equal(items[0].title, 'Cached title');
  assert.deepEqual(cachedItemMeta.get('2'), {
    title: 'Hydrated title',
    name: 'Hydrated title',
    coverUrl: 'https://example.test/cover.jpg',
    total: 42,
    size: 42,
    isVideo: true,
    workshopType: 'Video',
    downloaded: 42,
    canPlay: true,
  });
});

test('cached video handler rejects unavailable items before streaming a file', () => {
  const root = createTempDir('wallhub-cache-video-');
  try {
    fs.mkdirSync(path.join(root, '123'));
    const responses = [];
    const streams = [];
    let tombstoned = true;
    let videoPath = null;
    const handler = createCachedVideoStreamHandler({
      getWorkshopCacheDir: () => root,
      findFirstVideoInDir: () => videoPath,
      streamFileWithRange: (req, res, file) => streams.push({ req, res, file }),
      isCacheItemTombstoned: () => tombstoned,
      jsonRes: (res, status, body) => responses.push({ res, status, body }),
      safeNumericId: id => String(id || '').replace(/[^\d]/g, ''),
    });
    const req = {};
    const res = {};

    handler(req, res, 'invalid');
    handler(req, res, '123');
    tombstoned = false;
    handler(req, res, '456');
    handler(req, res, '123');
    videoPath = path.join(root, '123', 'video.mp4');
    handler(req, res, '123');

    assert.deepEqual(responses.map(response => response.status), [400, 404, 404, 404]);
    assert.deepEqual(responses.map(response => response.body.error), [
      'Invalid key',
      'Cached item was deleted',
      'Cached item not found',
      'Cached video not found',
    ]);
    assert.deepEqual(streams, [{ req, res, file: videoPath }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('safe filesystem deletion never removes paths outside an allowed root', () => {
  const root = createTempDir('wallhub-safe-filesystem-');
  try {
    const allowedRoot = path.join(root, 'allowed');
    const inside = path.join(allowedRoot, 'inside');
    const outside = path.join(root, 'outside');
    fs.mkdirSync(inside, { recursive: true });
    fs.mkdirSync(outside);
    const safeFilesystem = createSafeFilesystem({ logger: quietLogger });

    safeFilesystem.deletePathIfInside(inside, [allowedRoot]);
    safeFilesystem.deletePathIfInside(outside, [allowedRoot]);

    assert.equal(fs.existsSync(inside), false);
    assert.equal(fs.existsSync(outside), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('runtime residue cleanup preserves active and nonempty unfinished content', () => {
  const root = createTempDir('wallhub-runtime-residue-');
  try {
    const downloadsDir = path.join(root, 'downloads');
    const configDir = path.join(root, 'config');
    const depotRoot = path.join(configDir, 'depotdownloader', 'downloads', '431960');
    const contentRoot = path.join(configDir, 'steamapps', 'workshop', 'content', '431960');
    fs.mkdirSync(path.join(depotRoot, '100'), { recursive: true });
    fs.mkdirSync(path.join(depotRoot, '200'), { recursive: true });
    fs.mkdirSync(path.join(contentRoot, '300'), { recursive: true });
    fs.writeFileSync(path.join(contentRoot, '300', 'partial.bin'), 'data');
    fs.mkdirSync(path.join(contentRoot, '400'), { recursive: true });
    fs.mkdirSync(path.join(contentRoot, '500'), { recursive: true });
    fs.writeFileSync(path.join(contentRoot, '500', 'runtime.bin'), 'data');
    fs.mkdirSync(path.join(downloadsDir, '500'), { recursive: true });
    const safeFilesystem = createSafeFilesystem({ logger: quietLogger });
    const cleanup = createRuntimeResidueCleanup({
      getDownloadsDir: () => downloadsDir,
      getSteamKitConfigDir: () => configDir,
      hasFilesRecursive,
      currentTaskQueue: () => [
        { id: 200, status: 'downloading' },
        { id: 201, status: 'paused' },
        { id: 202, status: 'completed' },
      ],
      deletePathIfInside: safeFilesystem.deletePathIfInside,
      logger: quietLogger,
    });

    const removed = cleanup.cleanupRuntimeDownloadResidues(431960, ['200']);

    assert.equal(removed, 3);
    assert.equal(fs.existsSync(path.join(depotRoot, '100')), false);
    assert.equal(fs.existsSync(path.join(depotRoot, '200')), true);
    assert.equal(fs.existsSync(path.join(contentRoot, '300')), true);
    assert.equal(fs.existsSync(path.join(contentRoot, '400')), false);
    assert.equal(fs.existsSync(path.join(contentRoot, '500')), false);
    assert.deepEqual(cleanup.runtimeResidueKeepIds(200), [201]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
