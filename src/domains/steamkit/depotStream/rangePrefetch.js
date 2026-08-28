'use strict';

function createDepotStreamRangePrefetch(options) {
  const {
    maxRangeBytes,
    firstRangeBytes,
    tailBytes,
    initialBufferBytes,
    aheadBytes,
    workers,
    demandEpochs,
    getGeneration,
    incrementAheadScheduleCount,
    isServerStopping,
    getCacheFile,
    getCacheDir,
    selectCoverage,
    planBlocks,
    clampRange,
    prepareBlock,
    getWorkerKey,
    cancelWorkerPrefetch,
    cancelBlockingWorkerPrefetch,
    isAbortError,
    logger = console,
  } = options;

  function prefetchBlocks(total, start, end) {
    return planBlocks(total, start, end).map(block => ({ start: block.start, end: block.end }));
  }

  function prefetchRange(entry, start, end, depotLogin, reason = 'prefetch', generation = getGeneration(), epoch = 0) {
    const demandKey = getCacheDir(entry);
    if (isServerStopping() || generation !== getGeneration() ||
        epoch !== (demandEpochs.get(demandKey) || 0)) {
      return Promise.resolve('');
    }
    const coverage = selectCoverage(entry, start, end);
    if (coverage.complete) return Promise.resolve(coverage.segments[0] && coverage.segments[0].file || '');
    logger.traceLog?.(`[Depot Stream] ${reason} ${entry.publishedFileId || entry.id} ${start}-${end}`);
    const total = Math.max(0, parseInt(String(entry && entry.size || 0), 10) || 0);
    const blocks = prefetchBlocks(total, start, end);
    const promise = Promise.all(blocks.map((range, blockIndex) => prepareBlock(entry, {
      start: range.start,
      end: range.end,
      responseStart: range.start,
      responseEnd: range.end,
    }, depotLogin, {
      silent: true,
      priority: 'prefetch',
      epoch,
      blockIndex,
    }).catch(err => {
      if (isAbortError(err)) return null;
      throw err;
    })))
      .then(results => {
        if (results.some(result => result === null)) return '';
        const completed = selectCoverage(entry, start, Math.min(total - 1, end));
        return completed.complete && blocks.length > 0
          ? getCacheFile(entry, blocks[blocks.length - 1].start, blocks[blocks.length - 1].end)
          : '';
      })
      .catch(err => {
        if (!isAbortError(err)) {
          logger.warn(`[Depot Stream] ${reason} failed ${entry.publishedFileId || entry.id} ${start}-${end}: ${err.message}`);
        }
        throw err;
      });
    promise.catch(() => {});
    return promise;
  }

  function initialPrefetchPlan(total) {
    const first = clampRange(total, 0, Math.min(firstRangeBytes, maxRangeBytes));
    const initialStart = first ? first.end + 1 : 0;
    const remainingInitialBytes = Math.max(0, initialBufferBytes - initialStart);
    const initial = remainingInitialBytes > 0 && initialStart < total
      ? clampRange(total, initialStart, remainingInitialBytes)
      : null;
    const tailLength = Math.min(Math.max(0, tailBytes || 0), maxRangeBytes, total);
    const tail = tailLength > 0 && total > tailLength
      ? clampRange(total, total - tailLength, tailLength)
      : null;
    return { first, tail, initial };
  }

  function scheduleInitialPrefetch(entry, depotLogin) {
    const total = parseInt(String(entry && entry.size || '0'), 10);
    if (!Number.isFinite(total) || total <= 0) return [];
    const generation = getGeneration();
    const epoch = demandEpochs.get(getCacheDir(entry)) || 0;
    const tasks = [];
    const { first, tail, initial } = initialPrefetchPlan(total);
    const firstTask = first
      ? prefetchRange(entry, first.start, first.end, depotLogin, 'first-buffer', generation, epoch)
      : Promise.resolve('');
    if (first) tasks.push(firstTask);
    if (tail) {
      const tailTask = firstTask
        .then(() => prefetchRange(entry, tail.start, tail.end, depotLogin, 'tail-metadata', generation, epoch))
        .catch(() => {});
      tasks.push(tailTask);
    }
    if (initial) {
      const initialTask = firstTask
        .then(() => prefetchRange(entry, initial.start, initial.end, depotLogin, 'initial-buffer', generation, epoch))
        .catch(() => {});
      tasks.push(initialTask);
    }
    return tasks;
  }

  function scheduleAheadPrefetch(entry, currentStart, currentEnd, depotLogin, epoch = 0) {
    const total = parseInt(String(entry && entry.size || '0'), 10);
    if (!Number.isFinite(total) || total <= 0 || aheadBytes <= 0) return;
    const generation = getGeneration();
    const aheadStart = Math.min(total - 1, Math.max(0, currentEnd + 1));
    const aheadRange = clampRange(total, aheadStart, aheadBytes);
    if (aheadRange) {
      incrementAheadScheduleCount();
      prefetchRange(entry, aheadRange.start, aheadRange.end, depotLogin, 'ahead-buffer', generation, epoch).catch(() => {});
    }
  }

  function nextDemandEpoch(entry) {
    const key = getCacheDir(entry);
    const epoch = (demandEpochs.get(key) || 0) + 1;
    demandEpochs.set(key, epoch);
    return epoch;
  }

  function cancelEntryPrefetch(entry, depotLogin) {
    const worker = workers.get(getWorkerKey(entry, depotLogin));
    if (worker && !worker.closed) cancelWorkerPrefetch(worker);
  }

  function cancelEntryBlockingPrefetch(entry, depotLogin) {
    const worker = workers.get(getWorkerKey(entry, depotLogin));
    return !!(worker && !worker.closed && cancelBlockingWorkerPrefetch(worker));
  }

  return {
    prefetchBlocks,
    prefetchRange,
    initialPrefetchPlan,
    scheduleInitialPrefetch,
    scheduleAheadPrefetch,
    nextDemandEpoch,
    cancelEntryPrefetch,
    cancelEntryBlockingPrefetch,
  };
}

module.exports = { createDepotStreamRangePrefetch };
