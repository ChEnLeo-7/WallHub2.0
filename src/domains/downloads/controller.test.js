'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDownloadsController } = require('./controller');

function createJsonResCapture() {
  const calls = [];
  const jsonRes = (res, status, body) => {
    calls.push({ status, body });
    if (res) {
      res.status = status;
      res.body = body;
    }
    return body;
  };
  return { calls, jsonRes };
}

function createControllerHarness(queue) {
  const { calls, jsonRes } = createJsonResCapture();
  const controller = createDownloadsController({
    jsonRes,
    readBody: async (req) => JSON.stringify(req.body || {}),
    getTaskQueue: () => queue,
    getDownloadQueueService: () => ({ sanitizeTaskForList: task => task }),
    listCachedItems: async () => [],
    isCacheItemTombstoned: () => false,
    cleanupOrphanDepotDownloaderDownloads: () => {},
    cleanupTaskFiles: () => {},
    getCacheItemsService: () => ({ cachedItemMeta: new Map() }),
    triggerQueue: () => {},
    enforceTopOnlyQueueRunner: () => {},
    sleep: async () => {},
    logger: { error() {}, warn() {}, log() {} },
  });
  return { controller, calls };
}

test('queue pause live-suspends active download process without killing or aborting it', async () => {
  const events = [];
  const task = {
    id: 123,
    status: 'downloading',
    speed: 100,
    processPromise: {
      pause: () => { events.push('pause'); return true; },
      kill: () => { events.push('kill'); },
    },
    cancelFn: () => { events.push('cancel'); },
  };
  const { controller } = createControllerHarness([task]);

  await controller.handleQueueAction({ body: { action: 'pause', id: 123 } }, {});

  assert.deepEqual(events, ['pause']);
  assert.equal(task.status, 'paused');
  assert.equal(task.speed, 0);
  assert.equal(task.livePaused, true);
  assert.equal(task.processPromise != null, true);
  assert.doesNotMatch(task.progressStage, /10\s*分钟|十分钟/);
});

test('queue resume live-resumes paused download process without restarting task', async () => {
  const events = [];
  const task = {
    id: 123,
    status: 'paused',
    speed: 0,
    livePaused: true,
    processPromise: {
      resume: () => { events.push('resume'); return true; },
      kill: () => { events.push('kill'); },
    },
  };
  let triggerCalls = 0;
  const { calls, jsonRes } = createJsonResCapture();
  const controller = createDownloadsController({
    jsonRes,
    readBody: async (req) => JSON.stringify(req.body || {}),
    getTaskQueue: () => [task],
    getDownloadQueueService: () => ({ sanitizeTaskForList: item => item }),
    listCachedItems: async () => [],
    isCacheItemTombstoned: () => false,
    cleanupOrphanDepotDownloaderDownloads: () => {},
    cleanupTaskFiles: () => {},
    getCacheItemsService: () => ({ cachedItemMeta: new Map() }),
    triggerQueue: () => { triggerCalls += 1; },
    enforceTopOnlyQueueRunner: () => {},
    sleep: async () => {},
    logger: { error() {}, warn() {}, log() {} },
  });

  await controller.handleQueueAction({ body: { action: 'resume', id: 123 } }, {});

  assert.deepEqual(events, ['resume']);
  assert.equal(task.status, 'downloading');
  assert.equal(task.livePaused, false);
  assert.equal(typeof task._livePauseResumedAt, 'number');
  assert.equal(task._livePauseResumedAt > 0, true);
  assert.equal(triggerCalls, 0);
  assert.equal(calls[0].status, 200);
});

test('queue delete kills a live-paused download process before cleanup', async () => {
  const events = [];
  const task = {
    id: 123,
    status: 'paused',
    livePaused: true,
    processPromise: {
      kill: () => { events.push('kill'); },
    },
    cancelFn: () => { events.push('cancel'); },
  };
  let cleanupCalls = 0;
  const { calls, jsonRes } = createJsonResCapture();
  const controller = createDownloadsController({
    jsonRes,
    readBody: async (req) => JSON.stringify(req.body || {}),
    getTaskQueue: () => [task],
    getDownloadQueueService: () => ({ sanitizeTaskForList: item => item }),
    listCachedItems: async () => [],
    isCacheItemTombstoned: () => false,
    cleanupOrphanDepotDownloaderDownloads: () => {},
    cleanupTaskFiles: () => { cleanupCalls += 1; },
    getCacheItemsService: () => ({ cachedItemMeta: new Map() }),
    triggerQueue: () => {},
    enforceTopOnlyQueueRunner: () => {},
    sleep: async () => {},
    logger: { error() {}, warn() {}, log() {} },
  });

  await controller.handleQueueAction({ body: { action: 'delete', id: 123 } }, {});

  assert.deepEqual(events, ['kill', 'cancel']);
  assert.equal(cleanupCalls, 1);
  assert.equal(calls[0].status, 200);
});

test('queue list keeps a re-downloaded task visible while its deleted cache item is tombstoned', async () => {
  const queue = [{ id: 3750175441, status: 'pending', title: 'Re-downloaded wallpaper' }];
  const { calls, jsonRes } = createJsonResCapture();
  const controller = createDownloadsController({
    jsonRes,
    readBody: async () => '{}',
    getTaskQueue: () => queue,
    getDownloadQueueService: () => ({ sanitizeTaskForList: task => ({ ...task, source: 'queue' }) }),
    listCachedItems: async () => [],
    isCacheItemTombstoned: (id) => String(id) === '3750175441',
    cleanupOrphanDepotDownloaderDownloads: () => {},
    cleanupTaskFiles: () => {},
    getCacheItemsService: () => ({ cachedItemMeta: new Map() }),
    triggerQueue: () => {},
    enforceTopOnlyQueueRunner: () => {},
    sleep: async () => {},
    logger: { error() {}, warn() {}, log() {} },
  });

  const items = await controller.listQueueItems();

  assert.equal(calls.length, 0);
  assert.deepEqual(items.map(item => item.id), [3750175441]);
  assert.equal(items[0].source, 'queue');
});

test('live pause expires after the configured ten-minute window and switches to validation resume', async () => {
  const events = [];
  let expire = null;
  const task = {
    id: 123,
    status: 'downloading',
    speed: 100,
    processPromise: {
      pause: () => { events.push('pause'); return true; },
      kill: () => { events.push('kill'); },
    },
    cancelFn: () => { events.push('cancel'); },
  };
  const { jsonRes } = createJsonResCapture();
  const controller = createDownloadsController({
    jsonRes,
    readBody: async (req) => JSON.stringify(req.body || {}),
    getTaskQueue: () => [task],
    getDownloadQueueService: () => ({ sanitizeTaskForList: item => item }),
    listCachedItems: async () => [],
    isCacheItemTombstoned: () => false,
    cleanupOrphanDepotDownloaderDownloads: () => {},
    cleanupTaskFiles: () => {},
    getCacheItemsService: () => ({ cachedItemMeta: new Map() }),
    triggerQueue: () => {},
    enforceTopOnlyQueueRunner: () => {},
    sleep: async () => {},
    livePauseMaxMs: 10 * 60 * 1000,
    setTimeoutFn: (fn, delay) => {
      assert.equal(delay, 10 * 60 * 1000);
      expire = fn;
      return { unref() {} };
    },
    clearTimeoutFn: () => {},
    logger: { error() {}, warn() {}, log() {} },
  });

  await controller.handleQueueAction({ body: { action: 'pause', id: 123 } }, {});
  assert.equal(typeof expire, 'function');
  expire();

  assert.deepEqual(events, ['pause', 'kill', 'cancel']);
  assert.equal(task.status, 'paused');
  assert.equal(task.livePaused, false);
  assert.equal(task.progressIndeterminate, true);
  assert.match(task.progressStage, /校验/);
});

test('MPKG probe and prepared-token handoff log debug boundaries without logging the token', async () => {
  const logs = [];
  const { calls, jsonRes } = createJsonResCapture();
  let preparedStreamOptions = null;
  const controller = createDownloadsController({
    jsonRes,
    readBody: async () => '{}',
    getTaskQueue: () => [],
    getDownloadQueueService: () => ({ sanitizeTaskForList: task => task }),
    listCachedItems: async () => [],
    isCacheItemTombstoned: () => false,
    cleanupOrphanDepotDownloaderDownloads: () => {},
    cleanupTaskFiles: () => {},
    getCacheItemsService: () => ({ cachedItemMeta: new Map() }),
    triggerQueue: () => {},
    enforceTopOnlyQueueRunner: () => {},
    sleep: async () => {},
    isDebugEnabled: () => true,
    logger: { error() {}, warn: (msg) => logs.push(String(msg)), log: (msg) => logs.push(String(msg)) },
    prepareMpkgDownloadFile: async () => ({ filePath: '/tmp/123.mpkg', fileName: '123.mpkg', deleteAfterSend: false }),
    createPreparedDownload: () => 'opaque-prepared-token',
    sendPreparedDownload: (req, res, token, options) => {
      preparedStreamOptions = options;
      options.onDebug('stream test boundary');
      return { token };
    },
    sendDownloadFile: () => {},
  });

  await controller.handleMpkgDownload({ url: '/api/mpkg/download?id=123&title=demo&probe=1' }, {}, '123', 'demo');
  await controller.handleMpkgDownload({ url: '/api/mpkg/download?token=opaque-prepared-token' }, {}, '', '');

  assert.equal(calls[0].status, 200);
  assert.match(calls[0].body.downloadUrl, /opaque-prepared-token/);
  assert.equal(typeof preparedStreamOptions?.onDebug, 'function');
  assert.ok(logs.some(line => line.includes('[MPKG] Debug request phase=probe id=123')));
  assert.ok(logs.some(line => line.includes('[MPKG] Debug prepared file id=123 filename=123.mpkg')));
  assert.ok(logs.some(line => line.includes('[MPKG] Debug request phase=prepared-token')));
  assert.ok(logs.some(line => line.includes('[MPKG] Debug stream test boundary')));
  assert.doesNotMatch(logs.join('\n'), /opaque-prepared-token/);
});

test('MPKG preparation polling returns elapsed wait time without a server file path', async () => {
  const { calls, jsonRes } = createJsonResCapture();
  const job = {
    id: '3750175441',
    status: 'preparing',
    stage: 'converting',
    elapsedMs: 5_400,
    filePath: 'F:\\private\\Downloads\\3750175441\\Mpkg\\3750175441.mpkg',
  };
  const controller = createDownloadsController({
    jsonRes,
    getMpkgPreparation: () => job,
    serializeMpkgPreparation: (value) => ({
      id: value.id,
      status: value.status,
      stage: value.stage,
      elapsedMs: value.elapsedMs,
    }),
  });

  await controller.handleMpkgPreparationStatus({}, {}, '3750175441', 'Slow wallpaper');

  assert.equal(calls[0].status, 202);
  assert.deepEqual(calls[0].body, {
    success: true,
    id: '3750175441',
    status: 'preparing',
    stage: 'converting',
    elapsedMs: 5_400,
  });
  assert.equal(JSON.stringify(calls[0].body).includes('private'), false);
});

test('MPKG preparation hands a ready file to the browser through a prepared token without re-preparing it', async () => {
  const { calls, jsonRes } = createJsonResCapture();
  let job = { id: '123', status: 'preparing' };
  let started = 0;
  let preparedDownloadArgs = null;
  const controller = createDownloadsController({
    jsonRes,
    startMpkgPreparation: (id, title, profile) => {
      started += 1;
      assert.equal(id, '123');
      assert.equal(title, 'Demo');
      assert.equal(profile, 'compact');
      return job;
    },
    getMpkgPreparation: (id, profile) => {
      assert.equal(id, '123');
      assert.equal(profile, 'compact');
      return job;
    },
    serializeMpkgPreparation: (value) => value,
    createPreparedDownload: (filePath, fileName, options) => {
      preparedDownloadArgs = { filePath, fileName, options };
      return 'ready-download-token';
    },
  });

  await controller.handleMpkgPreparationStart({}, {}, '123', 'Demo', 'compact');
  assert.equal(started, 1);
  assert.equal(calls[0].status, 202);
  assert.deepEqual(calls[0].body, { success: true, id: '123', status: 'preparing' });

  job = {
    id: '123',
    status: 'ready',
    filePath: 'F:\\private\\123.mpkg',
    fileName: '123.mpkg',
  };
  await controller.handleMpkgPreparationStatus({}, {}, '123', 'Demo', 'compact');

  assert.equal(calls[1].status, 200);
  assert.equal(calls[1].body.status, 'ready');
  assert.equal(calls[1].body.downloadUrl, '/api/mpkg/download?token=ready-download-token');
  assert.deepEqual(preparedDownloadArgs, {
    filePath: 'F:\\private\\123.mpkg',
    fileName: '123.mpkg',
    options: { deleteAfterSend: false },
  });
  assert.equal(JSON.stringify(calls[1].body).includes('private'), false);
});

test('MPKG preparation fallback download URL retains the selected texture profile', async () => {
  const { calls, jsonRes } = createJsonResCapture();
  const job = {
    id: '123',
    status: 'ready',
    filePath: 'F:\\private\\123.compact.mpkg',
    fileName: '123.compact.mpkg',
  };
  const controller = createDownloadsController({
    jsonRes,
    startMpkgPreparation: () => job,
    serializeMpkgPreparation: value => value,
    createPreparedDownload: () => { throw new Error('token store unavailable'); },
  });

  await controller.handleMpkgPreparationStart({}, {}, '123', 'Demo', 'compact');

  assert.equal(calls[0].status, 200);
  assert.match(calls[0].body.downloadUrl, /[?&]profile=compact(?:&|$)/);
});
