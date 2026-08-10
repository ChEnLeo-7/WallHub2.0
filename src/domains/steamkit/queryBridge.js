'use strict';

const os = require('node:os');
const { spawn } = require('node:child_process');

const WALLHUB_STEAM_QUERY_BRIDGE_READY = 'WALLHUB_STEAM_QUERY_BRIDGE_READY';
const WALLHUB_STEAM_QUERY_BRIDGE_MARKER = 'WALLHUB_STEAM_QUERY_BRIDGE:';

function bridgeError(message, code = 'STEAMKIT_QUERY_BRIDGE_UNAVAILABLE') {
  const error = new Error(message);
  error.code = code;
  error.requiresSteamLogin = true;
  return error;
}

function abortError() {
  return Object.assign(new Error('SteamKit query bridge request aborted'), { code: 'ABORT_ERR' });
}

function normalizeTimeout(value, fallback, minimum, maximum) {
  const parsed = parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.max(minimum, Math.min(maximum, parsed));
}

function createSteamKitQueryBridge(options = {}) {
  const ensureDepotDownloaderReady = options.ensureDepotDownloaderReady;
  const depotCommandFor = options.depotCommandFor;
  const buildDepotDotnetEnv = options.buildDepotDotnetEnv;
  const buildSteamAuthEnv = options.buildSteamAuthEnv || (env => env);
  const makeDepotLoginId = options.makeDepotLoginId;
  const ensureDir = options.ensureDir;
  const configDir = options.configDir;
  const spawnProcess = options.spawnProcess || spawn;
  const logger = options.logger || console;
  const startupTimeoutMs = normalizeTimeout(options.startupTimeoutMs || process.env.WALLHUB_STEAMKIT_QUERY_BRIDGE_START_TIMEOUT_MS, 60000, 15000, 180000);
  const requestTimeoutMs = normalizeTimeout(options.requestTimeoutMs || process.env.WALLHUB_STEAMKIT_QUERY_BRIDGE_REQUEST_TIMEOUT_MS, 45000, 10000, 120000);

  let bridge = null;
  let starting = null;
  const queuedJobs = [];
  const jobs = new Set();
  let queueRunning = false;
  let sequence = 0;
  let generation = createGeneration();

  function createGeneration() {
    return {
      stopped: false,
      error: null,
    };
  }

  function getGeneration() {
    if (generation.stopped) generation = createGeneration();
    return generation;
  }

  function createStartAttempt(username, requestGeneration) {
    const attempt = {
      username,
      generation: requestGeneration,
      cancelled: false,
      error: null,
      cancelReject: null,
      cancelledPromise: null,
      launch: null,
    };
    attempt.cancelledPromise = new Promise((resolve, reject) => {
      attempt.cancelReject = reject;
    });
    attempt.cancelledPromise.catch(() => {});
    return attempt;
  }

  function cancelStart(attempt, error) {
    if (!attempt || attempt.cancelled) return;
    attempt.cancelled = true;
    attempt.error = error;
    attempt.cancelReject(error);
  }

  function rejectPending(state, error) {
    for (const pending of Array.from(state.pending.values())) {
      pending.reject(error);
    }
  }

  function closeState(state, error) {
    if (!state || state.closed) return;
    state.closed = true;
    if (bridge === state) bridge = null;
    if (state.readyTimer) clearTimeout(state.readyTimer);
    state.readyReject(error);
    rejectPending(state, error);
  }

  function stopState(state, reason, error) {
    if (!state) return;
    const stopError = error || bridgeError(reason || 'SteamKit query bridge stopped');
    closeState(state, stopError);
    try { state.cp.stdin?.end(); } catch {}
    const killTimer = setTimeout(() => {
      try { state.cp.kill(); } catch {}
    }, 3000);
    killTimer.unref?.();
  }

  function appendStderr(state, chunk) {
    state.stderr = `${state.stderr}${String(chunk || '')}`.slice(-4000);
  }

  function handleBridgeMessage(state, line) {
    let message;
    try {
      message = JSON.parse(line.slice(WALLHUB_STEAM_QUERY_BRIDGE_MARKER.length));
    } catch {
      return;
    }
    const id = String(message && message.id || '');
    const pending = state.pending.get(id);
    if (!pending) return;
    if (message && message.ok === true) {
      logger.log(`[SteamKit Bridge] ${pending.label || 'request'} completed in ${Date.now() - pending.startedAt}ms`);
      pending.resolve(message.response);
      return;
    }
    pending.reject(bridgeError(String(message && message.error || 'SteamKit query bridge request failed'), 'STEAMKIT_QUERY_BRIDGE_REQUEST_FAILED'));
  }

  function readStdout(state, chunk) {
    state.stdoutBuffer += String(chunk || '');
    if (state.stdoutBuffer.length > 2 * 1024 * 1024) {
      stopState(state, 'SteamKit query bridge returned an oversized response');
      return;
    }
    let lineEnd;
    while ((lineEnd = state.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = state.stdoutBuffer.slice(0, lineEnd).replace(/\r$/, '').trim();
      state.stdoutBuffer = state.stdoutBuffer.slice(lineEnd + 1);
      if (!line) continue;
      if (line === WALLHUB_STEAM_QUERY_BRIDGE_READY) {
        if (!state.ready) {
          state.ready = true;
          clearTimeout(state.readyTimer);
          state.readyResolve(state);
          logger.log(`[SteamKit Bridge] Reusing Steam3 session for Workshop queries: ${state.username}`);
        }
        continue;
      }
      if (line.startsWith(WALLHUB_STEAM_QUERY_BRIDGE_MARKER)) {
        handleBridgeMessage(state, line);
      }
    }
  }

  async function startBridge(username, requestGeneration, attempt) {
    if (typeof ensureDepotDownloaderReady !== 'function' || typeof depotCommandFor !== 'function' || typeof makeDepotLoginId !== 'function') {
      throw bridgeError('SteamKit query bridge is unavailable');
    }
    const executable = await Promise.race([
      ensureDepotDownloaderReady(),
      attempt.cancelledPromise,
    ]);
    if (attempt.cancelled || requestGeneration.stopped) {
      throw attempt.error || requestGeneration.error || bridgeError('SteamKit query bridge stopped');
    }
    if (typeof ensureDir === 'function' && configDir) ensureDir(configDir);
    const { command, argsPrefix = [] } = depotCommandFor(executable);
    const args = [
      ...argsPrefix,
      '-wallhub-query-bridge',
      '-username', username,
      '-remember-password',
      '-max-downloads', '1',
      '-loginid', makeDepotLoginId(`query-bridge:${username}`),
    ];
    const baseEnv = Object.assign({}, process.env, typeof buildDepotDotnetEnv === 'function' ? buildDepotDotnetEnv() : {});
    const childEnv = buildSteamAuthEnv(baseEnv);
    const cp = spawnProcess(command, args, {
      cwd: configDir,
      env: childEnv,
      windowsHide: true,
      detached: false,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const state = {
      username,
      generation: requestGeneration,
      cp,
      ready: false,
      closed: false,
      stderr: '',
      stdoutBuffer: '',
      pending: new Map(),
      readyTimer: null,
      readyResolve: null,
      readyReject: null,
      readyPromise: null,
    };
    state.readyPromise = new Promise((resolve, reject) => {
      state.readyResolve = resolve;
      state.readyReject = reject;
    });
    state.readyPromise.catch(() => {});
    bridge = state;
    state.readyTimer = setTimeout(() => {
      if (!state.ready) stopState(state, 'SteamKit query bridge startup timed out');
    }, startupTimeoutMs);
    state.readyTimer.unref?.();

    cp.stdout?.on('data', chunk => readStdout(state, chunk));
    cp.stderr?.on('data', chunk => appendStderr(state, chunk));
    cp.on('error', error => {
      if (!state.closed) closeState(state, bridgeError(`SteamKit query bridge failed to start: ${error.message}`));
    });
    cp.on('close', code => {
      if (state.closed) return;
      const detail = state.stderr.trim().slice(-1200);
      closeState(state, bridgeError(detail || `SteamKit query bridge exited: ${code}`));
    });
    return state.readyPromise;
  }

  async function ensureBridge(username, requestGeneration) {
    const user = String(username || '').trim();
    if (!user) throw bridgeError('SteamKit remembered account is unavailable');
    if (requestGeneration.stopped) throw requestGeneration.error;
    if (bridge && !bridge.closed && bridge.username === user && bridge.generation === requestGeneration) return bridge.readyPromise;
    if (bridge && !bridge.closed) stopState(bridge, 'SteamKit account changed');
    if (starting && starting.username === user && starting.generation === requestGeneration) return starting.launch;
    if (starting) cancelStart(starting, bridgeError('SteamKit account changed'));
    const attempt = createStartAttempt(user, requestGeneration);
    const launch = startBridge(user, requestGeneration, attempt);
    attempt.launch = launch;
    starting = attempt;
    try {
      return await launch;
    } finally {
      if (starting === attempt) starting = null;
    }
  }

  async function sendRequest(operation, payload, username, timeoutMs, signal, requestGeneration) {
    if (signal && signal.aborted) throw abortError();
    if (requestGeneration.stopped) throw requestGeneration.error;
    const state = await ensureBridge(username, requestGeneration);
    if (requestGeneration.stopped) throw requestGeneration.error;
    if (!state || state.closed || !state.ready) throw bridgeError('SteamKit query bridge is unavailable');
    if (signal && signal.aborted) throw abortError();
    const id = `${Date.now().toString(36)}-${(++sequence).toString(36)}`;
    const body = JSON.stringify(Object.assign({ id, operation }, payload || {}));
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (signal) signal.removeEventListener('abort', onAbort);
      };
      const settle = (handler, value) => {
        if (settled) return;
        settled = true;
        state.pending.delete(id);
        clearTimeout(timer);
        cleanup();
        handler(value);
      };
      const onAbort = () => {
        const error = abortError();
        stopState(state, 'SteamKit query bridge request aborted', error);
      };
      const timer = setTimeout(() => {
        stopState(state, 'SteamKit query bridge request timed out');
      }, normalizeTimeout(timeoutMs, requestTimeoutMs, 10000, 120000));
      timer.unref?.();
      state.pending.set(id, {
        resolve: value => settle(resolve, value),
        reject: error => settle(reject, error),
        timer,
        label: operation,
        startedAt: Date.now(),
      });
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      try {
        if (!state.cp.stdin || state.cp.stdin.destroyed || !state.cp.stdin.writable) throw new Error('bridge stdin is unavailable');
        state.cp.stdin.write(`${body}${os.EOL}`);
      } catch (error) {
        settle(reject, bridgeError(`SteamKit query bridge request could not be sent: ${error.message}`));
      }
    });
  }

  function scheduleQueue() {
    if (queueRunning) return;
    queueRunning = true;
    const run = async () => {
      while (queuedJobs.length) {
        const job = queuedJobs.shift();
        if (!job || job.cancelled) continue;
        if (job.generation.stopped) {
          job.reject(job.generation.error);
          continue;
        }
        if (job.signal && job.signal.aborted) {
          job.reject(abortError());
          continue;
        }
        job.started = true;
        if (job.signal) job.signal.removeEventListener('abort', job.cancelQueuedJob);
        const queueWaitMs = Date.now() - job.queuedAt;
        if (queueWaitMs >= 25) logger.log(`[SteamKit Bridge] ${job.label || 'request'} waited ${queueWaitMs}ms in queue`);
        try {
          job.resolve(await job.work(job.generation));
        } catch (error) {
          job.reject(error);
        }
      }
      queueRunning = false;
      if (queuedJobs.length) scheduleQueue();
    };
    void run();
  }

  function enqueue(work, options = {}) {
    const signal = options.signal;
    const requestGeneration = getGeneration();
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) {
        reject(abortError());
        return;
      }
      let settled = false;
      const cleanup = () => {
        jobs.delete(job);
        if (signal && !job.started) signal.removeEventListener('abort', job.cancelQueuedJob);
      };
      const settle = (handler, value) => {
        if (settled) return;
        settled = true;
        cleanup();
        handler(value);
      };
      const job = {
        work,
        resolve: value => settle(resolve, value),
        reject: error => settle(reject, error),
        signal,
        generation: requestGeneration,
        label: String(options.label || 'request'),
        queuedAt: Date.now(),
        cancelled: false,
        started: false,
        cancelQueuedJob: null,
      };
      const cancelQueuedJob = () => {
        if (job.started) return;
        const index = queuedJobs.indexOf(job);
        if (index < 0) return;
        queuedJobs.splice(index, 1);
        job.cancelled = true;
        job.reject(abortError());
      };
      job.cancelQueuedJob = cancelQueuedJob;
      if (signal) signal.addEventListener('abort', cancelQueuedJob, { once: true });
      jobs.add(job);
      queuedJobs.push(job);
      scheduleQueue();
    });
  }

  function getUserFiles(listType, queryOptions = {}) {
    return enqueue(
      requestGeneration => sendRequest('user-files', {
        appid: queryOptions.appId,
        listType,
        page: queryOptions.page,
        numperpage: queryOptions.numperpage,
        sortmethod: queryOptions.sortmethod,
      }, queryOptions.username, queryOptions.timeoutMs, queryOptions.signal, requestGeneration),
      Object.assign({}, queryOptions, { label: 'GetUserFiles' }),
    );
  }

  function queryWorkshop(query, queryOptions = {}) {
    return enqueue(
      requestGeneration => sendRequest('workshop-query', {
        query: query && typeof query === 'object' ? query : {},
      }, queryOptions.username, queryOptions.timeoutMs, queryOptions.signal, requestGeneration),
      Object.assign({}, queryOptions, { label: 'PublishedFile query' }),
    );
  }

  function warm(username) {
    const requestGeneration = getGeneration();
    return ensureBridge(username, requestGeneration);
  }

  function shutdown(reason) {
    const stoppedGeneration = generation;
    if (stoppedGeneration.stopped) return;
    const error = bridgeError(reason || 'SteamKit query bridge stopped');
    stoppedGeneration.stopped = true;
    stoppedGeneration.error = error;
    if (starting && starting.generation === stoppedGeneration) cancelStart(starting, error);
    if (bridge && bridge.generation === stoppedGeneration) stopState(bridge, reason || 'SteamKit query bridge stopped', error);
    for (const job of Array.from(jobs)) {
      if (job.generation !== stoppedGeneration) continue;
      job.cancelled = true;
      const index = queuedJobs.indexOf(job);
      if (index >= 0) queuedJobs.splice(index, 1);
      job.reject(error);
    }
  }

  return { getUserFiles, queryWorkshop, warm, shutdown };
}

module.exports = {
  WALLHUB_STEAM_QUERY_BRIDGE_READY,
  WALLHUB_STEAM_QUERY_BRIDGE_MARKER,
  bridgeError,
  createSteamKitQueryBridge,
};
