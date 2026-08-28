'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDepotStreamPlaybackFeedback } = require('./playbackFeedback');

function createHarness(options = {}) {
  const calls = [];
  let epoch = 1;
  let pending = null;
  const controller = createDepotStreamPlaybackFeedback({
    maxRangeBytes: 8,
    maxAheadBytes: 64,
    getGeneration: () => 1,
    getDemandEpoch: () => epoch,
    nextDemandEpoch: () => ++epoch,
    cancelEntryPrefetch: () => calls.push(['cancel']),
    prefetchRange: (_entry, start, end, _login, reason) => {
      calls.push(['prefetch', start, end, reason]);
      pending = options.prefetchRange ? options.prefetchRange(_entry, start, end) : Promise.resolve('cached');
      return pending;
    },
    selectCoverage: options.selectCoverage || ((_entry, start) => ({ gaps: [{ start: start + (options.cachedBytes ?? 100) }] })),
    getMaxDownloads: () => options.maxDownloads || 24,
    resolveDepotLogin: () => ({}),
    incrementAheadScheduleCount: () => calls.push(['ahead']),
    logger: { log() {}, info() {} },
  });
  return { controller, calls, getEpoch: () => epoch, getPending: () => pending };
}

test('low playback buffer starts one bounded continuous refill window', () => {
  const { controller, calls } = createHarness({
    cachedBytes: 10,
    prefetchRange: () => new Promise(() => {}),
  });
  const entry = { size: 1000, depotPlaybackCursor: 100, depotNetworkBytesPerSecond: 50 };
  const result = controller.apply(entry, {
    sequence: 1,
    state: 'playing',
    currentTime: 10,
    duration: 100,
    bufferedEnd: 12,
    playbackRate: 1,
  });

  assert.equal(result.scheduled, true);
  assert.equal(result.browserBufferSeconds, 2);
  assert.equal(result.cachedBufferSeconds, 1);
  assert.equal(result.safeBufferSeconds, 3);
  assert.ok(result.targetBufferSeconds >= 30);
  assert.equal(result.maxParallel, 24);
  assert.deepEqual(calls, [['prefetch', 130, 135, 'playback-buffer']]);
});

test('playback diagnostics report the configured download concurrency unchanged', () => {
  const { controller } = createHarness({ maxDownloads: 31 });
  const result = controller.apply({ size: 1000 }, {
    sequence: 1,
    state: 'playing',
    currentTime: 10,
    duration: 100,
    bufferedEnd: 20,
    playbackRate: 1,
  });

  assert.equal(result.maxParallel, 31);
});

test('failed playback prefetch does not advance the committed cursor', async () => {
  const { controller, getPending } = createHarness({
    cachedBytes: 0,
    prefetchRange: () => Promise.reject(new Error('download failed')),
  });
  const entry = { size: 1000, depotPlaybackCursor: 100 };

  controller.apply(entry, {
    sequence: 1, state: 'playing', currentTime: 10, duration: 100, bufferedEnd: 12, playbackRate: 1,
  });
  await assert.rejects(getPending(), /download failed/);
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(entry.depotPlaybackCursor, 100);
});

test('completed refill chains immediately until the target without waiting for new feedback', async () => {
  let cachedEnd = 20;
  const { controller, calls } = createHarness({
    cachedBytes: 0,
    selectCoverage: (_entry, start) => ({ gaps: [{ start: Math.max(start, cachedEnd) }] }),
    prefetchRange: (_entry, _start, end) => {
      cachedEnd = Math.max(cachedEnd, end + 1);
      return Promise.resolve('cached');
    },
  });
  const entry = { size: 200, depotNetworkBytesPerSecond: 50 };
  const originalApply = controller.apply;
  const result = originalApply(entry, {
    sequence: 1, state: 'playing', currentTime: 10, duration: 100, bufferedEnd: 12, playbackRate: 1,
  });
  assert.equal(result.scheduled, true);

  for (let index = 0; index < 10; index++) {
    await new Promise(resolve => setImmediate(resolve));
    if (!entry.depotFeedbackPrefetch) break;
  }

  const prefetches = calls.filter(call => call[0] === 'prefetch');
  assert.ok(prefetches.length > 1);
  assert.equal(prefetches[1][3], 'playback-refill');
  assert.ok(prefetches.length < 30);
});

test('background refill policy evaluation does not take ownership of native startup', () => {
  const { controller } = createHarness();
  const entry = {
    size: 64 * 1024 * 1024,
    depotNetworkSampleBytes: 64 * 1024 * 1024,
    depotNetworkRateSamples: [1, 1, 1, 1].map(rate => ({ rate })),
  };
  const feedback = controller.normalize({
    sequence: 1, state: 'buffering', currentTime: 0, duration: 100, bufferedEnd: 100,
    playbackRate: 1, controllerPaused: true,
  });
  const status = controller.bufferStatus(entry, feedback);
  const background = controller.adaptivePolicy(entry, feedback, status, false);
  assert.equal(background.playbackDirective, 'none');
  assert.equal(entry.depotAdaptiveBuffer.playbackStarted, false);

  const foreground = controller.adaptivePolicy(entry, feedback, status);
  assert.equal(foreground.playbackDirective, 'none');
  assert.equal(entry.depotAdaptiveBuffer.controllerPaused, false);
});

test('the first progress update contributes to throughput calibration', () => {
  const { controller } = createHarness();
  const entry = {};
  controller.recordNetworkSample(entry, 16 * 1024 * 1024, 1000);
  assert.equal(entry.depotNetworkSampleBytes, 16 * 1024 * 1024);
  assert.equal(entry.depotNetworkRateSamples.length, 1);
});

test('browser emergency buffer starts refill even when server cache exceeds the target', () => {
  const { controller, calls } = createHarness({
    cachedBytes: 300,
    prefetchRange: () => new Promise(() => {}),
  });
  const entry = { size: 1000, depotNetworkBytesPerSecond: 50 };

  const result = controller.apply(entry, {
    sequence: 1, state: 'playing', currentTime: 10, duration: 100, bufferedEnd: 11, playbackRate: 1,
  });

  assert.equal(result.browserBufferSeconds, 1);
  assert.equal(result.browserLowBufferSeconds, 2);
  assert.equal(result.scheduled, true);
  assert.equal(calls.filter(call => call[0] === 'prefetch').length, 1);
});

test('a refill from an old demand epoch cannot advance or continue after seeking', async () => {
  let resolvePrefetch;
  const { controller, calls } = createHarness({
    cachedBytes: 0,
    prefetchRange: () => new Promise(resolve => { resolvePrefetch = resolve; }),
  });
  const entry = { size: 1000, depotPlaybackCursor: 100 };
  controller.apply(entry, {
    sequence: 1, state: 'waiting', currentTime: 10, duration: 100, bufferedEnd: 12, playbackRate: 1,
  });
  controller.apply(entry, {
    sequence: 2, state: 'seeking', currentTime: 50, duration: 100, bufferedEnd: 50, playbackRate: 1,
  });

  resolvePrefetch('cached');
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(entry.depotPlaybackCursor, 100);
  assert.equal(calls.filter(call => call[0] === 'prefetch').length, 1);
});

test('a foreground range from an old epoch cannot complete a newer seek', () => {
  const { controller } = createHarness();
  const entry = { size: 1000, depotAwaitingSeekRange: true, depotPlaybackCursor: 100 };

  assert.equal(controller.onRangeComplete(entry, 100, 107, null, 0), false);
  assert.equal(entry.depotAwaitingSeekRange, true);
  assert.equal(entry.depotPlaybackCursor, 100);
});

test('high buffer, pause, and seeking cancel old prefetch without scheduling more', () => {
  const { controller, calls, getEpoch } = createHarness();
  const entry = { size: 1000, depotPlaybackCursor: 100 };

  const high = controller.apply(entry, {
    sequence: 1, state: 'playing', currentTime: 1, duration: 100, bufferedEnd: 40, playbackRate: 1,
  });
  assert.equal(high.scheduled, false);
  assert.equal(high.safeBufferSeconds, 49);
  assert.equal(getEpoch(), 2);
  assert.deepEqual(calls, [['cancel']]);

  const seeking = controller.apply(entry, {
    sequence: 2, state: 'seeking', currentTime: 60, duration: 100, bufferedEnd: 60, playbackRate: 1,
  });
  assert.equal(seeking.scheduled, false);
  assert.equal(entry.depotAwaitingSeekRange, true);
  assert.equal(getEpoch(), 3);
  assert.deepEqual(calls, [['cancel'], ['cancel']]);
});

test('seeked feedback waits for the first foreground range and rejects stale sequences', () => {
  const { controller, calls } = createHarness();
  const entry = { size: 1000, depotPlaybackCursor: 100 };
  controller.apply(entry, {
    sequence: 2, state: 'seeking', currentTime: 50, duration: 100, bufferedEnd: 50, playbackRate: 1,
  });

  const current = controller.apply(entry, {
    sequence: 3, state: 'playing', currentTime: 50, duration: 100, bufferedEnd: 52, playbackRate: 1,
  });
  assert.equal(current.awaitingRange, true);
  assert.equal(current.safeBufferSeconds, 12);
  const stale = controller.apply(entry, {
    sequence: 2, state: 'playing', currentTime: 1, duration: 100, bufferedEnd: 2, playbackRate: 1,
  });
  assert.equal(stale.accepted, false);
  assert.equal(stale.stale, true);

  controller.onRangeComplete(entry, 500, 507);
  assert.equal(entry.depotAwaitingSeekRange, false);
  assert.equal(calls.at(-1)[0], 'prefetch');
  assert.equal(calls.at(-1)[3], 'playback-buffer');
  assert.ok(calls.at(-1)[2] - calls.at(-1)[1] + 1 <= 8);
});

test('network samples track active speed and end-to-end duty-cycle throughput', (t) => {
  let now = 10000;
  t.mock.method(Date, 'now', () => now);
  const { controller } = createHarness();
  const entry = {};
  controller.recordNetworkSample(entry, 1000, 1000);
  now += 1000;
  controller.recordNetworkSample(entry, 2000, 1000);
  assert.equal(entry.depotNetworkActiveBytesPerSecond, 1300);
  assert.equal(entry.depotNetworkBytesPerSecond, 1500);
  assert.ok(entry.depotNetworkVariation > 0);
});

test('weak or unstable throughput raises refill and resume watermarks', () => {
  const { controller } = createHarness();
  const feedback = controller.normalize({
    state: 'playing', currentTime: 10, duration: 100, bufferedEnd: 12, playbackRate: 1,
  });
  assert.deepEqual(controller.bufferWatermarks({ size: 1000, depotNetworkBytesPerSecond: 5 }, feedback), {
    resume: 8, browserLow: 4, low: 12, target: 30, high: 40,
  });
  assert.deepEqual(controller.bufferWatermarks({
    size: 1000, depotNetworkBytesPerSecond: 50, depotNetworkVariation: 0.5,
  }, feedback), { resume: 6, browserLow: 3, low: 8, target: 20, high: 30 });
});

test('range-observed anchor drives coverage instead of linear VBR byte estimation', () => {
  let selectedStart = -1;
  const { controller } = createHarness({
    selectCoverage: (_entry, start) => {
      selectedStart = start;
      return { gaps: [{ start: start + 20 }] };
    },
    prefetchRange: () => new Promise(() => {}),
  });
  const entry = {
    size: 10000,
    depotNetworkBytesPerSecond: 50,
    depotPlaybackRangeAnchor: { start: 600, end: 999, servedUntil: 700, requestedAt: 10, epoch: 1 },
  };

  const result = controller.apply(entry, {
    sequence: 1,
    state: 'playing',
    currentTime: 10,
    duration: 100,
    bufferedEnd: 12,
    playbackRate: 1,
  });

  assert.equal(selectedStart, 700);
  assert.equal(result.anchorConfidence, 'range-observed');
});

test('feedback distinguishes sustained bandwidth pressure from media decode errors', () => {
  const { controller } = createHarness({ prefetchRange: () => new Promise(() => {}) });
  const entry = { size: 1000, depotNetworkBytesPerSecond: 5 };

  let result;
  for (let sequence = 1; sequence <= 3; sequence++) {
    result = controller.apply(entry, {
      sequence,
      state: 'stalled',
      currentTime: 10,
      duration: 100,
      bufferedEnd: 10,
      playbackRate: 1,
      errorCode: 3,
    });
  }

  assert.equal(result.bandwidthLimited, true);
  assert.equal(result.decodeError, true);
});

test('one weak throughput sample does not report sustained bandwidth pressure', () => {
  const { controller } = createHarness({ prefetchRange: () => new Promise(() => {}) });
  const entry = { size: 1000, depotNetworkBytesPerSecond: 5 };
  const result = controller.apply(entry, {
    sequence: 1, state: 'waiting', currentTime: 10, duration: 100, bufferedEnd: 10, playbackRate: 1,
  });
  assert.equal(result.bandwidthLimited, false);
});

test('ample browser buffer suppresses low duty-cycle bandwidth warnings', () => {
  const { controller } = createHarness({ prefetchRange: () => new Promise(() => {}) });
  const entry = { size: 1000, depotNetworkBytesPerSecond: 5 };
  let result;
  for (let sequence = 1; sequence <= 4; sequence++) {
    result = controller.apply(entry, {
      sequence,
      state: 'playing',
      currentTime: 10 + sequence,
      duration: 100,
      bufferedEnd: 35,
      playbackRate: 1,
      readyState: 4,
      mediaTimeAdvanced: true,
    });
  }
  assert.equal(result.bandwidthLimited, false);
  assert.equal(entry.depotBandwidthPressureSamples, 0);
});

test('active transfer rate prevents a duty-cycle average from causing a warning', () => {
  const now = Date.now();
  const { controller } = createHarness({ prefetchRange: () => new Promise(() => {}) });
  const entry = {
    size: 1000,
    depotNetworkBytesPerSecond: 5,
    depotNetworkActiveBytesPerSecond: 20,
    depotNetworkActiveSampleAt: now,
  };
  let result;
  for (let sequence = 1; sequence <= 3; sequence++) {
    result = controller.apply(entry, {
      sequence,
      state: 'stalled',
      currentTime: 10,
      duration: 100,
      bufferedEnd: 10,
      playbackRate: 1,
    });
  }
  assert.equal(result.bandwidthLimited, false);
});

test('stale active transfer speed does not conceal sustained starvation', (t) => {
  const now = 10000;
  t.mock.method(Date, 'now', () => now);
  const { controller } = createHarness({ prefetchRange: () => new Promise(() => {}) });
  const entry = {
    size: 1000,
    depotNetworkBytesPerSecond: 5,
    depotNetworkActiveBytesPerSecond: 20,
    depotNetworkActiveSampleAt: now - 6000,
  };
  let result;
  for (let sequence = 1; sequence <= 3; sequence++) {
    result = controller.apply(entry, {
      sequence,
      state: 'stalled',
      currentTime: 10,
      duration: 100,
      bufferedEnd: 10,
      playbackRate: 1,
    });
  }
  assert.equal(result.bandwidthLimited, true);
});
