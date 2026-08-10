'use strict';

const os = require('os');
const { spawn, execFileSync } = require('child_process');

function createDepotStreamWorkerLifecycle(options) {
  const {
    patchVersion,
    configDir,
    workerIdleMs,
    workers,
    demandEpochs,
    isServerStopping,
    incrementGeneration,
    getCacheDir,
    buildArgs,
    ensureDownloaderReady,
    ensureDir,
    depotCommandFor,
    buildSteamContentEnv,
    buildDepotDotnetEnv,
    getCdnRouteStrategy,
    getContentCellId,
    getMaxDownloads,
    describeCdnRouteStrategy,
    updateCdnStatusFromText,
    workerHasWork,
    rejectWorkerPending,
    handleWorkerMessage,
    retryWorkerTempCleanups,
  } = options;

  function workerProcessExited(cp) {
    return !cp || (cp.exitCode !== null && cp.exitCode !== undefined) ||
      (cp.signalCode !== null && cp.signalCode !== undefined);
  }

  function killWorkerProcess(cp) {
    if (!cp || workerProcessExited(cp) || cp.killed) return;
    try {
      if (process.platform === 'win32') {
        cp.kill('SIGKILL');
        try { execFileSync('taskkill', ['/pid', String(cp.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
      } else {
        try { process.kill(-cp.pid, 'SIGKILL'); } catch { cp.kill('SIGKILL'); }
      }
    } catch {}
  }

  function clearWorkerForceKillTimer(worker) {
    if (!worker || !worker.forceKillTimer) return;
    clearTimeout(worker.forceKillTimer);
    worker.forceKillTimer = null;
  }

  function scheduleWorkerForceKill(worker) {
    if (!worker || !worker.cp) return;
    clearWorkerForceKillTimer(worker);
    if (workerProcessExited(worker.cp)) return;
    worker.forceKillTimer = setTimeout(() => {
      worker.forceKillTimer = null;
      if (!workerProcessExited(worker.cp)) killWorkerProcess(worker.cp);
    }, 1200);
    worker.forceKillTimer.unref?.();
  }

  function attachWorkerLifecycleCleanup(worker) {
    const cp = worker && worker.cp;
    if (!cp || typeof cp.once !== 'function' || worker.lifecycleCleanupAttached) return;
    worker.lifecycleCleanupAttached = true;
    cp.once('exit', () => clearWorkerForceKillTimer(worker));
    cp.once('close', () => {
      clearWorkerForceKillTimer(worker);
      retryWorkerTempCleanups(worker);
    });
  }

  function workerKey(entry, depotLogin) {
    const id = String(entry && (entry.publishedFileId || entry.id) || '').trim();
    const user = String(depotLogin && depotLogin.user || '').trim().toLowerCase();
    return [
      id,
      user || 'anonymous',
      getCdnRouteStrategy(),
      String(getContentCellId() || 0),
      String(getMaxDownloads()),
      patchVersion,
    ].join('|');
  }

  function parseInfoPayload(payload, fallbackId) {
    const size = parseInt(String(payload && payload.size || '0'), 10);
    if (!Number.isFinite(size) || size <= 0) throw new Error('Depot stream worker returned invalid video size');
    return {
      appId: parseInt(String(payload.appId || 431960), 10) || 431960,
      publishedFileId: String(payload.publishedFileId || fallbackId || ''),
      depotId: String(payload.depotId || ''),
      manifestId: String(payload.manifestId || ''),
      fileName: String(payload.fileName || ''),
      size,
      chunks: parseInt(String(payload.chunks || '0'), 10) || 0,
    };
  }

  function refreshWorkerIdle(worker) {
    if (!worker) return;
    worker.lastUsedAt = Date.now();
    if (worker.idleTimer) clearTimeout(worker.idleTimer);
    worker.idleTimer = setTimeout(() => {
      const current = workers.get(worker.key);
      if (current !== worker) return;
      if (workerHasWork(worker)) {
        refreshWorkerIdle(worker);
        return;
      }
      console.log(`[Depot Stream] worker idle, stopping ${worker.publishedFileId}`);
      stopWorker(worker, 'idle');
    }, workerIdleMs);
    worker.idleTimer.unref?.();
  }

  function attachWorkerStdinErrorHandler(worker) {
    const stdin = worker && worker.cp && worker.cp.stdin;
    if (!stdin || typeof stdin.on !== 'function' || worker.stdinErrorHandler) return;
    const onStdinError = (cause) => {
      worker.stdinFailed = true;
      if (worker.closed) return;
      const err = cause instanceof Error ? cause : new Error(String(cause || 'Depot stream worker stdin failed'));
      stopWorker(worker, 'stdin-error', err);
    };
    worker.stdinErrorHandler = onStdinError;
    stdin.on('error', onStdinError);
  }

  function stopWorker(worker, reason = 'stop', cause = null) {
    if (!worker || worker.closed) return;
    worker.closed = true;
    if (worker.idleTimer) clearTimeout(worker.idleTimer);
    workers.delete(worker.key);
    const err = cause || new Error(`Depot stream worker stopped: ${reason}`);
    if (!worker.ready && typeof worker.readyReject === 'function') worker.readyReject(err);
    rejectWorkerPending(worker, err);
    try {
      if (worker.cp && worker.cp.stdin && !worker.stdinFailed &&
          !worker.cp.stdin.destroyed && !worker.cp.stdin.writableEnded) {
        worker.cp.stdin.write(JSON.stringify({ type: 'exit' }) + os.EOL);
      }
    } catch {}
    scheduleWorkerForceKill(worker);
  }

  function stopAllWorkers(reason = 'settings-changed') {
    incrementGeneration();
    demandEpochs.clear();
    for (const worker of Array.from(workers.values())) stopWorker(worker, reason);
  }

  function stopWorkerByKey(workerKey, reason = 'release') {
    const key = String(workerKey || '').trim();
    if (!key) return false;
    const worker = workers.get(key);
    if (!worker || worker.closed) return false;
    stopWorker(worker, reason);
    return true;
  }

  function releaseEntry(entry, reason = 'release') {
    if (!entry) return { stopped: false };
    const demandKey = getCacheDir(entry);
    demandEpochs.set(demandKey, (demandEpochs.get(demandKey) || 0) + 1);
    return { stopped: stopWorkerByKey(entry.workerKey, reason) };
  }

  async function startWorker(entry, depotLogin) {
    if (isServerStopping()) throw new Error('Server is stopping');
    const publishedFileId = String(entry && (entry.publishedFileId || entry.id) || '').trim();
    if (!publishedFileId) throw new Error('Depot stream worker requires published file id');
    const executable = await ensureDownloaderReady();
    ensureDir(configDir);
    const key = workerKey(Object.assign({}, entry, { publishedFileId }), depotLogin);
    const existing = workers.get(key);
    if (existing && !existing.closed) return existing.readyPromise;

    const { command } = depotCommandFor(executable);
    const built = buildArgs(executable, publishedFileId, 431960, { worker: true, depotLogin });
    const childEnv = buildSteamContentEnv(Object.assign({}, process.env, buildDepotDotnetEnv()));
    const cp = spawn(command, built.args, {
      cwd: configDir,
      env: childEnv,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    const worker = {
      key,
      publishedFileId,
      executable,
      command,
      args: built.args,
      cp,
      pending: new Map(),
      foregroundQueue: [],
      prefetchQueue: [],
      activeJob: null,
      stdinFailed: false,
      stdinErrorHandler: null,
      forceKillTimer: null,
      lifecycleCleanupAttached: false,
      tempCleanupPaths: new Set(),
      ready: false,
      closed: false,
      info: null,
      stderr: '',
      stdoutBuffer: '',
      readyResolve: null,
      readyReject: null,
      readyPromise: null,
      idleTimer: null,
      lastUsedAt: Date.now(),
    };
    worker.readyPromise = new Promise((resolve, reject) => {
      worker.readyResolve = resolve;
      worker.readyReject = reject;
    });
    worker.readyPromise.catch(() => {});
    workers.set(key, worker);
    attachWorkerStdinErrorHandler(worker);
    attachWorkerLifecycleCleanup(worker);
    console.log(`[Depot Stream] starting worker: ${executable}`);
    console.log(`[Depot Stream] Steam CDN route: ${describeCdnRouteStrategy()} · stream max ${getMaxDownloads()}`);

    if (built.inputLines.length && cp.stdin) {
      built.inputLines.forEach((line, index) => {
        setTimeout(() => {
          if (worker.closed || worker.stdinFailed || cp.stdin.destroyed || cp.stdin.writableEnded) return;
          try { cp.stdin.write(String(line || '') + os.EOL); } catch (err) {
            worker.stdinErrorHandler?.(err);
          }
        }, 350 + index * 350);
      });
    }

    const readyTimer = setTimeout(() => {
      if (!worker.ready) {
        const err = new Error((worker.stderr || 'Depot stream worker ready timeout').trim().slice(-1200));
        worker.readyReject(err);
        stopWorker(worker, 'ready-timeout');
      }
    }, Math.max(30000, parseInt(process.env.WALLHUB_DEPOT_STREAM_WORKER_READY_TIMEOUT || '120000', 10) || 120000));
    readyTimer.unref?.();

    cp.stdout.on('data', data => {
      worker.stdoutBuffer += data.toString();
      let newlineIndex;
      while ((newlineIndex = worker.stdoutBuffer.indexOf('\n')) >= 0) {
        const line = worker.stdoutBuffer.slice(0, newlineIndex).trim();
        worker.stdoutBuffer = worker.stdoutBuffer.slice(newlineIndex + 1);
        if (!line) continue;
        let message = null;
        try { message = JSON.parse(line); } catch {
          updateCdnStatusFromText(line, { source: 'stream', mode: 'steamkit' });
          console.warn(`[Depot Stream] worker stdout(non-json): ${line.slice(0, 300)}`);
          continue;
        }
        if (message.type === 'ready') {
          try {
            worker.info = parseInfoPayload(message, publishedFileId);
            worker.ready = true;
            clearTimeout(readyTimer);
            refreshWorkerIdle(worker);
            worker.readyResolve(worker);
            console.log(`[Depot Stream] worker ready ${publishedFileId} file="${worker.info.fileName}" size=${worker.info.size} chunks=${worker.info.chunks}`);
          } catch (err) {
            clearTimeout(readyTimer);
            stopWorker(worker, 'bad-ready');
            worker.readyReject(err);
          }
          continue;
        }
        if (message.type === 'range' || message.type === 'error') handleWorkerMessage(worker, message);
      }
    });

    cp.stderr.on('data', data => {
      const text = data.toString();
      worker.stderr = `${worker.stderr}${text}`.slice(-4000);
      for (const line of text.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (/WALLHUB_|cdn|content server|got cdn auth token|cache\d|steamcontent/i.test(trimmed)) {
          updateCdnStatusFromText(trimmed, { source: 'stream', mode: 'steamkit' });
          console.log(`[Depot Stream worker] ${trimmed}`);
        }
      }
    });
    cp.on('error', err => {
      if (!worker.closed) {
        clearTimeout(readyTimer);
        workers.delete(key);
        worker.closed = true;
        worker.readyReject(err);
        rejectWorkerPending(worker, err);
      }
    });
    cp.on('close', code => {
      clearWorkerForceKillTimer(worker);
      retryWorkerTempCleanups(worker);
      if (worker.closed) return;
      clearTimeout(readyTimer);
      worker.closed = true;
      workers.delete(key);
      const err = new Error((worker.stderr || `Depot stream worker exited: ${code}`).trim().slice(-1200));
      if (!worker.ready) worker.readyReject(err);
      rejectWorkerPending(worker, err);
      console.warn(`[Depot Stream] worker closed ${publishedFileId}: exit=${code}`);
    });

    return worker.readyPromise;
  }

  async function getWorker(entry, depotLogin) {
    if (isServerStopping()) throw new Error('Server is stopping');
    const key = workerKey(entry, depotLogin);
    const existing = workers.get(key);
    if (existing && !existing.closed) {
      refreshWorkerIdle(existing);
      return existing.ready ? existing : existing.readyPromise;
    }
    return startWorker(entry, depotLogin);
  }

  return {
    workerProcessExited,
    killWorkerProcess,
    clearWorkerForceKillTimer,
    scheduleWorkerForceKill,
    attachWorkerLifecycleCleanup,
    workerKey,
    parseInfoPayload,
    refreshWorkerIdle,
    attachWorkerStdinErrorHandler,
    stopWorker,
    stopAllWorkers,
    stopWorkerByKey,
    releaseEntry,
    startWorker,
    getWorker,
  };
}

module.exports = { createDepotStreamWorkerLifecycle };
