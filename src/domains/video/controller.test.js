'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createVideoController } = require('./controller');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function request() {
  return new EventEmitter();
}

function response() {
  return { destroyed: false, writableEnded: false, body: null, statusCode: 0 };
}

function tokenFromResponse(res) {
  return new URL(res.body.streamUrl, 'http://wallhub.local').searchParams.get('token');
}

function createHarness(getWorker) {
  const releaseCalls = [];
  let serviceDeps = null;
  const service = {
    workers: new Map(),
    getWorker,
    scheduleInitialPrefetch() {},
    releaseEntry(entry, reason) {
      releaseCalls.push({ entry, reason });
      return { stopped: true };
    },
  };
  const controller = createVideoController({
    createDepotStreamService(deps) {
      serviceDeps = deps;
      return service;
    },
    getVideoCacheSettings: () => ({ steamKitDepotStreaming: true }),
    effectiveDownloaderMode: () => 'steamkit',
    isCacheItemTombstoned: () => false,
    getDownloadQueueService: () => ({ findCachedVideoById: () => null }),
    getWorkshopCacheDir: () => '',
    waitForStartupPreparationForDownload: async () => {},
    getFileDetails: async ([id]) => [{
      result: 1,
      publishedfileid: String(id),
      hcontent_file: `content-${id}`,
      consumer_appid: 431960,
      filename: `${id}.mp4`,
    }],
    detectVideoTag: () => true,
    isVideoExt: () => true,
    extFromUrl: () => '.mp4',
    extFromPath: () => '.mp4',
    resolveDepotLogin: () => ({}),
    steamKitNeedsOwnedAccount: () => false,
    canUseDepotLogin: () => true,
    normalizeDepotError: error => error,
    shouldRetrySteamLoginRequiredError: () => false,
    codedError(message, code, statusCode) {
      return Object.assign(new Error(message), { code, statusCode });
    },
    steamCdnStatusSnapshot: () => ({ currentHost: '' }),
    jsonRes(res, statusCode, body) {
      res.statusCode = statusCode;
      res.body = body;
      res.writableEnded = true;
      return body;
    },
    logger: { log() {}, warn() {} },
  });

  return {
    controller,
    releaseCalls,
    getServiceDeps: () => serviceDeps,
  };
}

async function play(controller, id, req = request()) {
  const res = response();
  await controller.handleVideoPlay(req, res, String(id), `video-${id}`);
  return { req, res, token: res.body ? tokenFromResponse(res) : null };
}

test('shared depot worker stops only after its final token is removed', async () => {
  const harness = createHarness(async entry => ({
    key: 'shared-worker',
    info: { size: 1024, fileName: `${entry.id}.mp4` },
  }));

  const first = await play(harness.controller, 100);
  const second = await play(harness.controller, 100);
  const third = await play(harness.controller, 100);
  const stale = await play(harness.controller, 100);
  const serviceDeps = harness.getServiceDeps();
  const firstEntry = serviceDeps.getDepotVideoStream(first.token);
  const staleEntry = serviceDeps.getDepotVideoStream(stale.token);

  firstEntry.expiresAt = 0;
  assert.equal(serviceDeps.getDepotVideoStream(first.token), null);
  assert.equal(harness.releaseCalls.length, 0);

  const secondRelease = response();
  await harness.controller.handleDepotVideoRelease(request(), secondRelease, second.token);
  assert.deepEqual(secondRelease.body, { success: true, released: true, stopped: false });
  assert.equal(harness.releaseCalls.length, 0);
  assert.ok(serviceDeps.getDepotVideoStream(third.token));

  staleEntry.expiresAt = 0;

  const thirdRelease = response();
  await harness.controller.handleDepotVideoRelease(request(), thirdRelease, third.token);
  assert.deepEqual(thirdRelease.body, { success: true, released: true, stopped: true });
  assert.equal(harness.releaseCalls.length, 1);
  assert.equal(harness.releaseCalls[0].entry.workerKey, 'shared-worker');
});

test('older play demand cannot supersede a newer depot token when abort arrives late', async () => {
  const oldWorker = deferred();
  const oldWorkerRequested = deferred();
  const harness = createHarness(async entry => {
    if (String(entry.id) === '100') {
      oldWorkerRequested.resolve();
      return oldWorker.promise;
    }
    return { key: 'current-worker', info: { size: 2048, fileName: 'current.mp4' } };
  });

  const oldReq = request();
  const oldRes = response();
  const oldPlay = harness.controller.handleVideoPlay(oldReq, oldRes, '100', 'old-video');
  await oldWorkerRequested.promise;
  const current = await play(harness.controller, 200);
  oldWorker.resolve({ key: 'old-worker', info: { size: 1024, fileName: 'old.mp4' } });
  await oldPlay;

  const serviceDeps = harness.getServiceDeps();
  assert.equal(oldRes.body, null);
  assert.ok(serviceDeps.getDepotVideoStream(current.token));
  assert.equal(harness.releaseCalls.length, 1);
  assert.equal(harness.releaseCalls[0].entry.workerKey, 'old-worker');
  assert.equal(harness.releaseCalls[0].reason, 'request-aborted');

  const currentRelease = response();
  await harness.controller.handleDepotVideoRelease(request(), currentRelease, current.token);
  assert.equal(harness.releaseCalls.length, 2);
  assert.equal(harness.releaseCalls[1].entry.workerKey, 'current-worker');
});
