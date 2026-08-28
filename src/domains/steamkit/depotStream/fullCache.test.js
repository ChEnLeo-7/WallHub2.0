'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { selectRangeCoverage } = require('./cacheFiles');
const { createDepotStreamFullCache } = require('./fullCache');

function tick() {
  return new Promise(resolve => setImmediate(resolve));
}

function createHarness(options = {}) {
  const ranges = [];
  const calls = [];
  const pins = new Set();
  let epoch = 1;
  const controller = createDepotStreamFullCache({
    maxRangeBytes: 8,
    getGeneration: () => 1,
    getDemandEpoch: () => epoch,
    selectCoverage: (_entry, start, end) => selectRangeCoverage(ranges, start, end),
    ensureRangeCached: async (_entry, start, end, _login, schedule) => {
      calls.push(['cache', start, end]);
      if (options.ensureRangeCached) return options.ensureRangeCached(schedule);
      ranges.push({ start, end, file: `${start}-${end}.bin` });
      ranges.sort((a, b) => a.start - b.start);
      return `${start}-${end}.bin`;
    },
    getCacheMaxBytes: () => options.cacheMaxBytes || 1024,
    pinCacheFile: file => {
      pins.add(file);
      return () => pins.delete(file);
    },
    resolveDepotLogin: () => ({}),
    isAbortError: error => error && error.name === 'AbortError',
    logger: { warn() {} },
  });
  return { controller, calls, pins };
}

test('full cache fills missing extents sequentially and reports completion', async () => {
  const { controller, calls } = createHarness();
  const entry = { size: 20 };

  assert.equal(controller.start(entry).status, 'caching');
  for (let index = 0; index < 10 && controller.snapshot(entry).status === 'caching'; index++) await tick();

  assert.deepEqual(calls, [
    ['cache', 0, 7],
    ['cache', 8, 15],
    ['cache', 16, 19],
  ]);
  assert.deepEqual(controller.snapshot(entry), {
    status: 'complete', cachedBytes: 20, totalBytes: 20, progress: 1, error: '',
  });
});

test('full cache cancellation aborts active work and remains cancelled', async () => {
  let aborted = false;
  const { controller, calls } = createHarness({
    ensureRangeCached: schedule => new Promise(resolve => {
      schedule.signal.addEventListener('abort', () => { aborted = true; resolve(''); }, { once: true });
    }),
  });
  const entry = { size: 20 };
  controller.start(entry);
  await tick();

  assert.equal(controller.cancel(entry, 'test').status, 'cancelled');
  await tick();

  assert.equal(aborted, true);
  assert.deepEqual(calls, [['cache', 0, 7]]);
  assert.equal(controller.snapshot(entry).status, 'cancelled');
});

test('full cache rejects files larger than the configured cache limit', () => {
  const { controller } = createHarness({ cacheMaxBytes: 10 });
  assert.throws(
    () => controller.start({ size: 20 }),
    error => error.code === 'DEPOT_STREAM_FULL_CACHE_LIMIT' && error.statusCode === 409
  );
});

test('completed full cache stays pinned until its entry is released', async () => {
  const { controller, pins } = createHarness();
  const entry = { size: 8 };
  controller.start(entry);
  for (let index = 0; index < 5 && controller.snapshot(entry).status === 'caching'; index++) await tick();
  assert.equal(pins.size, 1);
  controller.cancel(entry, 'entry-release');
  assert.equal(pins.size, 0);
});
