'use strict';

function createDepotStreamRangeTaskCoordination(options) {
  const {
    rangePromises,
    demandEpochs,
    getCacheDir,
    cancelWorkerJob,
    promoteWorkerJob,
    setWorkerJobSchedule,
    createAbortError,
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

  function notifyRangeTaskProgress(task) {
    if (!task || !task.progressWaiters) return;
    const waiters = Array.from(task.progressWaiters);
    task.progressWaiters.clear();
    for (const waiter of waiters) waiter();
  }

  function waitForRangeTaskProgress(task, absoluteCursor, signal) {
    const isReady = () => task.downloadedUntil > absoluteCursor || task.settled || task.error;
    if (isReady()) return task.error ? Promise.reject(task.error) : Promise.resolve();
    if (signal && signal.aborted) return Promise.reject(createAbortError());
    return new Promise((resolve, reject) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        task.progressWaiters.delete(onProgress);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (task.error) reject(task.error);
        else resolve();
      };
      const onProgress = () => finish();
      const onAbort = () => {
        if (done) return;
        done = true;
        task.progressWaiters.delete(onProgress);
        reject(createAbortError());
      };
      task.progressWaiters.add(onProgress);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      if (isReady()) finish();
    });
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
    task.waiters.set(waiter, normalizeWaiter(schedule));
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

  return {
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
  };
}

module.exports = { createDepotStreamRangeTaskCoordination };
