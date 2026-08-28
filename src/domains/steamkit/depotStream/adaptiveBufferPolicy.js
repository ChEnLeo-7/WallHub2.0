'use strict';

const MB = 1024 * 1024;
// Kept as diagnostic compatibility exports. Startup no longer waits for them.
const MIN_CALIBRATION_BYTES = 64 * MB;
const MIN_CALIBRATION_SAMPLES = 4;
const THROUGHPUT_SAFETY_FACTOR = 0.85;
const INITIAL_PEAK_FACTOR = 1.35;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function percentile(values, ratio) {
  if (!values.length) return 0;
  const sorted = values.slice().sort((a, b) => a - b);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * ratio)));
  return sorted[index];
}

function ensureAdaptiveState(entry) {
  if (!entry.depotAdaptiveBuffer) {
    entry.depotAdaptiveBuffer = {
      phase: 'startup',
      controllerPaused: false,
      playbackStarted: false,
      observedPeakFactor: INITIAL_PEAK_FACTOR,
      lastAnchor: null,
      activePauses: 0,
    };
  }
  return entry.depotAdaptiveBuffer;
}

function safeThroughput(entry) {
  const samples = Array.isArray(entry.depotNetworkRateSamples)
    ? entry.depotNetworkRateSamples.slice(-20).map(sample => finite(sample.rate)).filter(rate => rate > 0)
    : [];
  const ewma = Math.max(0, finite(entry.depotNetworkActiveBytesPerSecond));
  if (!samples.length) return ewma * THROUGHPUT_SAFETY_FACTOR;
  const p25 = percentile(samples, 0.25);
  return Math.min(ewma || p25, p25) * THROUGHPUT_SAFETY_FACTOR;
}

function updateObservedPeak(entry, feedback, averageBytesPerSecond) {
  const state = ensureAdaptiveState(entry);
  const anchor = entry.depotPlaybackByteAnchor;
  if (anchor && state.lastAnchor && anchor.byte > state.lastAnchor.byte &&
      anchor.mediaTime > state.lastAnchor.mediaTime && averageBytesPerSecond > 0) {
    const observedRate = (anchor.byte - state.lastAnchor.byte) / (anchor.mediaTime - state.lastAnchor.mediaTime);
    const factor = Math.max(1.1, Math.min(2, observedRate / averageBytesPerSecond));
    state.observedPeakFactor = state.observedPeakFactor * 0.7 + factor * 0.3;
  }
  if (anchor) state.lastAnchor = { byte: anchor.byte, mediaTime: anchor.mediaTime };
  const playbackRate = Math.max(0.25, finite(feedback.playbackRate, 1));
  return averageBytesPerSecond * Math.max(1.1, Math.min(2, state.observedPeakFactor)) * playbackRate;
}

function buildAdaptivePolicy(entry, feedback, bufferStatus, options = {}) {
  const state = ensureAdaptiveState(entry);
  const total = Math.max(0, finite(entry.size));
  const duration = Math.max(0, finite(feedback.duration));
  const playbackRate = Math.max(0.25, finite(feedback.playbackRate, 1));
  const averageBytesPerSecond = duration > 0 ? total / duration : 0;
  const consumptionBytesPerSecond = averageBytesPerSecond * playbackRate;
  const requiredBytesPerSecond = updateObservedPeak(entry, feedback, averageBytesPerSecond);
  const safeThroughputBytesPerSecond = safeThroughput(entry);
  const throughputRatio = consumptionBytesPerSecond > 0
    ? safeThroughputBytesPerSecond / consumptionBytesPerSecond
    : 0;
  const cacheBudgetBytes = Math.max(0, finite(options.cacheBudgetBytes));
  const usableCacheBudgetBytes = Math.max(0, Math.floor(cacheBudgetBytes * 0.85));
  const deliverableSeconds = Math.max(0, finite(bufferStatus.deliverableBufferSeconds));
  const browserSeconds = Math.max(0, finite(bufferStatus.metrics && bufferStatus.metrics.effectiveBufferSeconds));
  const startupBufferSeconds = 0;
  let targetBufferSeconds;
  if (throughputRatio >= 1.5) targetBufferSeconds = 12;
  else if (throughputRatio >= 1) targetBufferSeconds = 20;
  else targetBufferSeconds = 30;
  const budgetSeconds = consumptionBytesPerSecond > 0
    ? usableCacheBudgetBytes / consumptionBytesPerSecond
    : targetBufferSeconds;
  targetBufferSeconds = Math.max(4, Math.min(targetBufferSeconds, budgetSeconds || targetBufferSeconds));
  const recentExtentSeconds = Math.max(0, finite(entry.depotRecentExtentSeconds));
  const emergencySeconds = Math.max(3, recentExtentSeconds * 2);
  const recoverySeconds = Math.max(4, Math.min(targetBufferSeconds, emergencySeconds * 2));
  const stateName = String(feedback.state || '');
  const userPaused = stateName === 'paused' && !feedback.controllerPaused;
  const playbackConfirmed = stateName === 'playing' &&
    (feedback.mediaTimeAdvanced || finite(feedback.readyState) >= 3);
  let playbackDirective = 'none';

  if (options.applyDirective !== false) {
    if (userPaused || stateName === 'ended' || stateName === 'seeking') {
      state.controllerPaused = false;
    } else if (!state.playbackStarted) {
      // The browser owns initial startup. Read-through makes the first bytes
      // available immediately, while the controller fills a bounded window.
      state.phase = 'startup';
      state.controllerPaused = false;
      if (playbackConfirmed) {
        state.playbackStarted = true;
        state.phase = 'steady';
      }
    } else {
      // Native media playback owns waiting and recovery. The controller only
      // adjusts the rolling prefetch window; it never pauses a healthy player.
      state.controllerPaused = false;
      state.phase = 'steady';
    }
  }

  const progressTarget = state.phase === 'recovering' ? recoverySeconds : Math.max(1, targetBufferSeconds);
  const bufferProgress = progressTarget > 0 ? Math.max(0, Math.min(1, deliverableSeconds / progressTarget)) : 1;
  const targetBytes = Math.min(usableCacheBudgetBytes,
    Math.max(0, Math.ceil(targetBufferSeconds * consumptionBytesPerSecond)));
  return {
    playbackDirective,
    bufferPhase: state.phase,
    bufferProgress,
    browserBufferSeconds: browserSeconds,
    safeBufferSeconds: deliverableSeconds,
    startupBufferSeconds,
    resumeBufferSeconds: recoverySeconds,
    targetBufferSeconds,
    emergencyBufferSeconds: emergencySeconds,
    consumptionBytesPerSecond,
    requiredBytesPerSecond,
    safeThroughputBytesPerSecond,
    cacheBudgetBytes,
    targetBytes,
    calibrated: true,
  };
}

function resetAdaptiveDemand(entry) {
  const state = ensureAdaptiveState(entry);
  state.controllerPaused = false;
  state.playbackStarted = false;
  state.phase = 'startup';
  state.lastAnchor = null;
}

module.exports = {
  MIN_CALIBRATION_BYTES,
  MIN_CALIBRATION_SAMPLES,
  buildAdaptivePolicy,
  ensureAdaptiveState,
  resetAdaptiveDemand,
  safeThroughput,
};
