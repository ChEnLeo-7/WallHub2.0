'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDownloadQueueService } = require('./queue');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function createService(overrides = {}) {
  return createDownloadQueueService(Object.assign({
    getMaxConcurrentDownloads: () => 0,
    getFileDetails: async (ids) => ids.map(id => ({
      result: 1,
      publishedfileid: id,
      title: `Item ${id}`,
      file_size: 100,
      consumer_appid: 431960,
    })),
    safeName: value => String(value || ''),
    detectVideoTag: () => false,
    workshopTypeFromDetails: () => 'scene',
    downloadWorkshopItem: async () => ({ kind: 'file', filePath: 'x', itemDir: 'x' }),
    dirSizeRecursive: () => 100,
    findCachedItemDir: () => null,
    isVideoExt: () => false,
    findFirstVideoInDir: () => null,
    cleanupTaskFiles: () => {},
    logger: { log() {}, warn() {} },
  }, overrides));
}

test('download queue coalesces concurrent task creation for same id', async () => {
  let detailCalls = 0;
  const service = createService({
    getFileDetails: async (ids) => {
      detailCalls += 1;
      await new Promise(resolve => setTimeout(resolve, 10));
      return ids.map(id => ({
        result: 1,
        publishedfileid: id,
        title: `Item ${id}`,
        file_size: 100,
        consumer_appid: 431960,
      }));
    },
  });

  const [first, second, third] = await Promise.all([
    service.createTask(3671328737, 'Item'),
    service.createTask(3671328737, 'Item'),
    service.createTask(3671328737, 'Item'),
  ]);

  assert.equal(first, second);
  assert.equal(second, third);
  assert.equal(detailCalls, 1);
  assert.equal(service.tasks.length, 1);
});

test('cancelling active task during preparation aborts runner and cleans up output', async () => {
  const started = deferred();
  const finish = deferred();
  let observedSignal = null;
  let cleanupCalls = 0;
  const service = createService({
    getMaxConcurrentDownloads: () => 1,
    cleanupTaskFiles: (task) => {
      cleanupCalls += 1;
      task.cleanedUp = true;
    },
    downloadWorkshopItem: async (_id, _appId, _title, options) => {
      observedSignal = options && options.signal;
      started.resolve();
      return finish.promise;
    },
  });

  const task = await service.createTask(3671328738, 'Cancelable');
  await started.promise;

  assert.equal(task.status, 'downloading');
  assert.equal(typeof task.cancelFn, 'function');
  assert.equal(observedSignal.aborted, false);

  task.status = 'cancelled';
  task.cancelFn();
  assert.equal(observedSignal.aborted, true);

  finish.resolve({ kind: 'file', filePath: 'x', itemDir: 'x' });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(task.status, 'cancelled');
  assert.equal(cleanupCalls > 0, true);
  assert.equal(task.cleanedUp, true);
  assert.equal(task.progress < 100, true);
});

test('resuming before paused runner exits keeps task pending and restarts after cancel settles', async () => {
  const firstStarted = deferred();
  const firstFinish = deferred();
  const secondStarted = deferred();
  const secondFinish = deferred();
  let calls = 0;
  const service = createService({
    getMaxConcurrentDownloads: () => 1,
    downloadWorkshopItem: async () => {
      calls += 1;
      if (calls === 1) {
        firstStarted.resolve();
        return firstFinish.promise;
      }
      secondStarted.resolve();
      return secondFinish.promise;
    },
  });

  const task = await service.createTask(3671328739, 'Pause resume race');
  await firstStarted.promise;

  task.status = 'paused';
  task.cancelFn();
  task.status = 'pending';
  service.trigger();
  firstFinish.reject(Object.assign(new Error('Task canceled or paused'), { code: 'CANCELLED' }));

  const restarted = await Promise.race([
    secondStarted.promise.then(() => true),
    new Promise(resolve => setTimeout(() => resolve(false), 40)),
  ]);

  assert.equal(restarted, true);
  assert.equal(calls, 2);
  assert.equal(task.status, 'downloading');
  assert.equal(task.errorCode, '');

  task.status = 'cancelled';
  task.cancelFn();
  secondFinish.reject(Object.assign(new Error('Task canceled or paused'), { code: 'CANCELLED' }));
  await new Promise(resolve => setTimeout(resolve, 20));
});

test('live-paused task keeps its queue slot and does not start another download', async () => {
  const firstStarted = deferred();
  const firstFinish = deferred();
  let calls = 0;
  const service = createService({
    getMaxConcurrentDownloads: () => 1,
    downloadWorkshopItem: async () => {
      calls += 1;
      firstStarted.resolve();
      return firstFinish.promise;
    },
  });

  const first = await service.createTask(3671328740, 'Live paused first');
  await firstStarted.promise;
  assert.equal(first.status, 'downloading');

  first.status = 'paused';
  first.livePaused = true;
  first.processPromise = { resume() { return true; }, kill() {} };
  await service.createTask(3671328741, 'Second should wait');
  service.trigger();

  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(calls, 1);
  assert.equal(service.tasks[1].status, 'pending');

  first.livePaused = false;
  first.status = 'cancelled';
  first.cancelFn();
  firstFinish.reject(Object.assign(new Error('Task canceled'), { code: 'CANCELLED' }));
  await new Promise(resolve => setTimeout(resolve, 20));
});

test('paused task preserves partial output when the old runner settles for validation resume', async () => {
  const started = deferred();
  const finish = deferred();
  let cleanupCalls = 0;
  const service = createService({
    getMaxConcurrentDownloads: () => 1,
    cleanupTaskFiles: () => { cleanupCalls += 1; },
    downloadWorkshopItem: async () => {
      started.resolve();
      return finish.promise;
    },
  });

  const task = await service.createTask(3671328742, 'Preserve partial resume files');
  await started.promise;
  task.status = 'paused';
  finish.resolve({ kind: 'file', filePath: 'partial', itemDir: 'partial' });
  await new Promise(resolve => setTimeout(resolve, 20));

  assert.equal(task.status, 'paused');
  assert.equal(cleanupCalls, 0);
});
