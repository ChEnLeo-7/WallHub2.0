'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MIN_CALIBRATION_BYTES,
  buildAdaptivePolicy,
  ensureAdaptiveState,
} = require('./adaptiveBufferPolicy');

function scenario({ bitrateMbps, throughputRatio, cacheMb = 1024, bufferSeconds = 0, state = 'waiting' }) {
  const duration = 60;
  const bytesPerSecond = bitrateMbps * 1000000 / 8;
  const entry = {
    size: Math.round(bytesPerSecond * duration),
    depotNetworkActiveBytesPerSecond: bytesPerSecond * throughputRatio / 0.85,
    depotNetworkSampleBytes: MIN_CALIBRATION_BYTES,
    depotNetworkRateSamples: [1, 1, 1, 1].map(() => bytesPerSecond * throughputRatio / 0.85),
  };
  return {
    entry,
    feedback: { state, duration, currentTime: 0, playbackRate: 1, controllerPaused: state === 'buffering' },
    status: {
      deliverableBufferSeconds: bufferSeconds,
      metrics: { effectiveBufferSeconds: bufferSeconds },
      fullyCached: false,
    },
    options: { cacheBudgetBytes: cacheMb * 1024 * 1024 },
  };
}

for (const bitrateMbps of [25, 100, 250, 400]) {
  test(`${bitrateMbps}Mbps startup is never blocked by throughput calibration`, () => {
    const input = scenario({ bitrateMbps, throughputRatio: 0.5, bufferSeconds: 0 });
    const result = buildAdaptivePolicy(input.entry, input.feedback, input.status, input.options);
    assert.equal(result.playbackDirective, 'none');
    assert.equal(result.startupBufferSeconds, 0);
    assert.equal(result.bufferPhase, 'startup');
  });
}

test('strategy matrix respects cache budgets across throughput ratios', () => {
  for (const bitrateMbps of [25, 100, 250, 400]) {
    for (const throughputRatio of [0.5, 0.9, 1, 1.25, 2]) {
      for (const cacheMb of [512, 1024, 4096]) {
        const input = scenario({ bitrateMbps, throughputRatio, cacheMb, bufferSeconds: 0 });
        const result = buildAdaptivePolicy(input.entry, input.feedback, input.status, input.options);
        assert.ok(result.targetBytes <= Math.floor(cacheMb * 1024 * 1024 * 0.85));
        assert.ok(['startup', 'steady', 'recovering'].includes(result.bufferPhase));
      }
    }
  }
});

test('conservative throughput follows the lower tail during a sudden drop or jitter', () => {
  const input = scenario({ bitrateMbps: 100, throughputRatio: 2, bufferSeconds: 0 });
  input.entry.depotNetworkActiveBytesPerSecond = 20_000_000;
  input.entry.depotNetworkRateSamples = [20_000_000, 21_000_000, 5_000_000, 6_000_000]
    .map(rate => ({ rate }));
  const result = buildAdaptivePolicy(input.entry, input.feedback, input.status, input.options);
  assert.equal(result.safeThroughputBytesPerSecond, 5_000_000 * 0.85);
});

test('rolling target grows conservatively as sustainable throughput falls', () => {
  const fast = scenario({ bitrateMbps: 100, throughputRatio: 2 });
  const equal = scenario({ bitrateMbps: 100, throughputRatio: 1 });
  const slow = scenario({ bitrateMbps: 100, throughputRatio: 0.5 });
  assert.equal(buildAdaptivePolicy(fast.entry, fast.feedback, fast.status, fast.options).targetBufferSeconds, 12);
  assert.equal(buildAdaptivePolicy(equal.entry, equal.feedback, equal.status, equal.options).targetBufferSeconds, 20);
  assert.equal(buildAdaptivePolicy(slow.entry, slow.feedback, slow.status, slow.options).targetBufferSeconds, 30);
});

test('startup proceeds without a 64 MiB disk reserve or network samples', () => {
  const duration = 36 * 60;
  const entry = { size: 4 * 1024 * 1024 * 1024 };
  const feedback = {
    state: 'buffering', duration, currentTime: 0, playbackRate: 1, controllerPaused: true,
  };
  const result = buildAdaptivePolicy(entry, feedback, {
    deliverableBufferSeconds: 0,
    metrics: { effectiveBufferSeconds: 0 },
    fullyCached: false,
  }, { cacheBudgetBytes: 3 * 1024 * 1024 * 1024 });

  assert.equal(result.calibrated, true);
  assert.equal(result.playbackDirective, 'none');
  assert.equal(result.startupBufferSeconds, 0);
});

test('strict cache budget caps the rolling window without expanding toward the complete file', () => {
  const input = scenario({ bitrateMbps: 400, throughputRatio: 0.5, cacheMb: 512, bufferSeconds: 0 });
  const result = buildAdaptivePolicy(input.entry, input.feedback, input.status, input.options);
  assert.equal(result.startupBufferSeconds, 0);
  assert.ok(result.targetBufferSeconds <= 30);
  assert.ok(result.targetBytes <= Math.floor(512 * 1024 * 1024 * 0.85));
  assert.equal(result.playbackDirective, 'none');
});

test('native playback owns waiting and recovery after playback starts', () => {
  const input = scenario({ bitrateMbps: 100, throughputRatio: 0.9, bufferSeconds: 20, state: 'playing' });
  const adaptive = ensureAdaptiveState(input.entry);
  adaptive.playbackStarted = true;
  adaptive.controllerPaused = false;
  input.entry.depotRecentExtentSeconds = 2;
  input.status.deliverableBufferSeconds = 3.9;
  input.feedback.state = 'waiting';
  const result = buildAdaptivePolicy(input.entry, input.feedback, input.status, input.options);
  assert.equal(result.playbackDirective, 'none');
  assert.equal(result.bufferPhase, 'steady');
  assert.equal(adaptive.controllerPaused, false);
  assert.equal(adaptive.activePauses, 0);
});

test('user pause never receives an automatic play directive', () => {
  const input = scenario({ bitrateMbps: 25, throughputRatio: 2, bufferSeconds: 30, state: 'paused' });
  const adaptive = ensureAdaptiveState(input.entry);
  adaptive.playbackStarted = true;
  adaptive.controllerPaused = true;
  const result = buildAdaptivePolicy(input.entry, input.feedback, input.status, input.options);
  assert.equal(result.playbackDirective, 'none');
  assert.equal(adaptive.controllerPaused, false);
});
