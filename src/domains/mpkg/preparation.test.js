'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createMpkgPreparationService } = require('./preparation');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('MPKG preparation immediately exposes one shared preparing job and hides server file paths', async () => {
  const pending = deferred();
  let prepareCalls = 0;
  const service = createMpkgPreparationService({
    prepareDownloadFile: (id, title) => {
      prepareCalls += 1;
      assert.equal(id, '3750175441');
      assert.equal(title, 'Demo');
      return pending.promise;
    },
  });

  const first = service.start('3750175441', 'Demo');
  const second = service.start('3750175441', 'Ignored duplicate title');

  assert.equal(first.status, 'preparing');
  assert.equal(second, first);
  assert.equal(prepareCalls, 1);

  pending.resolve({
    filePath: 'F:\\private\\Downloads\\3750175441\\Mpkg\\3750175441.mpkg',
    fileName: '3750175441.mpkg',
    deleteAfterSend: false,
  });
  await first.promise;

  const publicJob = service.toPublic(service.get('3750175441'));
  assert.deepEqual(publicJob, {
    id: '3750175441',
    status: 'ready',
    fileName: '3750175441.mpkg',
  });
  assert.equal(JSON.stringify(publicJob).includes('private'), false);
});

test('MPKG preparation exposes elapsed wait time while conversion is still preparing', () => {
  const pending = deferred();
  let currentTime = 1_000;
  const service = createMpkgPreparationService({
    now: () => currentTime,
    prepareDownloadFile: () => pending.promise,
  });

  service.start('3750175441', 'Slow wallpaper');
  currentTime = 6_400;

  const publicJob = service.toPublic(service.get('3750175441'));
  assert.deepEqual(publicJob, {
    id: '3750175441',
    status: 'preparing',
    elapsedMs: 5_400,
  });
  assert.equal(JSON.stringify(publicJob).includes('filePath'), false);
});

test('MPKG preparation keeps fast and compact profile jobs separate', async () => {
  const calls = [];
  const service = createMpkgPreparationService({
    prepareDownloadFile: async (id, title, profile) => {
      calls.push({ id, title, profile });
      return {
        filePath: `/private/${id}.${profile}.mpkg`,
        fileName: `${id}.${profile}.mpkg`,
      };
    },
  });

  const fast = service.start('3750175441', 'Demo', 'fast');
  const compact = service.start('3750175441', 'Demo', 'compact');
  await Promise.all([fast.promise, compact.promise]);

  assert.notEqual(compact, fast);
  assert.deepEqual(calls, [
    { id: '3750175441', title: 'Demo', profile: 'fast' },
    { id: '3750175441', title: 'Demo', profile: 'compact' },
  ]);
  assert.equal(service.get('3750175441', 'fast'), fast);
  assert.equal(service.get('3750175441', 'compact'), compact);
});

test('MPKG preparation preserves a terminal error for polling instead of rejecting an unobserved background promise', async () => {
  const service = createMpkgPreparationService({
    prepareDownloadFile: async () => {
      const error = new Error('conversion failed');
      error.code = 'MPKG_CONVERSION_FAILED';
      error.statusCode = 500;
      throw error;
    },
  });

  const job = service.start('123', 'Demo');
  await job.promise;

  assert.deepEqual(service.toPublic(service.get('123')), {
    id: '123',
    status: 'error',
    error: 'conversion failed',
    code: 'MPKG_CONVERSION_FAILED',
  });
});
