'use strict';

const fs = require('fs');
const path = require('path');
const { createDepotStreamRangeTaskCoordination } = require('./rangeTaskCoordination');
const { createDepotStreamRangePrefetch } = require('./rangePrefetch');

function createDepotStreamRangeTasks(options) {
  const {
    maxRangeBytes,
    firstRangeBytes,
    tailBytes,
    initialBufferBytes,
    aheadBytes,
    rangePromises,
    workers,
    demandEpochs,
    activeTempFiles,
    getGeneration,
    incrementAheadScheduleCount,
    isServerStopping,
    getCacheFile,
    getCacheDir,
    selectCoverage,
    commitCacheRange,
    planBlocks,
    clampRange,
    getWorker,
    getWorkerKey,
    stopWorker,
    requestWorkerRange,
    cancelWorkerJob,
    cancelWorkerPrefetch,
    cancelBlockingWorkerPrefetch,
    promoteWorkerJob,
    setWorkerJobSchedule,
    createAbortError,
    isAbortError,
    shouldStopWorkerForRangeError,
    ensureDir,
    scheduleTempCleanup,
    reserveCacheWrite,
    waitForCacheWrite,
    releaseCacheWrite,
    getMaxDownloads,
    recordNetworkSample,
    recordMetric,
    logger = console,
  } = options;

  const coordination = createDepotStreamRangeTaskCoordination({
    rangePromises,
    demandEpochs,
    getCacheDir,
    cancelWorkerJob,
    promoteWorkerJob,
    setWorkerJobSchedule,
    createAbortError,
  });
  const {
    rangePromiseKey,
    rangeTaskReusable,
    findInFlightRange,
    cancelRangeTask,
    notifyRangeTaskProgress,
    waitForRangeTaskProgress,
    normalizeWaiter,
    promoteRangeTask,
    reconcileRangeTaskWaiters,
    waitForRangeTask,
  } = coordination;

  function prefetchTaskIsCurrent(entry, task) {
    if (!task || task.priority !== 'prefetch') return true;
    return task.epoch === (demandEpochs.get(getCacheDir(entry)) || 0);
  }

  function createRangeTask(entry, start, end, depotLogin, schedule = {}) {
    const cachePath = getCacheFile(entry, start, end);
    const cacheTmpPath = `${cachePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
    const cachePromiseKey = rangePromiseKey(entry, start, end);
    const resolvedCacheTmpPath = path.resolve(cacheTmpPath);
    activeTempFiles.add(resolvedCacheTmpPath);
    const task = {
      start,
      end,
      cachePath,
      cacheTmpPath,
      priority: schedule.priority === 'prefetch' ? 'prefetch' : 'foreground',
      epoch: Number(schedule.epoch || 0),
      blockIndex: Number.isFinite(schedule.blockIndex) ? schedule.blockIndex : Number.MAX_SAFE_INTEGER,
      waiters: new Map(),
      demandKey: getCacheDir(entry),
      worker: null,
      job: null,
      cancelled: false,
      settled: false,
      committed: false,
      downloadedUntil: start,
      servedUntil: start,
      progressWaiters: new Set(),
      activeReaders: 0,
      readerWaiters: new Set(),
      error: null,
      promise: null,
    };
    task.waitForProgress = (absoluteCursor, signal) => waitForRangeTaskProgress(task, absoluteCursor, signal);
    task.beginRead = () => { task.activeReaders++; };
    task.endRead = () => {
      task.activeReaders = Math.max(0, task.activeReaders - 1);
      if (task.activeReaders > 0) return;
      const waiters = Array.from(task.readerWaiters);
      task.readerWaiters.clear();
      for (const waiter of waiters) waiter();
    };
    task.waitForReaders = () => task.activeReaders === 0
      ? Promise.resolve()
      : new Promise(resolve => task.readerWaiters.add(resolve));
    recordMetric?.(entry, 'range_queued', {
      start,
      end,
      priority: task.priority,
      epoch: task.epoch,
    });
    task.promise = (async () => {
      const expected = end - start + 1;
      const reservation = schedule.priority === 'prefetch' || !waitForCacheWrite
        ? await reserveCacheWrite(expected, resolvedCacheTmpPath)
        : await waitForCacheWrite(expected, resolvedCacheTmpPath, schedule.signal);
      if (!reservation) {
        const error = schedule.priority === 'prefetch'
          ? createAbortError('Depot stream cache quota reached')
          : new Error('Depot stream cache quota reached');
        error.code = 'DEPOT_STREAM_CACHE_QUOTA';
        throw error;
      }
      task.cacheReservation = reservation;
      ensureDir(path.dirname(cachePath));
      try { if (fs.existsSync(cacheTmpPath)) fs.rmSync(cacheTmpPath, { force: true }); } catch {}
      const worker = await getWorker(entry, depotLogin);
      task.worker = worker;
      if (!worker.tempCleanupPaths) worker.tempCleanupPaths = new Set();
      worker.tempCleanupPaths.add(resolvedCacheTmpPath);
      if (task.cancelled || !prefetchTaskIsCurrent(entry, task)) {
        task.cancelled = true;
        throw createAbortError('Stale depot stream prefetch cancelled');
      }
      let lastSampleAt = 0;
      let lastSampleBytes = 0;
      const onProgress = (bytes, at) => {
        const downloadedBytes = Math.max(0, Math.min(expected, Number(bytes) || 0));
        if (downloadedBytes <= task.downloadedUntil - start) return;
        task.downloadedUntil = start + downloadedBytes;
        if (!task.firstReadableAt) {
          task.firstReadableAt = at;
          recordMetric?.(entry, 'range_first_readable', {
            start,
            end,
            bytes: downloadedBytes,
            elapsedMs: task.job && task.job.dispatchedAt ? at - task.job.dispatchedAt : 0,
          });
        }
        if (recordNetworkSample) {
          const sampleStartedAt = lastSampleAt || task.job && task.job.dispatchedAt || at - 1;
          recordNetworkSample(entry, downloadedBytes - lastSampleBytes, Math.max(1, at - sampleStartedAt));
        }
        lastSampleAt = at;
        lastSampleBytes = downloadedBytes;
        notifyRangeTaskProgress(task);
      };
      const workerPromise = requestWorkerRange(worker, start, end, cacheTmpPath, Object.assign({}, task, {
        onProgress,
        playbackSessionId: entry.depotPlaybackSessionId || '',
      }));
      task.job = workerPromise.job;
      if (task.cancelled) cancelWorkerJob(worker, task.job);
      try {
        await workerPromise;
      } catch (err) {
        if (shouldStopWorkerForRangeError(err)) stopWorker(worker, `range-failed ${start}-${end}`, err);
        throw err;
      }
      if (task.cancelled) throw createAbortError();
      const stat = fs.statSync(cacheTmpPath);
      if (stat.size !== expected) throw new Error(`Depot stream range incomplete ${start}-${end}: ${stat.size}/${expected}`);
      onProgress(expected, Date.now());
      await task.waitForReaders();
      if (fs.existsSync(cachePath)) fs.rmSync(cachePath, { force: true });
      fs.renameSync(cacheTmpPath, cachePath);
      task.committed = true;
      task.committedAt = Date.now();
      if (commitCacheRange) commitCacheRange(entry, start, end, cachePath);
      releaseCacheWrite(reservation, expected);
      task.cacheReservation = null;
      if (recordNetworkSample && task.job && task.job.dispatchedAt && !lastSampleAt) {
        recordNetworkSample(entry, expected, Math.max(1, Date.now() - task.job.dispatchedAt));
      }
      recordMetric?.(entry, 'range_committed', {
        start,
        end,
        bytes: expected,
        elapsedMs: task.job && task.job.dispatchedAt ? Date.now() - task.job.dispatchedAt : 0,
      });
      if (!schedule.silent) logger.traceLog?.(`[Depot Stream] cached ${entry.publishedFileId || entry.id} ${start}-${end}`);
      return cachePath;
    })().catch(err => {
      task.error = err;
      if (isAbortError(err)) {
        entry.depotCancelledWasteBytes = Number(entry.depotCancelledWasteBytes || 0) +
          Math.max(0, task.downloadedUntil - task.start);
      }
      throw err;
    }).finally(() => {
      task.settled = true;
      notifyRangeTaskProgress(task);
      if (task.cacheReservation) releaseCacheWrite(task.cacheReservation);
      activeTempFiles.delete(resolvedCacheTmpPath);
      scheduleTempCleanup(resolvedCacheTmpPath, task.worker);
      if (rangePromises.get(cachePromiseKey) === task) rangePromises.delete(cachePromiseKey);
    });
    task.promise.catch(() => {});
    rangePromises.set(cachePromiseKey, task);
    return task;
  }

  function acquireRangeTask(entry, start, end, depotLogin, schedule = {}) {
    const cachePromiseKey = rangePromiseKey(entry, start, end);
    let task = rangePromises.get(cachePromiseKey) || findInFlightRange(entry, start, end);
    if (!rangeTaskReusable(task)) task = null;
    if (!task) task = createRangeTask(entry, start, end, depotLogin, schedule);
    const waiter = Symbol('depot-stream-consumer');
    task.waiters.set(waiter, normalizeWaiter(schedule));
    promoteRangeTask(task, schedule);
    reconcileRangeTaskWaiters(task);
    let released = false;
    return {
      task,
      retain() {
        if (released || task.settled) return;
        const retention = Symbol('depot-stream-retention');
        task.waiters.set(retention, {
          priority: 'prefetch',
          epoch: Number(schedule.epoch || 0),
          blockIndex: Number.isFinite(schedule.blockIndex) ? schedule.blockIndex : Number.MAX_SAFE_INTEGER,
        });
        task.promise.finally(() => task.waiters.delete(retention)).catch(() => {});
      },
      release() {
        if (released) return;
        released = true;
        task.waiters.delete(waiter);
        reconcileRangeTaskWaiters(task);
      },
    };
  }

  async function prepareStreamingBlock(entry, block, depotLogin, schedule = {}) {
    const coverage = selectCoverage(entry, block.start, block.end);
    const pieces = [];
    const acquisitions = [];
    for (const segment of coverage.segments) {
      const start = Math.max(block.responseStart, segment.start);
      const end = Math.min(block.responseEnd, segment.end);
      if (start > end) continue;
      pieces.push({
        type: 'cache',
        start,
        end,
        segment: Object.assign({}, segment, {
          start,
          end,
          offset: segment.offset + start - segment.start,
        }),
      });
    }
    for (const gap of coverage.gaps) {
      const acquired = acquireRangeTask(entry, gap.start, gap.end, depotLogin, schedule);
      acquisitions.push(acquired);
      const start = Math.max(block.responseStart, gap.start);
      const end = Math.min(block.responseEnd, gap.end);
      if (start <= end) pieces.push({ type: 'task', start, end, task: acquired.task });
    }
    pieces.sort((a, b) => a.start - b.start);
    try {
      const first = pieces[0];
      if (first && first.type === 'task') {
        await waitForRangeTaskProgress(first.task, first.start, schedule.signal);
      }
    } catch (err) {
      for (const acquisition of acquisitions) acquisition.release();
      throw err;
    }
    let released = false;
    return {
      pieces,
      retain() {
        for (const acquisition of acquisitions) acquisition.retain();
      },
      release() {
        if (released) return;
        released = true;
        for (const acquisition of acquisitions) acquisition.release();
      },
    };
  }

  async function ensureRangeCached(entry, start, end, depotLogin, schedule = {}) {
    let coverage = selectCoverage(entry, start, end);
    if (coverage.complete) return coverage.segments[0] && coverage.segments[0].file || '';
    const cachePromiseKey = rangePromiseKey(entry, start, end);
    let task = rangePromises.get(cachePromiseKey) || findInFlightRange(entry, start, end);
    if (!rangeTaskReusable(task)) task = null;
    if (!task) task = createRangeTask(entry, start, end, depotLogin, schedule);
    await waitForRangeTask(task, schedule.signal, schedule);
    coverage = selectCoverage(entry, start, end);
    if (!coverage.complete) throw new Error(`Depot stream range cache was not created ${start}-${end}`);
    return coverage.segments[0] && coverage.segments[0].file || '';
  }

  async function prepareBlock(entry, block, depotLogin, schedule = {}) {
    let coverage = selectCoverage(entry, block.start, block.end);
    if (!coverage.complete) {
      await Promise.all(coverage.gaps.map((gap, gapIndex) => ensureRangeCached(
        entry,
        gap.start,
        gap.end,
        depotLogin,
        Object.assign({}, schedule, { blockIndex: (schedule.blockIndex || 0) + gapIndex / 1000 })
      )));
      coverage = selectCoverage(entry, block.start, block.end);
    }
    if (!coverage.complete) throw new Error(`Depot stream block cache incomplete ${block.start}-${block.end}`);
    const responseCoverage = selectCoverage(entry, block.responseStart, block.responseEnd);
    if (!responseCoverage.complete) throw new Error(`Depot stream response cache incomplete ${block.responseStart}-${block.responseEnd}`);
    return responseCoverage.segments;
  }

  const prefetch = createDepotStreamRangePrefetch({
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
    logger,
  });

  return {
    rangePromiseKey,
    rangeTaskReusable,
    findInFlightRange,
    cancelRangeTask,
    promoteRangeTask,
    reconcileRangeTaskWaiters,
    waitForRangeTask,
    prefetchTaskIsCurrent,
    prefetchBlocks: prefetch.prefetchBlocks,
    initialPrefetchPlan: prefetch.initialPrefetchPlan,
    createRangeTask,
    acquireRangeTask,
    waitForRangeTaskProgress,
    prepareStreamingBlock,
    ensureRangeCached,
    prepareBlock,
    prefetchRange: prefetch.prefetchRange,
    scheduleInitialPrefetch: prefetch.scheduleInitialPrefetch,
    scheduleAheadPrefetch: prefetch.scheduleAheadPrefetch,
    nextDemandEpoch: prefetch.nextDemandEpoch,
    cancelEntryPrefetch: prefetch.cancelEntryPrefetch,
    cancelEntryBlockingPrefetch: prefetch.cancelEntryBlockingPrefetch,
  };
}

module.exports = { createDepotStreamRangeTasks };
