'use strict';

function createDepotStreamFullCache(options) {
  const {
    maxRangeBytes,
    getGeneration,
    getDemandEpoch,
    selectCoverage,
    ensureRangeCached,
    getCacheMaxBytes,
    pinCacheFile,
    resolveDepotLogin,
    isAbortError,
    recordMetric,
    logger = console,
  } = options;

  function totalBytes(entry) {
    return Math.max(0, parseInt(String(entry && entry.size || 0), 10) || 0);
  }

  function coverageBytes(entry, total) {
    if (!total) return 0;
    const coverage = selectCoverage(entry, 0, total - 1);
    return coverage.segments.reduce((sum, segment) => sum + segment.end - segment.start + 1, 0);
  }

  function snapshot(entry) {
    const total = totalBytes(entry);
    const task = entry && entry.depotFullCacheTask;
    const cached = task ? Math.max(task.cachedBytes, coverageBytes(entry, total)) : coverageBytes(entry, total);
    const status = task && task.status || (total > 0 && cached >= total ? 'complete' : 'idle');
    return {
      status,
      cachedBytes: Math.min(total, cached),
      totalBytes: total,
      progress: total > 0 ? Math.min(1, cached / total) : 0,
      error: task && task.error || '',
    };
  }

  function cancel(entry, reason = 'cancelled') {
    const task = entry && entry.depotFullCacheTask;
    if (!task) return snapshot(entry);
    if (task.status === 'caching') {
      task.status = 'cancelled';
      task.controller.abort();
    }
    if (task.releasePins) task.releasePins();
    recordMetric?.(entry, 'full_cache_cancelled', { reason });
    return snapshot(entry);
  }

  function start(entry) {
    const total = totalBytes(entry);
    if (!total) throw Object.assign(new Error('Depot video size is unavailable'), { statusCode: 409 });
    if (total > getCacheMaxBytes()) {
      const error = new Error('Complete video exceeds the streaming cache limit');
      error.code = 'DEPOT_STREAM_FULL_CACHE_LIMIT';
      error.statusCode = 409;
      throw error;
    }
    const current = entry.depotFullCacheTask;
    if (current && current.status === 'caching') return snapshot(entry);
    const controller = new AbortController();
    const task = {
      controller,
      status: 'caching',
      cachedBytes: coverageBytes(entry, total),
      error: '',
      promise: null,
    };
    const pinnedFiles = new Map();
    task.releasePins = () => {
      for (const release of pinnedFiles.values()) release();
      pinnedFiles.clear();
      task.releasePins = null;
    };
    const pinCoverage = coverage => {
      for (const segment of coverage.segments) {
        if (!pinnedFiles.has(segment.file)) pinnedFiles.set(segment.file, pinCacheFile(segment.file));
      }
    };
    entry.depotFullCacheTask = task;
    recordMetric?.(entry, 'full_cache_started', { cachedBytes: task.cachedBytes, totalBytes: total });
    task.promise = (async () => {
      while (!controller.signal.aborted) {
        const coverage = selectCoverage(entry, 0, total - 1);
        pinCoverage(coverage);
        task.cachedBytes = coverage.segments.reduce(
          (sum, segment) => sum + segment.end - segment.start + 1,
          0
        );
        const gap = coverage.gaps[0];
        if (!gap) {
          task.status = 'complete';
          task.cachedBytes = total;
          recordMetric?.(entry, 'full_cache_complete', { totalBytes: total });
          return;
        }
        const start = gap.start;
        const end = Math.min(gap.end, start + maxRangeBytes - 1);
        const generation = getGeneration();
        const epoch = getDemandEpoch(entry);
        try {
          await ensureRangeCached(entry, start, end, resolveDepotLogin(431960), {
            priority: 'prefetch',
            silent: true,
            signal: controller.signal,
            epoch,
            blockIndex: Number.MAX_SAFE_INTEGER,
          });
        } catch (error) {
          if (controller.signal.aborted) return;
          if (isAbortError(error) && (generation !== getGeneration() || epoch !== getDemandEpoch(entry))) continue;
          throw error;
        }
      }
    })().catch(error => {
      if (controller.signal.aborted) return;
      task.status = 'error';
      task.error = String(error && error.message || error || 'Full cache failed').slice(0, 300);
      recordMetric?.(entry, 'full_cache_failed', { error: task.error });
      logger.warn?.(`[Depot Stream] full cache failed: ${task.error}`);
      if (task.releasePins) task.releasePins();
    });
    task.promise.catch(() => {});
    return snapshot(entry);
  }

  return { start, snapshot, cancel };
}

module.exports = { createDepotStreamFullCache };
