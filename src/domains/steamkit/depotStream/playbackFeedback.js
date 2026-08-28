'use strict';

const {
  buildAdaptivePolicy,
  resetAdaptiveDemand,
} = require('./adaptiveBufferPolicy');

const PLAYBACK_STATES = new Set(['playing', 'paused', 'seeking', 'waiting', 'stalled', 'buffering', 'ended']);
const ACTIVE_NETWORK_SAMPLE_MAX_AGE_MS = 5000;

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function createDepotStreamPlaybackFeedback(options) {
  const {
    maxRangeBytes,
    maxAheadBytes,
    getGeneration,
    getDemandEpoch,
    nextDemandEpoch,
    cancelEntryPrefetch,
    prefetchRange,
    selectCoverage,
    getCacheMaxBytes,
    getMaxDownloads,
    resolveDepotLogin,
    incrementAheadScheduleCount,
    recordMetric,
    onFinished,
    logger = console,
  } = options;

  function playbackId(entry) {
    return String(entry && (entry.publishedFileId || entry.id) || 'unknown');
  }

  function playbackStats(entry) {
    if (!entry.depotPlaybackStats) {
      entry.depotPlaybackStats = {
        createdAt: Date.now(),
        firstPlayingAt: 0,
        stallStartedAt: 0,
        stalls: 0,
        stallMs: 0,
        lastDebugAt: 0,
      };
    }
    return entry.depotPlaybackStats;
  }

  function normalize(payload = {}) {
    const state = String(payload.state || '').trim().toLowerCase();
    if (!PLAYBACK_STATES.has(state)) throw Object.assign(new Error('Invalid playback state'), { statusCode: 400 });
    const duration = Math.max(0, finiteNumber(payload.duration));
    const currentTime = Math.max(0, finiteNumber(payload.currentTime));
    const bufferedRanges = Array.isArray(payload.bufferedRanges) ? payload.bufferedRanges.slice(0, 8)
      .map(range => ({
        start: Math.max(0, finiteNumber(range && range.start)),
        end: Math.max(0, finiteNumber(range && range.end)),
      }))
      .filter(range => range.end >= range.start) : [];
    const activeRange = bufferedRanges.find(range => range.start <= currentTime && range.end >= currentTime);
    const bufferedEnd = Math.max(currentTime, activeRange ? activeRange.end : finiteNumber(payload.bufferedEnd, currentTime));
    return {
      sequence: Math.max(0, Math.floor(finiteNumber(payload.sequence))),
      state,
      currentTime,
      duration,
      bufferedEnd,
      bufferedRanges,
      controllerPaused: !!payload.controllerPaused,
      playbackRate: Math.max(0.25, Math.min(4, finiteNumber(payload.playbackRate, 1))),
      sentAt: Math.max(0, Math.floor(finiteNumber(payload.sentAt))),
      paused: !!payload.paused,
      readyState: Math.max(0, Math.min(4, Math.floor(finiteNumber(payload.readyState)))),
      networkState: Math.max(0, Math.min(3, Math.floor(finiteNumber(payload.networkState)))),
      mediaTimeAdvanced: !!payload.mediaTimeAdvanced,
      errorCode: Math.max(0, Math.min(4, Math.floor(finiteNumber(payload.errorCode)))),
    };
  }

  function updateRangeAnchor(entry, feedback) {
    const range = entry.depotPlaybackRangeAnchor;
    if (!range || feedback.state === 'seeking') return null;
    const total = Math.max(0, Number(entry.size || 0));
    const averageBytesPerSecond = feedback.duration > 0 ? total / feedback.duration : 0;
    const estimatedBufferedByte = feedback.bufferedEnd * averageBytesPerSecond;
    const servedUntil = Math.max(range.start, Number(range.servedUntil || range.start));
    const plausibleStartLimit = estimatedBufferedByte * 2 + maxRangeBytes;
    if (averageBytesPerSecond > 0 && range.start > plausibleStartLimit) return entry.depotPlaybackByteAnchor || null;
    const previous = entry.depotPlaybackByteAnchor;
    if (!previous || range.requestedAt >= previous.rangeRequestedAt) {
      entry.depotPlaybackByteAnchor = {
        byte: servedUntil,
        mediaTime: feedback.bufferedEnd,
        rangeEnd: servedUntil - 1,
        rangeRequestedAt: range.requestedAt,
        feedbackAt: Date.now(),
        confidence: 'range-observed',
      };
    }
    return entry.depotPlaybackByteAnchor;
  }

  function playbackMetrics(entry, feedback) {
    const total = Math.max(0, parseInt(String(entry && entry.size || 0), 10) || 0);
    const averageBytesPerSecond = feedback.duration > 0 ? total / feedback.duration : 0;
    const bufferSeconds = Math.max(0, feedback.bufferedEnd - feedback.currentTime);
    const effectiveBufferSeconds = bufferSeconds / feedback.playbackRate;
    const networkBytesPerSecond = networkThroughput(entry);
    const activeNetworkSampleAt = Math.max(0, finiteNumber(entry && entry.depotNetworkActiveSampleAt));
    const activeNetworkBytesPerSecond = activeNetworkSampleAt && Date.now() - activeNetworkSampleAt <= ACTIVE_NETWORK_SAMPLE_MAX_AGE_MS
      ? Math.max(0, finiteNumber(entry && entry.depotNetworkActiveBytesPerSecond))
      : 0;
    const requiredBytesPerSecond = averageBytesPerSecond * feedback.playbackRate;
    const throughputRatio = requiredBytesPerSecond > 0 ? networkBytesPerSecond / requiredBytesPerSecond : 0;
    const activeThroughputRatio = requiredBytesPerSecond > 0
      ? (activeNetworkBytesPerSecond || networkBytesPerSecond) / requiredBytesPerSecond
      : 0;
    const networkVariation = Math.max(0, finiteNumber(entry && entry.depotNetworkVariation));
    return {
      total,
      averageBytesPerSecond,
      bufferSeconds,
      effectiveBufferSeconds,
      networkBytesPerSecond,
      activeNetworkBytesPerSecond,
      requiredBytesPerSecond,
      throughputRatio,
      activeThroughputRatio,
      networkVariation,
    };
  }

  function bufferWatermarks(entry, feedback) {
    const metrics = playbackMetrics(entry, feedback);
    const unstable = metrics.networkVariation >= 0.35;
    if (!metrics.networkBytesPerSecond || metrics.throughputRatio < 1.2) {
      return { resume: unstable ? 10 : 8, browserLow: 4, low: 12, target: 30, high: 40 };
    }
    if (metrics.throughputRatio < 1.8 || unstable) {
      return { resume: 6, browserLow: 3, low: 8, target: 20, high: 30 };
    }
    return { resume: 3, browserLow: 2, low: 6, target: 14, high: 22 };
  }

  function cachedAhead(entry, feedback) {
    const metrics = playbackMetrics(entry, feedback);
    if (!selectCoverage || !metrics.total || !metrics.averageBytesPerSecond) {
      return { seconds: 0, nextByte: 0 };
    }
    const anchor = entry.depotPlaybackByteAnchor;
    const estimatedStart = anchor && anchor.confidence === 'range-observed'
      ? anchor.byte
      : feedback.bufferedEnd * metrics.averageBytesPerSecond;
    const start = Math.min(metrics.total - 1, Math.max(0, Math.floor(estimatedStart)));
    const coverage = selectCoverage(entry, start, metrics.total - 1);
    const firstGap = coverage.gaps && coverage.gaps[0];
    const end = firstGap ? firstGap.start : metrics.total;
    return {
      seconds: Math.max(0, (end - start) / metrics.averageBytesPerSecond),
      nextByte: firstGap ? firstGap.start : metrics.total,
      anchorConfidence: anchor && anchor.confidence || 'estimated',
    };
  }

  function bufferStatus(entry, feedback) {
    const metrics = playbackMetrics(entry, feedback);
    const cached = cachedAhead(entry, feedback);
    const watermarks = bufferWatermarks(entry, feedback);
    const deliverableBufferSeconds = metrics.effectiveBufferSeconds + cached.seconds / feedback.playbackRate;
    return {
      metrics,
      cached,
      watermarks,
      deliverableBufferSeconds,
      fullyCached: !!(entry.depotFullCacheTask && entry.depotFullCacheTask.status === 'complete'),
    };
  }

  function adaptivePolicy(entry, feedback, status = bufferStatus(entry, feedback), applyDirective = true) {
    return buildAdaptivePolicy(entry, feedback, status, {
      cacheBudgetBytes: getCacheMaxBytes ? getCacheMaxBytes() : Math.max(0, Number(entry.size || 0)),
      applyDirective,
    });
  }

  function shouldStopPrefetch(entry, feedback, status = bufferStatus(entry, feedback), policy = adaptivePolicy(entry, feedback, status)) {
    if (feedback.state === 'seeking' || feedback.state === 'ended') return true;
    if (feedback.state === 'paused' && !feedback.controllerPaused) return true;
    if (status.metrics.effectiveBufferSeconds < status.watermarks.browserLow) return false;
    return status.deliverableBufferSeconds >= policy.targetBufferSeconds;
  }

  function stopPrefetch(entry, reason) {
    if (entry.depotPrefetchStoppedFor === reason) return false;
    entry.depotPrefetchStoppedFor = reason;
    nextDemandEpoch(entry);
    cancelEntryPrefetch(entry, resolveDepotLogin(431960));
    return true;
  }

  function schedule(entry, feedback, reason = 'playback-buffer', knownStatus = null, knownPolicy = null) {
    const status = knownStatus || bufferStatus(entry, feedback);
    const policy = knownPolicy || adaptivePolicy(entry, feedback, status, false);
    const total = status.metrics.total;
    const cursor = Math.max(
      status.cached.nextByte,
      Math.max(0, parseInt(String(entry.depotPlaybackCursor || 0), 10) || 0)
    );
    if (!total || cursor >= total || shouldStopPrefetch(entry, feedback, status, policy)) {
      entry.depotBufferRefillActive = false;
      if (shouldStopPrefetch(entry, feedback, status, policy)) {
        stopPrefetch(entry, feedback.state === 'playing' ? 'buffer-high' : feedback.state);
      }
      return { scheduled: false, stopped: shouldStopPrefetch(entry, feedback, status, policy) };
    }
    if (entry.depotFeedbackPrefetch) return { scheduled: false, pending: true };
    const urgent = feedback.state === 'waiting' || feedback.state === 'stalled' || feedback.state === 'buffering';
    if (urgent || status.metrics.effectiveBufferSeconds < status.watermarks.browserLow ||
        status.deliverableBufferSeconds < status.watermarks.low) {
      entry.depotBufferRefillActive = true;
    }
    const browserBufferUrgent = status.metrics.effectiveBufferSeconds < status.watermarks.browserLow;
    if (!entry.depotBufferRefillActive ||
        (!browserBufferUrgent && status.deliverableBufferSeconds >= policy.targetBufferSeconds)) {
      entry.depotBufferRefillActive = false;
      return { scheduled: false, buffered: true };
    }
    entry.depotPrefetchStoppedFor = '';
    const missingSeconds = Math.max(1, policy.targetBufferSeconds - status.deliverableBufferSeconds);
    const desiredBytes = Math.ceil(policy.consumptionBytesPerSecond * missingSeconds);
    const bytes = Math.max(1, Math.min(maxRangeBytes, maxAheadBytes, desiredBytes || maxRangeBytes));
    const blockEnd = Math.floor(cursor / maxRangeBytes) * maxRangeBytes + maxRangeBytes - 1;
    const end = Math.min(total - 1, blockEnd, cursor + bytes - 1);
    const epoch = getDemandEpoch(entry);
    const generation = getGeneration();
    const promise = prefetchRange(entry, cursor, end, resolveDepotLogin(431960), reason, generation, epoch);
    entry.depotFeedbackPrefetch = promise;
    let refillAdvanced = false;
    promise.then(cachePath => {
      if (cachePath && generation === getGeneration() && epoch === getDemandEpoch(entry)) {
        refillAdvanced = true;
        entry.depotPlaybackCursor = Math.max(
          Math.max(0, parseInt(String(entry.depotPlaybackCursor || 0), 10) || 0),
          end + 1
        );
      }
    }).catch(() => {}).finally(() => {
      if (entry.depotFeedbackPrefetch !== promise) return;
      entry.depotFeedbackPrefetch = null;
      const latest = entry.playbackFeedback;
      if (!refillAdvanced || !latest || !entry.depotBufferRefillActive ||
          generation !== getGeneration() || epoch !== getDemandEpoch(entry) ||
          latest.state === 'paused' || latest.state === 'seeking' || latest.state === 'ended') return;
      queueMicrotask(() => {
        const current = entry.playbackFeedback;
        if (!entry.depotFeedbackPrefetch && current && generation === getGeneration() &&
            epoch === getDemandEpoch(entry)) {
          schedule(entry, current, 'playback-refill');
        }
      });
    });
    return { scheduled: true, start: cursor, end };
  }

  function logFeedback(entry, feedback, previous, status) {
    const stats = playbackStats(entry);
    const metrics = playbackMetrics(entry, feedback);
    const now = Date.now();
    if (feedback.state === 'playing' && !stats.firstPlayingAt) {
      stats.firstPlayingAt = now;
      logger.info?.(`[Depot Playback] playing id=${playbackId(entry)} startupMs=${now - stats.createdAt} buffer=${metrics.bufferSeconds.toFixed(1)}s`);
    }
    if ((feedback.state === 'waiting' || feedback.state === 'stalled') && !stats.stallStartedAt) {
      stats.stallStartedAt = now;
      stats.stalls++;
      logger.info?.(`[Depot Playback] waiting id=${playbackId(entry)} position=${feedback.currentTime.toFixed(1)}s buffer=${metrics.bufferSeconds.toFixed(1)}s`);
    } else if (feedback.state === 'playing' && stats.stallStartedAt) {
      const stallMs = now - stats.stallStartedAt;
      stats.stallStartedAt = 0;
      stats.stallMs += stallMs;
      logger.info?.(`[Depot Playback] recovered id=${playbackId(entry)} stallMs=${stallMs} buffer=${metrics.bufferSeconds.toFixed(1)}s`);
    }
    if (feedback.state === 'seeking' && (!previous || previous.state !== 'seeking')) {
      logger.info?.(`[Depot Playback] seeking id=${playbackId(entry)} position=${feedback.currentTime.toFixed(1)}s`);
    }
    if (now - stats.lastDebugAt >= 5000 || feedback.state !== (previous && previous.state)) {
      stats.lastDebugAt = now;
      const consumeMbps = metrics.requiredBytesPerSecond * 8 / 1000000;
      const networkMbps = metrics.networkBytesPerSecond * 8 / 1000000;
      const activeMbps = metrics.activeNetworkBytesPerSecond * 8 / 1000000;
      logger.log(`[Depot Playback] id=${playbackId(entry)} state=${feedback.state} position=${feedback.currentTime.toFixed(1)}s browser=${metrics.bufferSeconds.toFixed(1)}s cached=${status.cached.seconds.toFixed(1)}s deliverable=${status.deliverableBufferSeconds.toFixed(1)}s consume=${consumeMbps.toFixed(1)}Mbps network=${networkMbps.toFixed(1)}Mbps active=${activeMbps.toFixed(1)}Mbps paused=${feedback.paused} ready=${feedback.readyState} netState=${feedback.networkState} advanced=${feedback.mediaTimeAdvanced} target=${status.watermarks.target}s`);
    }
  }

  function feedbackResult(entry, feedback, knownStatus = null, knownPolicy = null) {
    const status = knownStatus || bufferStatus(entry, feedback);
    const policy = knownPolicy || adaptivePolicy(entry, feedback, status);
    return {
      browserBufferSeconds: status.metrics.bufferSeconds,
      cachedBufferSeconds: status.cached.seconds,
      safeBufferSeconds: status.deliverableBufferSeconds,
      resumeBufferSeconds: policy.resumeBufferSeconds,
      browserLowBufferSeconds: status.watermarks.browserLow,
      targetBufferSeconds: policy.targetBufferSeconds,
      playbackDirective: policy.playbackDirective,
      bufferPhase: policy.bufferPhase,
      bufferProgress: policy.bufferProgress,
      requiredBytesPerSecond: policy.requiredBytesPerSecond,
      safeThroughputBytesPerSecond: policy.safeThroughputBytesPerSecond,
      cacheBudgetBytes: policy.cacheBudgetBytes,
      maxParallel: getMaxDownloads(),
      anchorConfidence: status.cached.anchorConfidence,
      bandwidthLimited: Number(entry.depotBandwidthPressureSamples || 0) >= 3,
      decodeError: feedback.errorCode > 0,
    };
  }

  function updateBandwidthPressure(entry, feedback, status) {
    const metrics = status.metrics;
    const playbackIsStarved = feedback.state === 'waiting' || feedback.state === 'stalled' || (
      feedback.state === 'playing' &&
      !feedback.mediaTimeAdvanced &&
      feedback.readyState < 3
    );
    const bufferIsDepleted = metrics.effectiveBufferSeconds < status.watermarks.browserLow &&
      status.deliverableBufferSeconds < status.watermarks.low;
    if (!playbackIsStarved || !bufferIsDepleted ||
        metrics.requiredBytesPerSecond <= 0 || metrics.activeThroughputRatio <= 0) {
      entry.depotBandwidthPressureSamples = 0;
      return;
    }
    if (metrics.activeThroughputRatio < 1) {
      entry.depotBandwidthPressureSamples = Math.min(10, Number(entry.depotBandwidthPressureSamples || 0) + 1);
    } else if (metrics.activeThroughputRatio >= 1.1) {
      entry.depotBandwidthPressureSamples = 0;
    }
  }

  function apply(entry, payload) {
    const feedback = normalize(payload);
    const previous = entry.playbackFeedback;
    if (previous && feedback.sequence <= previous.sequence) {
      return Object.assign({}, entry.depotAdaptivePolicy || {}, {
        accepted: false,
        stale: true,
        playbackDirective: 'none',
      });
    }
    entry.playbackFeedback = feedback;
    updateRangeAnchor(entry, feedback);
    const status = bufferStatus(entry, feedback);
    if (feedback.state === 'seeking' && (!previous || previous.state !== 'seeking')) {
      resetAdaptiveDemand(entry);
      nextDemandEpoch(entry);
      cancelEntryPrefetch(entry, resolveDepotLogin(431960));
      entry.depotPrefetchStoppedFor = 'seeking';
    }
    const policy = adaptivePolicy(entry, feedback, status);
    entry.depotAdaptivePolicy = policy;
    entry.depotCachePeakBytes = Math.max(Number(entry.depotCachePeakBytes || 0),
      Math.round(status.cached.seconds * status.metrics.averageBytesPerSecond));
    updateBandwidthPressure(entry, feedback, status);
    recordMetric?.(entry, 'browser_feedback', {
      sequence: feedback.sequence,
      state: feedback.state,
      currentTime: feedback.currentTime,
      bufferedEnd: feedback.bufferedEnd,
      readyState: feedback.readyState,
      networkState: feedback.networkState,
      errorCode: feedback.errorCode,
    });
    logFeedback(entry, feedback, previous, status);
    if (feedback.state === 'seeking') entry.depotAwaitingSeekRange = true;
    if (shouldStopPrefetch(entry, feedback, status, policy)) {
      stopPrefetch(entry, feedback.state === 'playing' ? 'buffer-high' : feedback.state);
      entry.depotBufferRefillActive = false;
      return Object.assign({ accepted: true, scheduled: false }, feedbackResult(entry, feedback, status, policy));
    }
    if (entry.depotAwaitingSeekRange) {
      return Object.assign({ accepted: true, scheduled: false, awaitingRange: true }, feedbackResult(entry, feedback, status, policy));
    }
    return Object.assign({ accepted: true }, feedbackResult(entry, feedback, status, policy), schedule(entry, feedback, 'playback-buffer', status, policy));
  }

  function onRangeComplete(entry, start, end, _depotLogin, epoch = getDemandEpoch(entry)) {
    if (epoch !== getDemandEpoch(entry)) return false;
    if (incrementAheadScheduleCount) incrementAheadScheduleCount();
    const wasAwaitingSeekRange = entry.depotAwaitingSeekRange;
    entry.depotAwaitingSeekRange = false;
    entry.depotPlaybackCursor = wasAwaitingSeekRange
      ? Math.max(0, end + 1)
      : Math.max(Math.max(0, parseInt(String(entry.depotPlaybackCursor || 0), 10) || 0), end + 1);
    entry.depotPlaybackAnchorByte = Math.max(0, end + 1);
    if (wasAwaitingSeekRange) entry.depotBufferRefillActive = true;
    const feedback = entry.playbackFeedback;
    if (!feedback) {
      const total = Math.max(0, parseInt(String(entry && entry.size || 0), 10) || 0);
      if (!total || end + 1 >= total) return;
      const epoch = getDemandEpoch(entry);
      prefetchRange(
        entry,
        end + 1,
        Math.min(total - 1, end + maxRangeBytes),
        resolveDepotLogin(431960),
        'startup-ahead',
        getGeneration(),
        epoch
      ).catch(() => {});
      return true;
    }
    schedule(entry, feedback);
    return true;
  }

  function networkThroughput(entry, now = Date.now()) {
    const samples = entry && entry.depotNetworkSamples;
    const startedAt = Math.max(0, finiteNumber(entry && entry.depotNetworkStartedAt));
    if (!Array.isArray(samples) || samples.length === 0 || !startedAt) {
      return Math.max(0, finiteNumber(entry && entry.depotNetworkBytesPerSecond));
    }
    const cutoff = now - 15000;
    while (samples.length > 1 && samples[0].at < cutoff) samples.shift();
    const windowStartedAt = Math.max(startedAt, cutoff);
    const transferred = samples.reduce((total, sample) => total + (sample.at >= windowStartedAt ? sample.bytes : 0), 0);
    return transferred > 0 ? transferred * 1000 / Math.max(1, now - windowStartedAt) : 0;
  }

  function recordNetworkSample(entry, bytes, elapsedMs) {
    if (!entry || bytes <= 0 || elapsedMs <= 0) return;
    const now = Date.now();
    const sample = bytes * 1000 / elapsedMs;
    const previous = Math.max(0, finiteNumber(entry.depotNetworkActiveBytesPerSecond));
    if (previous > 0) {
      const deviation = Math.abs(sample - previous) / Math.max(previous, sample);
      const previousVariation = Math.max(0, finiteNumber(entry.depotNetworkVariation));
      entry.depotNetworkVariation = previousVariation > 0
        ? previousVariation * 0.7 + deviation * 0.3
        : deviation;
    }
    entry.depotNetworkActiveBytesPerSecond = previous > 0 ? previous * 0.7 + sample * 0.3 : sample;
    entry.depotNetworkActiveSampleAt = now;
    if (!entry.depotNetworkStartedAt) entry.depotNetworkStartedAt = now - elapsedMs;
    if (!Array.isArray(entry.depotNetworkSamples)) entry.depotNetworkSamples = [];
    entry.depotNetworkSamples.push({ at: now, bytes });
    if (!Array.isArray(entry.depotNetworkRateSamples)) entry.depotNetworkRateSamples = [];
    entry.depotNetworkRateSamples.push({ at: now, rate: sample });
    if (entry.depotNetworkRateSamples.length > 20) entry.depotNetworkRateSamples.shift();
    entry.depotNetworkSampleBytes = Math.max(0, finiteNumber(entry.depotNetworkSampleBytes)) + bytes;
    entry.depotRecentExtentSeconds = elapsedMs / 1000;
    entry.depotNetworkBytesPerSecond = networkThroughput(entry, now);
  }

  function finish(entry, reason = 'released') {
    if (!entry) return;
    const stats = playbackStats(entry);
    const now = Date.now();
    if (stats.stallStartedAt) {
      stats.stallMs += now - stats.stallStartedAt;
      stats.stallStartedAt = 0;
    }
    const networkMbps = networkThroughput(entry, now) * 8 / 1000000;
    onFinished?.({
      playbackSessionId: String(entry.depotPlaybackSessionId || ''),
      reason: String(reason || 'released').slice(0, 40),
      sessionMs: now - stats.createdAt,
      throughputBytesPerSecond: Math.round(networkThroughput(entry, now)),
      maxParallel: getMaxDownloads(),
      cachePeakBytes: Number(entry.depotCachePeakBytes || 0),
      cancelledWasteBytes: Number(entry.depotCancelledWasteBytes || 0),
      controllerPauses: Number(adaptive.activePauses || 0),
      stalls: stats.stalls,
      stallMs: stats.stallMs,
    });
    logger.info?.(`[Depot Playback] summary id=${playbackId(entry)} reason=${reason} sessionMs=${now - stats.createdAt} stalls=${stats.stalls} stallMs=${stats.stallMs} network=${networkMbps.toFixed(1)}Mbps`);
  }

  return {
    apply,
    normalize,
    playbackMetrics,
    bufferWatermarks,
    bufferStatus,
    adaptivePolicy,
    onRangeComplete,
    recordNetworkSample,
    finish,
  };
}

module.exports = { createDepotStreamPlaybackFeedback };
