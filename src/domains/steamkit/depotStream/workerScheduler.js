'use strict';

const fs = require('fs');
const os = require('os');

function createDepotStreamWorkerScheduler(options) {
  const { nextSequence, refreshWorkerIdle, stopWorker } = options;

  function createDepotStreamAbortError(message = 'Depot stream request cancelled') {
    const err = new Error(message);
    err.name = 'AbortError';
    err.code = 'ABORT_ERR';
    return err;
  }

  function isDepotStreamAbortError(err) {
    return !!err && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
  }

  function shouldStopDepotStreamWorkerForRangeError(err) {
    return !isDepotStreamAbortError(err);
  }

  function ensureDepotStreamWorkerScheduler(worker) {
    if (!worker.foregroundQueue) worker.foregroundQueue = [];
    if (!worker.prefetchQueue) worker.prefetchQueue = [];
    if (!worker.pending) worker.pending = new Map();
    if (!Object.prototype.hasOwnProperty.call(worker, 'activeJob')) worker.activeJob = null;
    return worker;
  }

  function depotStreamWorkerHasWork(worker) {
    ensureDepotStreamWorkerScheduler(worker);
    return !!worker.activeJob || worker.foregroundQueue.length > 0 || worker.prefetchQueue.length > 0 || worker.pending.size > 0;
  }

  function settleDepotStreamWorkerJob(job, err, value) {
    if (!job || job.settled) return;
    job.settled = true;
    job.state = err ? 'rejected' : 'resolved';
    clearTimeout(job.timer);
    job.timer = null;
    clearInterval(job.outputTimer);
    job.outputTimer = null;
    if (err) job.reject(err);
    else job.resolve(value);
  }

  function rejectDepotStreamWorkerPending(worker, err) {
    if (!worker) return;
    ensureDepotStreamWorkerScheduler(worker);
    const jobs = new Set([
      ...worker.pending.values(),
      ...worker.foregroundQueue,
      ...worker.prefetchQueue,
    ]);
    if (worker.activeJob) jobs.add(worker.activeJob);
    worker.activeJob = null;
    worker.foregroundQueue.length = 0;
    worker.prefetchQueue.length = 0;
    for (const job of jobs) {
      clearTimeout(job.timer);
      job.timer = null;
      settleDepotStreamWorkerJob(job, err);
    }
    worker.pending.clear();
  }

  function takeNextDepotStreamWorkerJob(worker) {
    ensureDepotStreamWorkerScheduler(worker);
    worker.foregroundQueue = worker.foregroundQueue.filter(job => !job.settled);
    worker.prefetchQueue = worker.prefetchQueue.filter(job => !job.settled);
    if (worker.foregroundQueue.length > 0) {
      worker.foregroundQueue.sort((a, b) =>
        (b.epoch - a.epoch) || (a.blockIndex - b.blockIndex) || (a.sequence - b.sequence)
      );
      return worker.foregroundQueue.shift();
    }
    return worker.prefetchQueue.shift() || null;
  }

  function writeDepotStreamWorkerCommand(worker, payload, callback) {
    const stdin = worker && worker.cp && worker.cp.stdin;
    if (!stdin || worker.closed || worker.stdinFailed || stdin.destroyed || stdin.writableEnded || stdin.writable === false) {
      callback(new Error('Depot stream worker stdin is not writable'));
      return;
    }
    let callbackCalled = false;
    const finish = (err) => {
      if (callbackCalled) return;
      callbackCalled = true;
      callback(err || null);
    };
    try {
      stdin.write(JSON.stringify(payload) + os.EOL, finish);
    } catch (err) {
      finish(err);
    }
  }

  function pumpDepotStreamWorker(worker) {
    if (!worker || worker.closed) return;
    ensureDepotStreamWorkerScheduler(worker);
    if (worker.activeJob) return;
    const job = takeNextDepotStreamWorkerJob(worker);
    if (!job) {
      refreshWorkerIdle(worker);
      return;
    }
    if (job.cancelled || job.settled) {
      settleDepotStreamWorkerJob(job, createDepotStreamAbortError());
      queueMicrotask(() => pumpDepotStreamWorker(worker));
      return;
    }

    job.state = 'active';
    worker.activeJob = job;
    worker.pending.set(job.id, job);
    writeDepotStreamWorkerCommand(worker, {
      type: 'range',
      id: job.id,
      start: job.start,
      end: job.end,
      path: job.outPath,
    }, (writeError) => {
      if (worker.activeJob !== job || job.settled) return;
      if (writeError) {
        worker.pending.delete(job.id);
        worker.activeJob = null;
        settleDepotStreamWorkerJob(job, writeError);
        stopWorker(worker, `range-write-failed ${job.start}-${job.end}`, writeError);
        return;
      }
      console.log(`[Depot Stream] dispatched ${worker.publishedFileId} ${job.start}-${job.end}`);
      const timeout = Math.max(30000, parseInt(process.env.WALLHUB_DEPOT_STREAM_RANGE_TIMEOUT || '180000', 10) || 180000);
      job.timer = setTimeout(() => {
        if (worker.activeJob !== job || job.settled) return;
        const err = new Error(`Depot stream range timeout ${job.start}-${job.end}`);
        stopWorker(worker, `range-timeout ${job.start}-${job.end}`, err);
        settleDepotStreamWorkerJob(job, err);
      }, timeout);
      job.timer.unref?.();
      const expectedBytes = job.end - job.start + 1;
      job.outputTimer = setInterval(() => {
        if (worker.activeJob !== job || job.settled || job.cancelled) return;
        try {
          if (fs.statSync(job.outPath).size !== expectedBytes) {
            job.outputReadyAt = 0;
            return;
          }
        } catch {
          return;
        }
        if (!job.outputReadyAt) {
          job.outputReadyAt = Date.now();
          return;
        }
        if (Date.now() - job.outputReadyAt < 1500) return;
        worker.pending.delete(job.id);
        worker.activeJob = null;
        settleDepotStreamWorkerJob(job, null, { type: 'range', id: job.id, success: true, path: job.outPath, recovered: true });
        stopWorker(worker, `range-output-recovered ${job.start}-${job.end}`);
      }, 100);
      job.outputTimer.unref?.();
    });
  }

  function handleDepotStreamWorkerMessage(worker, msg) {
    if (!worker || !msg) return false;
    ensureDepotStreamWorkerScheduler(worker);
    const id = String(msg.id || '');
    const job = worker.pending.get(id);
    if (!job) return false;
    worker.pending.delete(id);
    if (worker.activeJob === job) worker.activeJob = null;
    clearTimeout(job.timer);
    job.timer = null;
    refreshWorkerIdle(worker);
    if (msg.cancelled) {
      settleDepotStreamWorkerJob(job, createDepotStreamAbortError(`Depot stream range cancelled ${job.start}-${job.end}`));
    } else if (msg.type === 'range' && msg.success) {
      settleDepotStreamWorkerJob(job, null, msg);
    } else {
      settleDepotStreamWorkerJob(job, new Error(String(msg.error || 'Depot stream worker range failed')));
    }
    queueMicrotask(() => pumpDepotStreamWorker(worker));
    return true;
  }

  function cancelDepotStreamWorkerJob(worker, job, reason = 'cancelled') {
    if (!worker || !job || job.settled) return false;
    ensureDepotStreamWorkerScheduler(worker);
    job.cancelled = true;
    if (worker.activeJob === job) {
      if (!job.cancelSent) {
        job.cancelSent = true;
        writeDepotStreamWorkerCommand(worker, { type: 'cancel', id: job.id }, (err) => {
          if (!err || job.settled) return;
          worker.pending.delete(job.id);
          worker.activeJob = null;
          settleDepotStreamWorkerJob(job, err);
          stopWorker(worker, `cancel-write-failed ${job.start}-${job.end}`, err);
        });
      }
      return true;
    }
    worker.foregroundQueue = worker.foregroundQueue.filter(candidate => candidate !== job);
    worker.prefetchQueue = worker.prefetchQueue.filter(candidate => candidate !== job);
    settleDepotStreamWorkerJob(job, createDepotStreamAbortError(reason));
    queueMicrotask(() => pumpDepotStreamWorker(worker));
    return true;
  }

  function cancelDepotStreamWorkerPrefetch(worker, exceptJob = null) {
    if (!worker) return;
    ensureDepotStreamWorkerScheduler(worker);
    const jobs = worker.prefetchQueue.slice();
    if (worker.activeJob && worker.activeJob.priority === 'prefetch') jobs.push(worker.activeJob);
    for (const job of jobs) {
      if (job !== exceptJob) cancelDepotStreamWorkerJob(worker, job, 'Superseded by foreground stream demand');
    }
  }

  function promoteDepotStreamWorkerJob(worker, job, schedule = {}) {
    if (!worker || !job || job.settled) return;
    ensureDepotStreamWorkerScheduler(worker);
    const wasPrefetch = job.priority === 'prefetch';
    job.priority = 'foreground';
    const previousEpoch = Number(job.epoch || 0);
    const promotedEpoch = Number(schedule.epoch || 0);
    const promotedBlockIndex = schedule.blockIndex ?? Number.MAX_SAFE_INTEGER;
    if (wasPrefetch || promotedEpoch > previousEpoch) {
      job.epoch = promotedEpoch;
      job.blockIndex = promotedBlockIndex;
    } else if (promotedEpoch === previousEpoch) {
      job.blockIndex = Math.min(job.blockIndex ?? Number.MAX_SAFE_INTEGER, promotedBlockIndex);
    }
    const queuedIndex = worker.prefetchQueue.indexOf(job);
    if (queuedIndex >= 0) {
      worker.prefetchQueue.splice(queuedIndex, 1);
      worker.foregroundQueue.push(job);
    }
    cancelDepotStreamWorkerPrefetch(worker, job);
    pumpDepotStreamWorker(worker);
  }

  function requestDepotStreamWorkerRange(worker, start, end, outPath, schedule = {}) {
    if (!worker || worker.closed) throw new Error('Depot stream worker is not running');
    ensureDepotStreamWorkerScheduler(worker);
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    let resolvePromise;
    let rejectPromise;
    const promise = new Promise((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const job = {
      id,
      start,
      end,
      outPath,
      priority: schedule.priority === 'prefetch' ? 'prefetch' : 'foreground',
      epoch: Number(schedule.epoch || 0),
      blockIndex: Number.isFinite(schedule.blockIndex) ? schedule.blockIndex : Number.MAX_SAFE_INTEGER,
      sequence: nextSequence(),
      state: 'queued',
      timer: null,
      outputTimer: null,
      outputReadyAt: 0,
      cancelled: false,
      cancelSent: false,
      settled: false,
      resolve: resolvePromise,
      reject: rejectPromise,
    };
    promise.job = job;
    job.promise = promise;
    if (job.priority === 'foreground') {
      cancelDepotStreamWorkerPrefetch(worker);
      worker.foregroundQueue.push(job);
    } else {
      worker.prefetchQueue.push(job);
    }
    pumpDepotStreamWorker(worker);
    return promise;
  }

  function setDepotStreamWorkerJobSchedule(worker, job, schedule) {
    if (!worker || !job || job.settled) return;
    ensureDepotStreamWorkerScheduler(worker);
    const priority = schedule.priority === 'prefetch' ? 'prefetch' : 'foreground';
    job.priority = priority;
    job.epoch = Number(schedule.epoch || 0);
    job.blockIndex = Number.isFinite(schedule.blockIndex) ? schedule.blockIndex : Number.MAX_SAFE_INTEGER;
    const foregroundIndex = worker.foregroundQueue.indexOf(job);
    const prefetchIndex = worker.prefetchQueue.indexOf(job);
    if (priority === 'foreground' && prefetchIndex >= 0) {
      worker.prefetchQueue.splice(prefetchIndex, 1);
      worker.foregroundQueue.push(job);
    } else if (priority === 'prefetch' && foregroundIndex >= 0) {
      worker.foregroundQueue.splice(foregroundIndex, 1);
      worker.prefetchQueue.push(job);
    }
    if (priority === 'prefetch' && worker.activeJob === job &&
        worker.foregroundQueue.some(candidate => !candidate.settled)) {
      cancelDepotStreamWorkerJob(worker, job, 'Prefetch is blocking queued foreground demand');
      return;
    }
    pumpDepotStreamWorker(worker);
  }

  function demoteDepotStreamWorkerJob(worker, job, schedule = {}) {
    setDepotStreamWorkerJobSchedule(worker, job, {
      priority: 'prefetch',
      epoch: schedule.epoch || 0,
      blockIndex: schedule.blockIndex,
    });
  }

  return {
    createDepotStreamAbortError,
    isDepotStreamAbortError,
    shouldStopDepotStreamWorkerForRangeError,
    depotStreamWorkerHasWork,
    rejectDepotStreamWorkerPending,
    handleDepotStreamWorkerMessage,
    cancelDepotStreamWorkerJob,
    cancelDepotStreamWorkerPrefetch,
    promoteDepotStreamWorkerJob,
    requestDepotStreamWorkerRange,
    setDepotStreamWorkerJobSchedule,
    demoteDepotStreamWorkerJob,
  };
}

module.exports = { createDepotStreamWorkerScheduler };
