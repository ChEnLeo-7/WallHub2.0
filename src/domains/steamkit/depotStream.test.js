'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { EventEmitter } = require('events');
const { Writable } = require('stream');
const { createDepotStreamService } = require('./depotStream');

function createFixture(options = {}) {
  const cacheDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-depot-stream-'));
  const streams = new Map();
  const jsonResponses = [];
  const service = createDepotStreamService({
    DEPOT_STREAM_PATCH_VERSION: 'test',
    DEPOT_CONFIG_DIR: cacheDir,
    DEPOT_STREAM_CACHE_DIR: cacheDir,
    DEPOT_STREAM_MAX_RANGE_BYTES: options.maxRangeBytes || 8,
    DEPOT_STREAM_FIRST_RANGE_BYTES: options.firstRangeBytes || 4,
    DEPOT_STREAM_TAIL_BYTES: 4,
    DEPOT_STREAM_INITIAL_BUFFER_BYTES: 8,
    DEPOT_STREAM_AHEAD_BYTES: options.aheadBytes || 0,
    DEPOT_STREAM_WORKER_IDLE_MS: 60_000,
    DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK: 0.9,
    DEPOT_STREAM_CACHE_CLEANUP_TARGET: 0.8,
    DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS: 60_000,
    depotCommandFor: () => ({ command: 'unused', argsPrefix: [] }),
    getSteamKitStreamMaxDownloads: () => 4,
    makeDepotLoginId: value => value,
    getSteamContentCellId: () => 0,
    resolveDepotLogin: () => ({}),
    ensureDepotStreamDownloaderReady: async () => { throw new Error('unexpected worker start'); },
    ensureDir: dir => fs.mkdirSync(dir, { recursive: true }),
    runProcess: async () => ({}),
    buildSteamContentEnv: value => value,
    buildDepotDotnetEnv: () => ({}),
    getSteamCdnRouteStrategy: () => 'default',
    updateSteamCdnStatusFromText: () => {},
    describeSteamCdnRouteStrategy: () => 'test route',
    fmtBytes: value => `${value} B`,
    getDepotStreamCacheMaxBytes: () => 1024 * 1024,
    getDepotVideoStreams: () => streams.values(),
    getDepotVideoStream: token => streams.get(token),
    hasFilesRecursive: () => false,
    getVideoMime: () => 'video/mp4',
    steamKitNeedsOwnedAccount: () => false,
    canUseDepotLogin: () => true,
    makeSteamKitLoginRequiredError: () => new Error('login required'),
    normalizeDepotError: err => err,
    shouldRetrySteamLoginRequiredError: () => false,
    refreshPersistentSteamLoginForRetry: async () => false,
    jsonRes: (res, statusCode, body) => {
      jsonResponses.push({ statusCode, body });
      res.writeHead(statusCode, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    },
    send: (res, statusCode, body) => {
      res.writeHead(statusCode);
      res.end(body);
    },
    sleep: async () => {},
  });
  return {
    cacheDir,
    streams,
    service,
    jsonResponses,
    cleanup() {
      service.stopAllWorkers('test-cleanup');
      fs.rmSync(cacheDir, { recursive: true, force: true });
    },
  };
}

function cacheFile(fixture, entry, start, end, content) {
  const dir = path.join(fixture.cacheDir, String(entry.publishedFileId), String(entry.manifestId));
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${start}-${end}.bin`);
  if (content === undefined) {
    const fd = fs.openSync(file, 'w');
    try { fs.ftruncateSync(fd, end - start + 1); } finally { fs.closeSync(fd); }
  } else fs.writeFileSync(file, content);
  return file;
}

function fakeWorker() {
  const messages = [];
  const stdin = new EventEmitter();
  stdin.destroyed = false;
  stdin.writableEnded = false;
  stdin.write = (line) => {
    messages.push(JSON.parse(String(line).trim()));
  };
  const cp = new EventEmitter();
  cp.stdin = stdin;
  cp.exitCode = 0;
  cp.signalCode = null;
  cp.killed = false;
  cp.pid = 2147483647;
  cp.kill = () => { cp.killed = true; };
  const worker = {
    key: 'fake',
    publishedFileId: '1',
    closed: false,
    pending: new Map(),
    foregroundQueue: [],
    prefetchQueue: [],
    activeJob: null,
    cp,
  };
  return { worker, messages };
}

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

class TestResponse extends Writable {
  constructor(options = {}) {
    super();
    this.headersSent = false;
    this.statusCode = 0;
    this.responseHeaders = {};
    this.chunks = [];
    this.closeOnHeaders = !!options.closeOnHeaders;
    this.onHeaders = options.onHeaders || null;
  }

  writeHead(statusCode, headers = {}) {
    this.statusCode = statusCode;
    this.responseHeaders = headers;
    this.headersSent = true;
    if (this.onHeaders) this.onHeaders();
    if (this.closeOnHeaders) this.emit('close');
    return this;
  }

  _write(chunk, encoding, callback) {
    this.chunks.push(Buffer.from(chunk));
    callback();
  }
}

function request(range) {
  const req = new EventEmitter();
  req.method = 'GET';
  req.headers = range ? { range } : {};
  req.complete = true;
  req.aborted = false;
  return req;
}

test('cache coverage combines the adjacent ranges seen in seek logs', (t) => {
  const fixture = createFixture({ maxRangeBytes: 8 * 1024 * 1024, firstRangeBytes: 2 * 1024 * 1024 });
  t.after(() => fixture.cleanup());
  const entry = { publishedFileId: '2899746382', manifestId: 'manifest', size: 8427339715 };
  const cases = [
    [2693332992, 2701721599, 2701721600, 2710110207, 2693660672, 2702049279],
    [1528070144, 1536458751, 1536458752, 1544847359, 1530232832, 1538621439],
    [5901746176, 5910134783, 5910134784, 5918523391, 5902565376, 5910953983],
  ];
  for (const [firstStart, firstEnd, secondStart, secondEnd, requestStart, requestEnd] of cases) {
    cacheFile(fixture, entry, firstStart, firstEnd);
    cacheFile(fixture, entry, secondStart, secondEnd);
    const coverage = fixture.service._test.selectDepotStreamCoverage(entry, requestStart, requestEnd);
    assert.equal(coverage.complete, true);
    assert.deepEqual(coverage.gaps, []);
    assert.equal(coverage.segments.length, 2);
  }
});

test('cache coverage reports only the missing span between valid files', (t) => {
  const fixture = createFixture({ maxRangeBytes: 100, firstRangeBytes: 25 });
  t.after(() => fixture.cleanup());
  const entry = { publishedFileId: 'gap', manifestId: 'm', size: 200 };
  cacheFile(fixture, entry, 100, 149);
  cacheFile(fixture, entry, 175, 199);
  assert.deepEqual(fixture.service._test.selectDepotStreamCoverage(entry, 100, 199).gaps, [
    { start: 150, end: 174 },
  ]);
});

test('normalizeRange caps bounded, suffix, and headerless responses', (t) => {
  const fixture = createFixture({ maxRangeBytes: 16, firstRangeBytes: 32 });
  t.after(() => fixture.cleanup());
  assert.deepEqual(fixture.service.normalizeRange(request('bytes=10-99'), 100), {
    start: 10, end: 25, statusCode: 206, rangeHeader: 'bytes=10-99',
  });
  assert.deepEqual(fixture.service.normalizeRange(request('bytes=-40'), 100), {
    start: 84, end: 99, statusCode: 206, rangeHeader: 'bytes=-40',
  });
  assert.deepEqual(fixture.service.normalizeRange(request(), 100), {
    start: 0, end: 15, statusCode: 206, rangeHeader: '',
  });
});

test('foreground demand evicts queued prefetch and dispatches next', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const { worker, messages } = fakeWorker();
  const blocker = fixture.service._test.requestDepotStreamWorkerRange(worker, 0, 3, 'a', { epoch: 1, blockIndex: 0 });
  const prefetch = fixture.service._test.requestDepotStreamWorkerRange(worker, 4, 7, 'b', { priority: 'prefetch' });
  const foreground = fixture.service._test.requestDepotStreamWorkerRange(worker, 8, 11, 'c', { epoch: 2, blockIndex: 0 });
  prefetch.catch(() => {});
  assert.equal(prefetch.job.timer, null);
  assert.equal(messages.length, 1);
  fixture.service._test.handleDepotStreamWorkerMessage(worker, { type: 'range', id: blocker.job.id, success: true });
  await tick();
  assert.equal(messages.at(-1).id, foreground.job.id);
  await assert.rejects(prefetch, { name: 'AbortError' });
  fixture.service._test.handleDepotStreamWorkerMessage(worker, { type: 'range', id: foreground.job.id, success: true });
  await Promise.all([blocker, foreground]);
});

test('active prefetch cancellation keeps the worker reusable', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const { worker, messages } = fakeWorker();
  const prefetch = fixture.service._test.requestDepotStreamWorkerRange(worker, 0, 3, 'a', { priority: 'prefetch' });
  prefetch.catch(() => {});
  const foreground = fixture.service._test.requestDepotStreamWorkerRange(worker, 8, 11, 'b', { epoch: 2, blockIndex: 0 });
  assert.deepEqual(messages.map(message => message.type), ['range', 'cancel']);
  fixture.service._test.handleDepotStreamWorkerMessage(worker, {
    type: 'range', id: prefetch.job.id, success: false, cancelled: true,
  });
  await tick();
  assert.equal(messages.at(-1).id, foreground.job.id);
  assert.equal(worker.closed, false);
  assert.equal(fixture.service._test.shouldStopDepotStreamWorkerForRangeError(
    fixture.service._test.createDepotStreamAbortError()
  ), false);
  assert.equal(fixture.service._test.shouldStopDepotStreamWorkerForRangeError(new Error('range failed')), true);
  fixture.service._test.handleDepotStreamWorkerMessage(worker, { type: 'range', id: foreground.job.id, success: true });
  await assert.rejects(prefetch, { name: 'AbortError' });
  await foreground;
});

test('asynchronous worker stdin failure rejects active work without an uncaught EPIPE', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const { worker, messages } = fakeWorker();
  fixture.service._test.attachDepotStreamWorkerStdinErrorHandler(worker);
  const range = fixture.service._test.requestDepotStreamWorkerRange(worker, 0, 3, 'a', { epoch: 1 });
  const failure = Object.assign(new Error('write EPIPE'), { code: 'EPIPE' });
  worker.cp.stdin.emit('error', failure);
  await assert.rejects(range, error => error === failure);
  assert.equal(worker.closed, true);
  assert.equal(worker.stdinFailed, true);
  assert.deepEqual(messages.map(message => message.type), ['range']);
});

test('worker exit clears force-kill timer and exited child is never killed again', (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const { worker } = fakeWorker();
  let killCalls = 0;
  worker.cp.kill = () => { killCalls++; };
  worker.cp.exitCode = null;
  fixture.service._test.attachDepotStreamWorkerLifecycleCleanup(worker);
  fixture.service._test.scheduleDepotStreamWorkerForceKill(worker);
  assert.ok(worker.forceKillTimer);
  worker.cp.exitCode = 0;
  worker.cp.emit('exit', 0, null);
  assert.equal(worker.forceKillTimer, null);
  assert.equal(fixture.service._test.depotStreamWorkerProcessExited(worker.cp), true);
  fixture.service._test.killDepotStreamWorkerProcess(worker.cp);
  assert.equal(killCalls, 0);
});

test('busy range temp is retried immediately when its worker closes', (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const { worker } = fakeWorker();
  fixture.service._test.attachDepotStreamWorkerLifecycleCleanup(worker);
  const tempPath = path.join(fixture.cacheDir, 'video', 'm', '0-3.bin.busy.tmp');
  fs.mkdirSync(path.dirname(tempPath), { recursive: true });
  fs.writeFileSync(tempPath, 'partial');
  const originalRmSync = fs.rmSync;
  let busy = true;
  fs.rmSync = (target, options) => {
    if (busy && path.resolve(target) === path.resolve(tempPath)) {
      throw Object.assign(new Error('file busy'), { code: 'EBUSY' });
    }
    return originalRmSync(target, options);
  };
  try {
    assert.equal(fixture.service._test.scheduleDepotStreamTempCleanup(tempPath, worker), false);
    assert.equal(fs.existsSync(tempPath), true);
    assert.equal(fixture.service._test.tempCleanupRetries.has(path.resolve(tempPath)), true);
    busy = false;
    worker.cp.exitCode = 0;
    worker.cp.emit('close', 0, null);
    assert.equal(fs.existsSync(tempPath), false);
    assert.equal(fixture.service._test.tempCleanupRetries.has(path.resolve(tempPath)), false);
    assert.equal(worker.tempCleanupPaths.has(path.resolve(tempPath)), false);
  } finally {
    fs.rmSync = originalRmSync;
  }
});

test('exhausted temp cleanup releases retry state and active temp can be scheduled again by finally', (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const { worker } = fakeWorker();
  worker.closed = true;
  const tempPath = path.join(fixture.cacheDir, 'video', 'm', '0-3.bin.exhausted.tmp');
  const resolved = path.resolve(tempPath);
  fs.mkdirSync(path.dirname(tempPath), { recursive: true });
  fs.writeFileSync(tempPath, 'partial');
  const originalRmSync = fs.rmSync;
  fs.rmSync = (target, options) => {
    if (path.resolve(target) === resolved) {
      throw Object.assign(new Error('file busy'), { code: 'EBUSY' });
    }
    return originalRmSync(target, options);
  };
  try {
    assert.equal(fixture.service._test.scheduleDepotStreamTempCleanup(tempPath, worker, 8), false);
    assert.equal(fixture.service._test.tempCleanupRetries.has(resolved), false);
    assert.equal(worker.tempCleanupPaths.has(resolved), false);

    fixture.service._test.activeTempFiles.add(resolved);
    assert.equal(fixture.service._test.scheduleDepotStreamTempCleanup(tempPath, worker, 8), false);
    assert.equal(fixture.service._test.tempCleanupRetries.has(resolved), false);
    assert.equal(worker.tempCleanupPaths.has(resolved), false);
  } finally {
    fixture.service._test.activeTempFiles.delete(resolved);
    fs.rmSync = originalRmSync;
  }
  assert.equal(fixture.service._test.scheduleDepotStreamTempCleanup(tempPath, worker), true);
  assert.equal(fs.existsSync(tempPath), false);
});

test('cache cleanup removes stale orphan temp files but preserves active and fresh temps', (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const dir = path.join(fixture.cacheDir, 'video', 'm');
  fs.mkdirSync(dir, { recursive: true });
  const staleTemp = path.join(dir, 'stale.bin.1.tmp');
  const activeTemp = path.join(dir, 'active.bin.2.tmp');
  const freshTemp = path.join(dir, 'fresh.bin.3.tmp');
  fs.writeFileSync(staleTemp, 'stale');
  fs.writeFileSync(activeTemp, 'active');
  fs.writeFileSync(freshTemp, 'fresh');
  const old = new Date(Date.now() - fixture.service._test.tmpStaleMs - 60_000);
  fs.utimesSync(staleTemp, old, old);
  fs.utimesSync(activeTemp, old, old);
  fixture.service._test.activeTempFiles.add(path.resolve(activeTemp));
  t.after(() => fixture.service._test.activeTempFiles.delete(path.resolve(activeTemp)));

  const result = fixture.service.cleanupCache({ force: true });
  assert.equal(result.removedTempFiles, 1);
  assert.equal(result.removedTempBytes, Buffer.byteLength('stale'));
  assert.equal(result.bytes, Buffer.byteLength('active') + Buffer.byteLength('fresh'));
  assert.equal(fixture.service._test.getEstimatedCacheBytes(), result.bytes);
  assert.equal(fs.existsSync(staleTemp), false);
  assert.equal(fs.existsSync(activeTemp), true);
  assert.equal(fs.existsSync(freshTemp), true);
  assert.equal(fixture.service.getCacheStats().bytes, result.bytes);
});

test('a prefetch needed by the new demand is promoted before unrelated prefetch cancellation', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const entry = { publishedFileId: 'video', manifestId: 'm' };
  const { worker, messages } = fakeWorker();
  worker.key = fixture.service._test.depotStreamWorkerKey(entry, {});
  fixture.service.workers.set(worker.key, worker);
  const workerPromise = fixture.service._test.requestDepotStreamWorkerRange(worker, 0, 3, 'a', { priority: 'prefetch' });
  let resolveTask;
  const task = {
    settled: false,
    cancelled: false,
    priority: 'prefetch',
    epoch: 0,
    blockIndex: 0,
    waiters: new Map(),
    worker,
    job: workerPromise.job,
    promise: new Promise(resolve => { resolveTask = resolve; }),
  };
  const epoch = fixture.service._test.nextDepotStreamDemandEpoch(entry);
  const foregroundWait = fixture.service._test.waitForDepotStreamRangeTask(task, null, {
    priority: 'foreground', epoch, blockIndex: 0,
  });
  fixture.service._test.cancelDepotStreamEntryPrefetch(entry, {});
  assert.equal(task.job.priority, 'foreground');
  assert.deepEqual(messages.map(message => message.type), ['range']);
  task.settled = true;
  resolveTask('cached');
  fixture.service._test.handleDepotStreamWorkerMessage(worker, { type: 'range', id: task.job.id, success: true });
  await Promise.all([foregroundWait, workerPromise]);
});

test('a newer demand epoch overtakes queued foreground without cancelling it', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const { worker, messages } = fakeWorker();
  const active = fixture.service._test.requestDepotStreamWorkerRange(worker, 0, 3, 'a', { epoch: 1, blockIndex: 0 });
  const oldDemand = fixture.service._test.requestDepotStreamWorkerRange(worker, 4, 7, 'b', { epoch: 1, blockIndex: 1 });
  const newDemand = fixture.service._test.requestDepotStreamWorkerRange(worker, 20, 23, 'c', { epoch: 2, blockIndex: 0 });
  fixture.service._test.handleDepotStreamWorkerMessage(worker, { type: 'range', id: active.job.id, success: true });
  await tick();
  assert.equal(messages.at(-1).id, newDemand.job.id);
  assert.equal(oldDemand.job.state, 'queued');
  fixture.service._test.handleDepotStreamWorkerMessage(worker, { type: 'range', id: newDemand.job.id, success: true });
  await tick();
  assert.equal(messages.at(-1).id, oldDemand.job.id);
  fixture.service._test.handleDepotStreamWorkerMessage(worker, { type: 'range', id: oldDemand.job.id, success: true });
  await Promise.all([active, newDemand, oldDemand]);
});

test('shared queued task drops a departed waiter high epoch', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const { worker } = fakeWorker();
  const blocker = fixture.service._test.requestDepotStreamWorkerRange(worker, 0, 3, 'a', { epoch: 1 });
  const sharedRange = fixture.service._test.requestDepotStreamWorkerRange(worker, 4, 7, 'b', { epoch: 1, blockIndex: 3 });
  let resolveTask;
  const task = {
    settled: false,
    cancelled: false,
    priority: 'foreground',
    epoch: 1,
    blockIndex: 3,
    waiters: new Map(),
    worker,
    job: sharedRange.job,
    promise: new Promise(resolve => { resolveTask = resolve; }),
  };
  const oldWaiter = fixture.service._test.waitForDepotStreamRangeTask(task, null, {
    priority: 'foreground', epoch: 1, blockIndex: 3,
  });
  const newer = new AbortController();
  const newWaiter = fixture.service._test.waitForDepotStreamRangeTask(task, newer.signal, {
    priority: 'foreground', epoch: 5, blockIndex: 4,
  });
  newWaiter.catch(() => {});
  assert.equal(task.job.epoch, 5);
  assert.equal(task.job.blockIndex, 4);
  newer.abort();
  await assert.rejects(newWaiter, { name: 'AbortError' });
  assert.equal(task.epoch, 1);
  assert.equal(task.blockIndex, 3);
  assert.equal(task.job.epoch, 1);
  assert.equal(task.job.blockIndex, 3);
  fixture.service._test.handleDepotStreamWorkerMessage(worker, { type: 'range', id: blocker.job.id, success: true });
  await tick();
  fixture.service._test.handleDepotStreamWorkerMessage(worker, { type: 'range', id: sharedRange.job.id, success: true });
  task.settled = true;
  resolveTask('cached');
  await Promise.all([blocker, sharedRange, oldWaiter]);
});

test('demoted active prefetch is cancelled when it blocks a newer foreground range', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const { worker, messages } = fakeWorker();
  const prefetchRange = fixture.service._test.requestDepotStreamWorkerRange(worker, 0, 3, 'p', { priority: 'prefetch' });
  prefetchRange.catch(() => {});
  let rejectTask;
  const task = {
    settled: false,
    cancelled: false,
    priority: 'prefetch',
    epoch: 0,
    blockIndex: 0,
    waiters: new Map(),
    worker,
    job: prefetchRange.job,
    promise: new Promise((resolve, reject) => { rejectTask = reject; }),
  };
  const prefetchWaiter = fixture.service._test.waitForDepotStreamRangeTask(task, null, {
    priority: 'prefetch', epoch: 0, blockIndex: 0,
  });
  prefetchWaiter.catch(() => {});
  const oldRequest = new AbortController();
  const oldWaiter = fixture.service._test.waitForDepotStreamRangeTask(task, oldRequest.signal, {
    priority: 'foreground', epoch: 1, blockIndex: 0,
  });
  oldWaiter.catch(() => {});
  const newRange = fixture.service._test.requestDepotStreamWorkerRange(worker, 8, 11, 'b', {
    priority: 'foreground', epoch: 2, blockIndex: 0,
  });
  assert.deepEqual(messages.map(message => message.type), ['range']);
  oldRequest.abort();
  await assert.rejects(oldWaiter, { name: 'AbortError' });
  assert.equal(messages.at(-1).type, 'cancel');
  fixture.service._test.handleDepotStreamWorkerMessage(worker, {
    type: 'range', id: prefetchRange.job.id, success: false, cancelled: true,
  });
  await tick();
  assert.equal(messages.at(-1).id, newRange.job.id);
  task.settled = true;
  rejectTask(fixture.service._test.createDepotStreamAbortError());
  fixture.service._test.handleDepotStreamWorkerMessage(worker, { type: 'range', id: newRange.job.id, success: true });
  await assert.rejects(prefetchRange, { name: 'AbortError' });
  await assert.rejects(prefetchWaiter, { name: 'AbortError' });
  await newRange;
});

test('cancel-pending shared task cannot be rejoined or selected as containing work', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const entry = { publishedFileId: 'video', manifestId: 'm', size: 8 };
  const key = fixture.service._test.depotStreamRangePromiseKey(entry, 0, 3);
  const cancelledTask = {
    start: 0,
    end: 7,
    cancelled: false,
    settled: false,
    job: { cancelled: true },
    waiters: new Map(),
    promise: new Promise(() => {}),
  };
  fixture.service.rangePromises.set(key, cancelledTask);
  assert.equal(fixture.service._test.depotStreamRangeTaskReusable(cancelledTask), false);
  assert.equal(fixture.service._test.findDepotStreamInFlightRange(entry, 1, 2), null);

  const replacementAttempt = fixture.service.ensureRangeCached(entry, 0, 3, {});
  const replacement = fixture.service.rangePromises.get(key);
  assert.ok(replacement);
  assert.notEqual(replacement, cancelledTask);
  assert.equal(fixture.service._test.depotStreamRangeTaskReusable(replacement), true);
  await assert.rejects(replacementAttempt, /unexpected worker start/);
  assert.notEqual(fixture.service.rangePromises.get(key), cancelledTask);
});

test('releasing one worker does not invalidate prefetch generations globally', (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const { worker } = fakeWorker();
  worker.key = 'release-me';
  fixture.service.workers.set(worker.key, worker);
  const generation = fixture.service._test.getGeneration();
  assert.equal(fixture.service.stopWorkerByKey(worker.key, 'test-release'), true);
  assert.equal(fixture.service._test.getGeneration(), generation);
});

test('release invalidates delayed prefetch only for the released video', (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const entry = { publishedFileId: 'released-video', manifestId: 'm', workerKey: '' };
  const other = { publishedFileId: 'other-video', manifestId: 'm' };
  const { worker } = fakeWorker();
  worker.key = fixture.service._test.depotStreamWorkerKey(entry, {});
  entry.workerKey = worker.key;
  fixture.service.workers.set(worker.key, worker);
  const generation = fixture.service._test.getGeneration();
  assert.equal(fixture.service._test.getDemandEpoch(entry), 0);
  assert.equal(fixture.service._test.getDemandEpoch(other), 0);
  assert.equal(fixture.service.releaseEntry(entry, 'test-release').stopped, true);
  assert.equal(fixture.service._test.getDemandEpoch(entry), 1);
  assert.equal(fixture.service._test.getDemandEpoch(other), 0);
  assert.equal(fixture.service._test.getGeneration(), generation);
});

test('prefetch waiting for worker startup becomes stale after new demand', (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const entry = { publishedFileId: 'video', manifestId: 'm' };
  const prefetchTask = { priority: 'prefetch', epoch: 0 };
  assert.equal(fixture.service._test.depotStreamPrefetchTaskIsCurrent(entry, prefetchTask), true);
  fixture.service._test.nextDepotStreamDemandEpoch(entry, {});
  assert.equal(fixture.service._test.depotStreamPrefetchTaskIsCurrent(entry, prefetchTask), false);
  assert.equal(fixture.service._test.depotStreamPrefetchTaskIsCurrent(entry, { priority: 'foreground', epoch: 0 }), true);
});

test('a queued foreground range has no timeout until dispatch', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const { worker } = fakeWorker();
  const first = fixture.service._test.requestDepotStreamWorkerRange(worker, 0, 3, 'a', { epoch: 1 });
  const queued = fixture.service._test.requestDepotStreamWorkerRange(worker, 4, 7, 'b', { epoch: 1 });
  assert.equal(queued.job.state, 'queued');
  assert.equal(queued.job.timer, null);
  fixture.service._test.handleDepotStreamWorkerMessage(worker, { type: 'range', id: first.job.id, success: true });
  await tick();
  assert.equal(queued.job.state, 'active');
  assert.ok(queued.job.timer);
  fixture.service._test.handleDepotStreamWorkerMessage(worker, { type: 'range', id: queued.job.id, success: true });
  await Promise.all([first, queued]);
});

test('shared range cancels only after the final foreground waiter aborts', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const { worker, messages } = fakeWorker();
  let resolveTask;
  const task = {
    settled: false,
    cancelled: false,
    priority: 'foreground',
    epoch: 1,
    blockIndex: 0,
    waiters: new Map(),
    worker,
    job: null,
    promise: new Promise(resolve => { resolveTask = resolve; }),
  };
  const workerPromise = fixture.service._test.requestDepotStreamWorkerRange(worker, 0, 3, 'a', { epoch: 1 });
  workerPromise.catch(() => {});
  task.job = workerPromise.job;
  const first = new AbortController();
  const second = new AbortController();
  const firstWait = fixture.service._test.waitForDepotStreamRangeTask(task, first.signal, { priority: 'foreground' });
  const secondWait = fixture.service._test.waitForDepotStreamRangeTask(task, second.signal, { priority: 'foreground' });
  firstWait.catch(() => {});
  secondWait.catch(() => {});
  first.abort();
  await assert.rejects(firstWait, { name: 'AbortError' });
  assert.equal(messages.some(message => message.type === 'cancel'), false);
  second.abort();
  await assert.rejects(secondWait, { name: 'AbortError' });
  assert.equal(messages.at(-1).type, 'cancel');
  fixture.service._test.handleDepotStreamWorkerMessage(worker, {
    type: 'range', id: task.job.id, success: false, cancelled: true,
  });
  resolveTask('unused');
  await assert.rejects(workerPromise, { name: 'AbortError' });
});

test('an already-aborted first waiter cancels a newly created zero-waiter task', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const controller = new AbortController();
  controller.abort();
  const task = {
    settled: false,
    cancelled: false,
    priority: 'foreground',
    waiters: new Map(),
    worker: null,
    job: null,
    promise: new Promise(() => {}),
  };
  await assert.rejects(
    fixture.service._test.waitForDepotStreamRangeTask(task, controller.signal, { priority: 'foreground' }),
    { name: 'AbortError' }
  );
  assert.equal(task.cancelled, true);
});

test('request failure abort cancels a later block task instead of leaving network work running', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const req = request('bytes=0-7');
  const res = new EventEmitter();
  res.writableFinished = false;
  res.destroyed = false;
  const requestAbort = fixture.service._test.createDepotStreamRequestAbort(req, res);
  const { worker, messages } = fakeWorker();
  const laterRange = fixture.service._test.requestDepotStreamWorkerRange(worker, 4, 7, 'later', {
    priority: 'foreground', epoch: 1, blockIndex: 1,
  });
  laterRange.catch(() => {});
  let rejectTask;
  const laterTask = {
    settled: false,
    cancelled: false,
    priority: 'foreground',
    epoch: 1,
    blockIndex: 1,
    waiters: new Map(),
    worker,
    job: laterRange.job,
    promise: new Promise((resolve, reject) => { rejectTask = reject; }),
  };
  const laterWaiter = fixture.service._test.waitForDepotStreamRangeTask(
    laterTask,
    requestAbort.signal,
    { priority: 'foreground', epoch: 1, blockIndex: 1 }
  );
  laterWaiter.catch(() => {});
  requestAbort.abort();
  await assert.rejects(laterWaiter, { name: 'AbortError' });
  assert.equal(messages.at(-1).type, 'cancel');
  fixture.service._test.handleDepotStreamWorkerMessage(worker, {
    type: 'range', id: laterRange.job.id, success: false, cancelled: true,
  });
  laterTask.settled = true;
  rejectTask(fixture.service._test.createDepotStreamAbortError());
  await assert.rejects(laterRange, { name: 'AbortError' });
  requestAbort.cleanup();
});

test('aborting a promoted waiter demotes a task still held by prefetch', async (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const { worker, messages } = fakeWorker();
  let resolveTask;
  const workerPromise = fixture.service._test.requestDepotStreamWorkerRange(worker, 0, 3, 'a', { priority: 'prefetch' });
  workerPromise.catch(() => {});
  const task = {
    settled: false,
    cancelled: false,
    priority: 'prefetch',
    epoch: 0,
    blockIndex: 0,
    waiters: new Map(),
    worker,
    job: workerPromise.job,
    promise: new Promise(resolve => { resolveTask = resolve; }),
  };
  const prefetchWait = fixture.service._test.waitForDepotStreamRangeTask(task, null, { priority: 'prefetch' });
  const foreground = new AbortController();
  const foregroundWait = fixture.service._test.waitForDepotStreamRangeTask(task, foreground.signal, { priority: 'foreground', epoch: 1 });
  foregroundWait.catch(() => {});
  assert.equal(task.job.priority, 'foreground');
  foreground.abort();
  await assert.rejects(foregroundWait, { name: 'AbortError' });
  assert.equal(task.job.priority, 'prefetch');
  assert.equal(messages.some(message => message.type === 'cancel'), false);
  resolveTask('cached');
  await prefetchWait;
  fixture.service._test.handleDepotStreamWorkerMessage(worker, { type: 'range', id: task.job.id, success: true });
  await workerPromise;
});

test('adjacent cache files are streamed in byte order', async (t) => {
  const fixture = createFixture({ maxRangeBytes: 8, firstRangeBytes: 4 });
  t.after(() => fixture.cleanup());
  const entry = { publishedFileId: 'video', id: 'video', manifestId: 'm', size: 8, fileName: 'video.mp4' };
  cacheFile(fixture, entry, 0, 3, Buffer.from('ABCD'));
  cacheFile(fixture, entry, 4, 7, Buffer.from('EFGH'));
  fixture.streams.set('token', entry);
  const res = new TestResponse();
  await fixture.service.handleVideoStream(request('bytes=2-5'), res, 'token');
  assert.equal(res.statusCode, 206);
  assert.equal(Buffer.concat(res.chunks).toString(), 'CDEF');
  assert.equal(res.responseHeaders['Content-Range'], 'bytes 2-5/8');
});

test('premature response close sends no 500 and schedules no ahead buffer', async (t) => {
  const fixture = createFixture({ maxRangeBytes: 8, firstRangeBytes: 4, aheadBytes: 2 });
  t.after(() => fixture.cleanup());
  const entry = { publishedFileId: 'video', id: 'video', manifestId: 'm', size: 8, fileName: 'video.mp4' };
  cacheFile(fixture, entry, 0, 7, Buffer.from('ABCDEFGH'));
  fixture.streams.set('token', entry);
  const before = fixture.service._test.getAheadScheduleCount();
  await fixture.service.handleVideoStream(request('bytes=0-3'), new TestResponse({ closeOnHeaders: true }), 'token');
  assert.equal(fixture.jsonResponses.length, 0);
  assert.equal(fixture.service._test.getAheadScheduleCount(), before);
});

test('request aborted sends no 500 and schedules no ahead buffer', async (t) => {
  const fixture = createFixture({ maxRangeBytes: 8, firstRangeBytes: 4, aheadBytes: 2 });
  t.after(() => fixture.cleanup());
  const entry = { publishedFileId: 'video', id: 'video', manifestId: 'm', size: 8, fileName: 'video.mp4' };
  cacheFile(fixture, entry, 0, 7, Buffer.from('ABCDEFGH'));
  fixture.streams.set('token', entry);
  const req = request('bytes=0-3');
  const before = fixture.service._test.getAheadScheduleCount();
  const res = new TestResponse({
    onHeaders() {
      req.aborted = true;
      req.emit('aborted');
    },
  });
  await fixture.service.handleVideoStream(req, res, 'token');
  assert.equal(fixture.jsonResponses.length, 0);
  assert.equal(fixture.service._test.getAheadScheduleCount(), before);
});

test('response error aborts an in-progress depot request before close', (t) => {
  const fixture = createFixture();
  t.after(() => fixture.cleanup());
  const req = request('bytes=0-3');
  const res = new EventEmitter();
  res.writableFinished = false;
  res.destroyed = false;
  const requestAbort = fixture.service._test.createDepotStreamRequestAbort(req, res);
  assert.equal(requestAbort.signal.aborted, false);
  res.emit('error', new Error('client socket failed'));
  assert.equal(requestAbort.signal.aborted, true);
  requestAbort.cleanup();
  assert.equal(res.listenerCount('error'), 0);
});

test('ahead buffer is scheduled only after a normal response finish', async (t) => {
  const fixture = createFixture({ maxRangeBytes: 8, firstRangeBytes: 4, aheadBytes: 2 });
  t.after(() => fixture.cleanup());
  const entry = { publishedFileId: 'video', id: 'video', manifestId: 'm', size: 8, fileName: 'video.mp4' };
  cacheFile(fixture, entry, 0, 7, Buffer.from('ABCDEFGH'));
  fixture.streams.set('token', entry);
  const before = fixture.service._test.getAheadScheduleCount();
  await fixture.service.handleVideoStream(request('bytes=0-3'), new TestResponse(), 'token');
  assert.equal(fixture.service._test.getAheadScheduleCount(), before + 1);
});
