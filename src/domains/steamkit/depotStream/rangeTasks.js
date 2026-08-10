'use strict';

const fs = require('fs');
const path = require('path');

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
    planBlocks,
    clampRange,
    getWorker,
    getWorkerKey,
    stopWorker,
    requestWorkerRange,
    cancelWorkerJob,
    cancelWorkerPrefetch,
    promoteWorkerJob,
    setWorkerJobSchedule,
    createAbortError,
    isAbortError,
    shouldStopWorkerForRangeError,
    ensureDir,
    scheduleTempCleanup,
    maybeScheduleCacheCleanupAfterWrite,
    sleep,
  } = options;

  function rangePromiseKey(entry, start, end) {
    return `${getCacheDir(entry)}|${start}-${end}`;
  }

  function rangeTaskReusable(task) {
    return !!task && !task.cancelled && !task.settled && !(task.job && task.job.cancelled);
  }

  function findInFlightRange(entry, start, end) {
    const prefix = `${getCacheDir(entry)}|`;
    for (const [key, task] of rangePromises) {
      if (!key.startsWith(prefix) || !rangeTaskReusable(task)) continue;
      if (task.start <= start && task.end >= end) return task;
    }
    return null;
  }

  function cancelRangeTask(task, reason = 'Depot stream request cancelled') {
    if (!task || task.settled || task.cancelled) return false;
    task.cancelled = true;
    if (task.worker && task.job) cancelWorkerJob(task.worker, task.job, reason);
    return true;
  }

  function promoteRangeTask(task, schedule = {}) {
    if (!task || task.settled || schedule.priority === 'prefetch') return;
    const wasPrefetch = task.priority === 'prefetch';
    task.priority = 'foreground';
    const previousEpoch = Number(task.epoch || 0);
    const promotedEpoch = Number(schedule.epoch || 0);
    const promotedBlockIndex = Number.isFinite(schedule.blockIndex) ? schedule.blockIndex : Number.MAX_SAFE_INTEGER;
    if (wasPrefetch || promotedEpoch > previousEpoch) {
      task.epoch = promotedEpoch;
      task.blockIndex = promotedBlockIndex;
    } else if (promotedEpoch === previousEpoch) {
      task.blockIndex = Math.min(task.blockIndex ?? Number.MAX_SAFE_INTEGER, promotedBlockIndex);
    }
    if (task.worker && task.job) promoteWorkerJob(task.worker, task.job, task);
  }

  function normalizeWaiter(waiter) {
    if (typeof waiter === 'string') {
      return { priority: waiter, epoch: 0, blockIndex: Number.MAX_SAFE_INTEGER };
    }
    return {
      priority: waiter && waiter.priority === 'prefetch' ? 'prefetch' : 'foreground',
      epoch: Number(waiter && waiter.epoch || 0),
      blockIndex: Number.isFinite(waiter && waiter.blockIndex) ? waiter.blockIndex : Number.MAX_SAFE_INTEGER,
    };
  }

  function waiterSchedule(waiters, priority) {
    const candidates = waiters.filter(waiter => waiter.priority === priority);
    if (candidates.length === 0) return null;
    const epoch = Math.max(...candidates.map(waiter => waiter.epoch));
    const blockIndex = Math.min(...candidates.filter(waiter => waiter.epoch === epoch).map(waiter => waiter.blockIndex));
    return { priority, epoch, blockIndex };
  }

  function reconcileRangeTaskWaiters(task) {
    if (!task || task.settled) return;
    if (task.waiters.size === 0) {
      cancelRangeTask(task);
      return;
    }
    const waiters = Array.from(task.waiters.values(), normalizeWaiter);
    const schedule = waiterSchedule(waiters, 'foreground') || waiterSchedule(waiters, 'prefetch');
    task.priority = schedule.priority;
    task.epoch = schedule.epoch;
    task.blockIndex = schedule.blockIndex;
    if (schedule.priority === 'prefetch' && task.demandKey &&
        schedule.epoch !== (demandEpochs.get(task.demandKey) || 0)) {
      cancelRangeTask(task, 'Stale shared prefetch demand');
      return;
    }
    if (task.worker && task.job) setWorkerJobSchedule(task.worker, task.job, schedule);
  }

  function waitForRangeTask(task, signal, schedule = {}) {
    if (!task) return Promise.reject(new Error('Depot stream range task unavailable'));
    if (!rangeTaskReusable(task)) {
      return Promise.reject(createAbortError('Depot stream range task is no longer reusable'));
    }
    if (signal && signal.aborted) {
      reconcileRangeTaskWaiters(task);
      return Promise.reject(createAbortError());
    }
    const waiter = Symbol('depot-stream-waiter');
    task.waiters.set(waiter, {
      priority: schedule.priority === 'prefetch' ? 'prefetch' : 'foreground',
      epoch: Number(schedule.epoch || 0),
      blockIndex: Number.isFinite(schedule.blockIndex) ? schedule.blockIndex : Number.MAX_SAFE_INTEGER,
    });
    promoteRangeTask(task, schedule);
    reconcileRangeTaskWaiters(task);
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = (err, value) => {
        if (done) return;
        done = true;
        if (signal) signal.removeEventListener('abort', onAbort);
        task.waiters.delete(waiter);
        reconcileRangeTaskWaiters(task);
        if (err) reject(err);
        else resolve(value);
      };
      const onAbort = () => finish(createAbortError());
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      task.promise.then(value => finish(null, value), finish);
    });
  }

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
      promise: null,
    };
    task.promise = (async () => {
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
      const workerPromise = requestWorkerRange(worker, start, end, cacheTmpPath, task);
      task.job = workerPromise.job;
      if (task.cancelled) cancelWorkerJob(worker, task.job);
      try {
        await workerPromise;
      } catch (err) {
        if (shouldStopWorkerForRangeError(err)) stopWorker(worker, `range-failed ${start}-${end}`, err);
        throw err;
      }
      if (task.cancelled) throw createAbortError();
      const expected = end - start + 1;
      const stat = fs.statSync(cacheTmpPath);
      if (stat.size !== expected) throw new Error(`Depot stream range incomplete ${start}-${end}: ${stat.size}/${expected}`);
      if (fs.existsSync(cachePath)) fs.rmSync(cachePath, { force: true });
      fs.renameSync(cacheTmpPath, cachePath);
      maybeScheduleCacheCleanupAfterWrite(expected);
      if (!schedule.silent) console.log(`[Depot Stream] cached ${entry.publishedFileId || entry.id} ${start}-${end}`);
      return cachePath;
    })().finally(() => {
      task.settled = true;
      activeTempFiles.delete(resolvedCacheTmpPath);
      scheduleTempCleanup(resolvedCacheTmpPath, task.worker);
      if (rangePromises.get(cachePromiseKey) === task) rangePromises.delete(cachePromiseKey);
    });
    task.promise.catch(() => {});
    rangePromises.set(cachePromiseKey, task);
    return task;
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

  function prefetchRange(entry, start, end, depotLogin, reason = 'prefetch', generation = getGeneration(), epoch = 0) {
    const demandKey = getCacheDir(entry);
    if (isServerStopping() || generation !== getGeneration() ||
        epoch !== (demandEpochs.get(demandKey) || 0)) {
      return Promise.resolve('');
    }
    const coverage = selectCoverage(entry, start, end);
    if (coverage.complete) return Promise.resolve(coverage.segments[0] && coverage.segments[0].file || '');
    console.log(`[Depot Stream] ${reason} ${entry.publishedFileId || entry.id} ${start}-${end}`);
    const blocks = planBlocks(entry.size, start, end);
    const promise = Promise.all(blocks.map((block, blockIndex) => prepareBlock(entry, block, depotLogin, {
      silent: true,
      priority: 'prefetch',
      epoch,
      blockIndex,
    })))
      .then(() => getCacheFile(entry, start, end))
      .catch(err => {
        if (!isAbortError(err)) {
          console.warn(`[Depot Stream] ${reason} failed ${entry.publishedFileId || entry.id} ${start}-${end}: ${err.message}`);
        }
        throw err;
      });
    promise.catch(() => {});
    return promise;
  }

  function scheduleInitialPrefetch(entry, depotLogin) {
    const total = parseInt(String(entry && entry.size || '0'), 10);
    if (!Number.isFinite(total) || total <= 0) return [];
    const generation = getGeneration();
    const epoch = demandEpochs.get(getCacheDir(entry)) || 0;
    const tasks = [];
    const firstRange = clampRange(total, 0, Math.min(firstRangeBytes, maxRangeBytes));
    const nextInitialStart = firstRange ? firstRange.end + 1 : 0;
    const nextInitialBytes = Math.min(initialBufferBytes, maxRangeBytes);
    const initialRange = nextInitialBytes > 0 && nextInitialStart < total
      ? clampRange(total, nextInitialStart, nextInitialBytes)
      : null;
    const tailStart = Math.max(0, total - Math.min(tailBytes, maxRangeBytes));
    const tailRange = clampRange(total, tailStart, Math.min(tailBytes, maxRangeBytes));
    let chain = Promise.resolve();
    if (firstRange) {
      const firstTask = prefetchRange(entry, firstRange.start, firstRange.end, depotLogin, 'first-buffer', generation, epoch);
      tasks.push(firstTask);
      chain = firstTask.catch(() => {});
    }
    if (tailRange && tailRange.start > 0) {
      const tailTask = chain.then(() => sleep(150))
        .then(() => prefetchRange(entry, tailRange.start, tailRange.end, depotLogin, 'tail-buffer', generation, epoch))
        .catch(() => {});
      tasks.push(tailTask);
      chain = tailTask;
    }
    if (initialRange) {
      const initialTask = chain
        .then(() => prefetchRange(entry, initialRange.start, initialRange.end, depotLogin, 'initial-buffer', generation, epoch))
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
    const aheadRange = clampRange(total, aheadStart, Math.min(aheadBytes, maxRangeBytes));
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

  return {
    rangePromiseKey,
    rangeTaskReusable,
    findInFlightRange,
    cancelRangeTask,
    promoteRangeTask,
    reconcileRangeTaskWaiters,
    waitForRangeTask,
    prefetchTaskIsCurrent,
    createRangeTask,
    ensureRangeCached,
    prepareBlock,
    prefetchRange,
    scheduleInitialPrefetch,
    scheduleAheadPrefetch,
    nextDemandEpoch,
    cancelEntryPrefetch,
  };
}

module.exports = { createDepotStreamRangeTasks };
