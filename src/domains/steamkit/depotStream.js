'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

function createDepotStreamService(deps = {}) {
  const {
    DEPOT_STREAM_PATCH_VERSION,
    DEPOT_CONFIG_DIR,
    DEPOT_STREAM_CACHE_DIR,
    DEPOT_STREAM_MAX_RANGE_BYTES,
    DEPOT_STREAM_FIRST_RANGE_BYTES,
    DEPOT_STREAM_TAIL_BYTES,
    DEPOT_STREAM_INITIAL_BUFFER_BYTES,
    DEPOT_STREAM_AHEAD_BYTES,
    DEPOT_STREAM_WORKER_IDLE_MS,
    DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK,
    DEPOT_STREAM_CACHE_CLEANUP_TARGET,
    DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS,
    depotCommandFor,
    getSteamKitStreamMaxDownloads,
    makeDepotLoginId,
    getSteamContentCellId,
    resolveDepotLogin,
    ensureDepotStreamDownloaderReady,
    ensureDir,
    runProcess,
    buildSteamContentEnv,
    buildDepotDotnetEnv,
    getSteamCdnRouteStrategy,
    updateSteamCdnStatusFromText,
    describeSteamCdnRouteStrategy,
    fmtBytes,
    getDepotStreamCacheMaxBytes,
    getDepotVideoStreams,
    getDepotVideoStream,
    hasFilesRecursive,
    getVideoMime,
    steamKitNeedsOwnedAccount,
    canUseDepotLogin,
    makeSteamKitLoginRequiredError,
    normalizeDepotError,
    shouldRetrySteamLoginRequiredError,
    refreshPersistentSteamLoginForRetry,
    jsonRes,
    send,
    sleep,
  } = deps;

  const DEPOT_STREAM_RANGE_PROMISES = new Map();
  const DEPOT_STREAM_WORKERS = new Map();
  let DEPOT_STREAM_GENERATION = 0;
  let DEPOT_STREAM_CACHE_CLEANUP_TIMER = null;
  let DEPOT_STREAM_CACHE_CLEANUP_RUNNING = false;
  let DEPOT_STREAM_CACHE_ESTIMATED_BYTES = -1;
  let SERVER_STOPPING = false;

  function setServerStopping(value) {
    SERVER_STOPPING = !!value;
  }

function buildArgs(executable, publishedFileId, appId, options) {
  const { argsPrefix } = depotCommandFor(executable);
  const args = [
    ...argsPrefix,
    '-app', String(appId),
    '-pubfile', String(publishedFileId),
    '-dir', DEPOT_CONFIG_DIR,
    '-max-downloads', String(getSteamKitStreamMaxDownloads()),
    '-loginid', makeDepotLoginId(`stream:${appId}:${publishedFileId}`),
  ];
  const cellId = getSteamContentCellId();
  if (cellId) args.push('-cellid', String(cellId));
  if (options && options.worker) {
    args.push('-wallhub-stream-worker');
  } else if (options && options.info) {
    args.push('-wallhub-stream-info');
  } else if (options && options.range) {
    args.push(
      '-wallhub-stream-range',
      '-wallhub-range-start', String(options.range.start),
      '-wallhub-range-end', String(options.range.end)
    );
  }

  const login = (options && options.depotLogin) || resolveDepotLogin(appId);
  if (login.user) {
    args.push('-username', login.user, '-remember-password');
    if (login.pass) args.push('-password', login.pass);
    if (login.guard) args.push('-no-mobile');
  }
  if (process.env.DEPOTDOWNLOADER_DEBUG === '1') args.push('-debug');
  return { args, inputLines: login.guard ? [login.guard] : [] };
}

async function getInfo(publishedFileId, depotLogin) {
  const executable = await ensureDepotStreamDownloaderReady();
  ensureDir(DEPOT_CONFIG_DIR);
  const { command } = depotCommandFor(executable);
  const built = buildArgs(executable, publishedFileId, 431960, { info: true, depotLogin });
  console.log(`[Depot Stream] runtime: ${executable}`);
  const timeout = Math.max(30000, parseInt(process.env.WALLHUB_DEPOT_STREAM_INFO_TIMEOUT || '90000', 10) || 90000);
  const result = await runProcess(command, built.args, timeout, {
    cwd: DEPOT_CONFIG_DIR,
    inputLines: built.inputLines,
    closeStdin: built.inputLines.length > 0,
    env: buildSteamContentEnv(Object.assign({}, process.env, buildDepotDotnetEnv())),
    replaceEnv: true,
    preparedEnv: true
  });
  const text = String(result && result.out || '').trim();
  const line = text.split(/\r?\n/).reverse().find(v => /^\s*\{/.test(v));
  if (!line) throw new Error('Depot stream helper did not return video metadata');
  const info = JSON.parse(line);
  const size = parseInt(String(info.size || '0'), 10);
  if (!Number.isFinite(size) || size <= 0) throw new Error('Depot stream helper returned invalid video size');
  return {
    appId: parseInt(String(info.appId || 431960), 10) || 431960,
    publishedFileId: String(info.publishedFileId || publishedFileId),
    depotId: String(info.depotId || ''),
    manifestId: String(info.manifestId || ''),
    fileName: String(info.fileName || ''),
    size,
    chunks: parseInt(String(info.chunks || '0'), 10) || 0
  };
}

function streamFileWithRange(req, res, filePath) {
  const stat = fs.statSync(filePath);
  const total = stat.size;
  const ct = getVideoMime(filePath);
  const range = req.headers.range;
  if (!range) {
    res.writeHead(200, { 'Content-Type': ct, 'Content-Length': total, 'Accept-Ranges': 'bytes' });
    fs.createReadStream(filePath).pipe(res);
    return;
  }
  const m = /^bytes=(\d*)-(\d*)$/i.exec(String(range).trim());
  if (!m) return send(res, 416, 'Invalid Range');
  let start = m[1] ? parseInt(m[1], 10) : 0;
  let end = m[2] ? parseInt(m[2], 10) : (total - 1);
  if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) return send(res, 416, 'Range Not Satisfiable');
  end = Math.min(end, total - 1);
  res.writeHead(206, {
    'Content-Type': ct,
    'Content-Length': end - start + 1,
    'Content-Range': 'bytes ' + start + '-' + end + '/' + total,
    'Accept-Ranges': 'bytes',
  });
  fs.createReadStream(filePath, { start, end }).pipe(res);
}

function parseSingleHttpByteRange(rangeHeader, total) {
  const header = String(rangeHeader || '').trim();
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/i.exec(header);
  if (!m || (!m[1] && !m[2])) return { error: 'Invalid Range' };

  let start = 0;
  let end = total - 1;
  if (!m[1]) {
    const suffixLength = parseInt(m[2], 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { error: 'Range Not Satisfiable' };
    start = suffixLength >= total ? 0 : total - suffixLength;
  } else {
    start = parseInt(m[1], 10);
    end = m[2] ? parseInt(m[2], 10) : total - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
      return { error: 'Range Not Satisfiable' };
    }
    end = Math.min(end, total - 1);
  }
  return { start, end };
}

function normalizeRange(req, total) {
  const header = String(req.headers.range || '').trim();
  if (!header) {
    return {
      start: 0,
      end: Math.min(total - 1, DEPOT_STREAM_FIRST_RANGE_BYTES - 1),
      statusCode: 206,
      rangeHeader: ''
    };
  }
  const parsed = parseSingleHttpByteRange(header, total);
  if (!parsed || parsed.error) return parsed;
  let { start, end } = parsed;
  if (/^bytes=\d+-$/i.test(header)) {
    const limit = start === 0 ? Math.min(DEPOT_STREAM_FIRST_RANGE_BYTES, DEPOT_STREAM_MAX_RANGE_BYTES) : DEPOT_STREAM_MAX_RANGE_BYTES;
    if (end - start + 1 > limit) end = Math.min(total - 1, start + limit - 1);
  }
  return { start, end, statusCode: 206, rangeHeader: header };
}

function depotStreamCacheFile(entry, start, end) {
  const id = String(entry.publishedFileId || entry.id || 'unknown').replace(/[^\w.-]/g, '_');
  const manifest = String(entry.manifestId || entry.hcontent || 'manifest').replace(/[^\w.-]/g, '_');
  return path.join(DEPOT_STREAM_CACHE_DIR, id, manifest, `${start}-${end}.bin`);
}

function depotStreamCacheDir(entry) {
  const id = String(entry.publishedFileId || entry.id || 'unknown').replace(/[^\w.-]/g, '_');
  const manifest = String(entry.manifestId || entry.hcontent || 'manifest').replace(/[^\w.-]/g, '_');
  return path.join(DEPOT_STREAM_CACHE_DIR, id, manifest);
}

function findCachedRange(entry, start, end) {
  const exact = depotStreamCacheFile(entry, start, end);
  try {
    if (fs.existsSync(exact) && fs.statSync(exact).size === end - start + 1) {
      return { file: exact, offset: 0 };
    }
  } catch {}

  const dir = depotStreamCacheDir(entry);
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return null; }
  for (const ent of ents) {
    if (!ent.isFile()) continue;
    const m = /^(\d+)-(\d+)\.bin$/.exec(ent.name);
    if (!m) continue;
    const cachedStart = parseInt(m[1], 10);
    const cachedEnd = parseInt(m[2], 10);
    if (!Number.isFinite(cachedStart) || !Number.isFinite(cachedEnd)) continue;
    if (cachedStart > start || cachedEnd < end) continue;
    const file = path.join(dir, ent.name);
    try {
      if (fs.statSync(file).size !== cachedEnd - cachedStart + 1) continue;
      return { file, offset: start - cachedStart };
    } catch {}
  }
  return null;
}

function depotStreamRangePromiseKey(entry, start, end) {
  return `${depotStreamCacheDir(entry)}|${start}-${end}`;
}

function findDepotStreamInFlightRange(entry, start, end) {
  const prefix = `${depotStreamCacheDir(entry)}|`;
  for (const [key, value] of DEPOT_STREAM_RANGE_PROMISES) {
    if (!key.startsWith(prefix) || !value) continue;
    if (value.start <= start && value.end >= end) return value;
  }
  return null;
}

function pipeCachedRange(res, cache, start, end, headers, statusCode, entry) {
  console.log(`[Depot Stream] cache hit ${entry.publishedFileId || entry.id} ${start}-${end}`);
  try {
    const now = new Date();
    fs.utimesSync(cache.file, now, now);
  } catch {}
  res.writeHead(statusCode, headers);
  fs.createReadStream(cache.file, { start: cache.offset, end: cache.offset + (end - start) }).pipe(res);
}

function killDepotStreamWorkerProcess(cp) {
  if (!cp || cp.killed) return;
  try {
    if (process.platform === 'win32') {
      cp.kill('SIGKILL');
      try { execFileSync('taskkill', ['/pid', String(cp.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    } else {
      try { process.kill(-cp.pid, 'SIGKILL'); } catch { cp.kill('SIGKILL'); }
    }
  } catch {}
}

function depotStreamWorkerKey(entry, depotLogin) {
  const id = String(entry && (entry.publishedFileId || entry.id) || '').trim();
  const user = String(depotLogin && depotLogin.user || '').trim().toLowerCase();
  return [
    id,
    user || 'anonymous',
    getSteamCdnRouteStrategy(),
    String(getSteamContentCellId() || 0),
    String(getSteamKitStreamMaxDownloads()),
    DEPOT_STREAM_PATCH_VERSION
  ].join('|');
}

function parseDepotStreamInfoPayload(payload, fallbackId) {
  const size = parseInt(String(payload && payload.size || '0'), 10);
  if (!Number.isFinite(size) || size <= 0) throw new Error('Depot stream worker returned invalid video size');
  return {
    appId: parseInt(String(payload.appId || 431960), 10) || 431960,
    publishedFileId: String(payload.publishedFileId || fallbackId || ''),
    depotId: String(payload.depotId || ''),
    manifestId: String(payload.manifestId || ''),
    fileName: String(payload.fileName || ''),
    size,
    chunks: parseInt(String(payload.chunks || '0'), 10) || 0
  };
}

function refreshDepotStreamWorkerIdle(worker) {
  if (!worker) return;
  worker.lastUsedAt = Date.now();
  if (worker.idleTimer) clearTimeout(worker.idleTimer);
  worker.idleTimer = setTimeout(() => {
    const current = DEPOT_STREAM_WORKERS.get(worker.key);
    if (current !== worker) return;
    if (worker.pending.size > 0) {
      refreshDepotStreamWorkerIdle(worker);
      return;
    }
    console.log(`[Depot Stream] worker idle, stopping ${worker.publishedFileId}`);
    stopDepotStreamWorker(worker, 'idle');
  }, DEPOT_STREAM_WORKER_IDLE_MS);
  worker.idleTimer.unref?.();
}

function rejectDepotStreamWorkerPending(worker, err) {
  if (!worker) return;
  for (const pending of worker.pending.values()) {
    clearTimeout(pending.timer);
    pending.reject(err);
  }
  worker.pending.clear();
}

function stopDepotStreamWorker(worker, reason = 'stop') {
  if (!worker || worker.closed) return;
  worker.closed = true;
  if (worker.idleTimer) clearTimeout(worker.idleTimer);
  DEPOT_STREAM_WORKERS.delete(worker.key);
  const err = new Error(`Depot stream worker stopped: ${reason}`);
  if (!worker.ready && typeof worker.readyReject === 'function') worker.readyReject(err);
  rejectDepotStreamWorkerPending(worker, err);
  try {
    if (worker.cp && worker.cp.stdin && !worker.cp.stdin.destroyed) {
      worker.cp.stdin.write(JSON.stringify({ type: 'exit' }) + os.EOL);
    }
  } catch {}
  setTimeout(() => killDepotStreamWorkerProcess(worker.cp), 1200).unref?.();
}

function stopAllWorkers(reason = 'settings-changed') {
  DEPOT_STREAM_GENERATION++;
  for (const worker of Array.from(DEPOT_STREAM_WORKERS.values())) {
    stopDepotStreamWorker(worker, reason);
  }
}

function stopWorkerByKey(workerKey, reason = 'release') {
  const key = String(workerKey || '').trim();
  if (!key) return false;
  const worker = DEPOT_STREAM_WORKERS.get(key);
  if (!worker || worker.closed) return false;
  DEPOT_STREAM_GENERATION++;
  stopDepotStreamWorker(worker, reason);
  return true;
}

function releaseEntry(entry, reason = 'release') {
  if (!entry) return { stopped: false };
  const stopped = stopWorkerByKey(entry.workerKey, reason);
  return { stopped };
}

async function startDepotStreamWorker(entry, depotLogin) {
  if (SERVER_STOPPING) throw new Error('Server is stopping');
  const publishedFileId = String(entry && (entry.publishedFileId || entry.id) || '').trim();
  if (!publishedFileId) throw new Error('Depot stream worker requires published file id');
  const executable = await ensureDepotStreamDownloaderReady();
  ensureDir(DEPOT_CONFIG_DIR);
  const key = depotStreamWorkerKey(Object.assign({}, entry, { publishedFileId }), depotLogin);
  const existing = DEPOT_STREAM_WORKERS.get(key);
  if (existing && !existing.closed) return existing.readyPromise;

  const { command } = depotCommandFor(executable);
  const built = buildArgs(executable, publishedFileId, 431960, { worker: true, depotLogin });
  const childEnv = buildSteamContentEnv(Object.assign({}, process.env, buildDepotDotnetEnv()));
  const cp = spawn(command, built.args, {
    cwd: DEPOT_CONFIG_DIR,
    env: childEnv,
    windowsHide: true,
    detached: process.platform !== 'win32',
    stdio: ['pipe', 'pipe', 'pipe']
  });

  const worker = {
    key,
    publishedFileId,
    executable,
    command,
    args: built.args,
    cp,
    pending: new Map(),
    ready: false,
    closed: false,
    info: null,
    stderr: '',
    stdoutBuffer: '',
    readyResolve: null,
    readyReject: null,
    readyPromise: null,
    idleTimer: null,
    lastUsedAt: Date.now()
  };
  worker.readyPromise = new Promise((resolve, reject) => {
    worker.readyResolve = resolve;
    worker.readyReject = reject;
  });
  worker.readyPromise.catch(() => {});
  DEPOT_STREAM_WORKERS.set(key, worker);
  console.log(`[Depot Stream] starting worker: ${executable}`);
  console.log(`[Depot Stream] Steam CDN route: ${describeSteamCdnRouteStrategy()} · stream max ${getSteamKitStreamMaxDownloads()}`);

  if (built.inputLines.length && cp.stdin) {
    built.inputLines.forEach((line, idx) => {
      setTimeout(() => {
        try { cp.stdin.write(String(line || '') + os.EOL); } catch {}
      }, 350 + idx * 350);
    });
  }

  const readyTimer = setTimeout(() => {
    if (!worker.ready) {
      const err = new Error((worker.stderr || 'Depot stream worker ready timeout').trim().slice(-1200));
      worker.readyReject(err);
      stopDepotStreamWorker(worker, 'ready-timeout');
    }
  }, Math.max(30000, parseInt(process.env.WALLHUB_DEPOT_STREAM_WORKER_READY_TIMEOUT || '120000', 10) || 120000));
  readyTimer.unref?.();

  cp.stdout.on('data', d => {
    worker.stdoutBuffer += d.toString();
    let idx;
    while ((idx = worker.stdoutBuffer.indexOf('\n')) >= 0) {
      const line = worker.stdoutBuffer.slice(0, idx).trim();
      worker.stdoutBuffer = worker.stdoutBuffer.slice(idx + 1);
      if (!line) continue;
      let msg = null;
      try { msg = JSON.parse(line); } catch {
        updateSteamCdnStatusFromText(line, { source: 'stream', mode: 'steamkit' });
        console.warn(`[Depot Stream] worker stdout(non-json): ${line.slice(0, 300)}`);
        continue;
      }
      if (msg.type === 'ready') {
        try {
          worker.info = parseDepotStreamInfoPayload(msg, publishedFileId);
          worker.ready = true;
          clearTimeout(readyTimer);
          refreshDepotStreamWorkerIdle(worker);
          worker.readyResolve(worker);
          console.log(`[Depot Stream] worker ready ${publishedFileId} file="${worker.info.fileName}" size=${worker.info.size} chunks=${worker.info.chunks}`);
        } catch (e) {
          clearTimeout(readyTimer);
          stopDepotStreamWorker(worker, 'bad-ready');
          worker.readyReject(e);
        }
        continue;
      }
      if (msg.type === 'range' || msg.type === 'error') {
        const id = String(msg.id || '');
        const pending = worker.pending.get(id);
        if (!pending) continue;
        worker.pending.delete(id);
        clearTimeout(pending.timer);
        refreshDepotStreamWorkerIdle(worker);
        if (msg.type === 'range' && msg.success) {
          pending.resolve(msg);
        } else {
          pending.reject(new Error(String(msg.error || 'Depot stream worker range failed')));
        }
        continue;
      }
    }
  });

  cp.stderr.on('data', d => {
    const text = d.toString();
    worker.stderr = `${worker.stderr}${text}`.slice(-4000);
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (/cdn|content server|got cdn auth token|cache\d|steamcontent/i.test(trimmed)) {
        updateSteamCdnStatusFromText(trimmed, { source: 'stream', mode: 'steamkit' });
        console.log(`[Depot Stream worker] ${trimmed}`);
      }
    }
  });
  cp.on('error', e => {
    if (!worker.closed) {
      clearTimeout(readyTimer);
      DEPOT_STREAM_WORKERS.delete(key);
      worker.closed = true;
      worker.readyReject(e);
      rejectDepotStreamWorkerPending(worker, e);
    }
  });
  cp.on('close', code => {
    if (worker.closed) return;
    clearTimeout(readyTimer);
    worker.closed = true;
    DEPOT_STREAM_WORKERS.delete(key);
    const err = new Error((worker.stderr || `Depot stream worker exited: ${code}`).trim().slice(-1200));
    if (!worker.ready) worker.readyReject(err);
    rejectDepotStreamWorkerPending(worker, err);
    console.warn(`[Depot Stream] worker closed ${publishedFileId}: exit=${code}`);
  });

  return worker.readyPromise;
}

async function getWorker(entry, depotLogin) {
  if (SERVER_STOPPING) throw new Error('Server is stopping');
  const key = depotStreamWorkerKey(entry, depotLogin);
  const existing = DEPOT_STREAM_WORKERS.get(key);
  if (existing && !existing.closed) {
    refreshDepotStreamWorkerIdle(existing);
    return existing.ready ? existing : existing.readyPromise;
  }
  return startDepotStreamWorker(entry, depotLogin);
}

function clampDepotStreamRange(total, start, length) {
  const safeTotal = parseInt(String(total || 0), 10);
  if (!Number.isFinite(safeTotal) || safeTotal <= 0) return null;
  const safeStart = Math.max(0, Math.min(safeTotal - 1, parseInt(String(start || 0), 10) || 0));
  const safeLength = Math.max(1, parseInt(String(length || 0), 10) || DEPOT_STREAM_MAX_RANGE_BYTES);
  return { start: safeStart, end: Math.min(safeTotal - 1, safeStart + safeLength - 1) };
}

async function requestDepotStreamWorkerRange(worker, start, end, outPath) {
  if (!worker || worker.closed) throw new Error('Depot stream worker is not running');
  const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  const timeout = Math.max(30000, parseInt(process.env.WALLHUB_DEPOT_STREAM_RANGE_TIMEOUT || '180000', 10) || 180000);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      worker.pending.delete(id);
      reject(new Error(`Depot stream range timeout ${start}-${end}`));
    }, timeout);
    timer.unref?.();
    worker.pending.set(id, { resolve, reject, timer, start, end, outPath });
    try {
      worker.cp.stdin.write(JSON.stringify({ type: 'range', id, start, end, path: outPath }) + os.EOL);
    } catch (e) {
      clearTimeout(timer);
      worker.pending.delete(id);
      reject(e);
    }
  });
}

async function ensureRangeCached(entry, start, end, depotLogin, options = {}) {
  const cached = findCachedRange(entry, start, end);
  if (cached) return cached.file;
  const inFlight = findDepotStreamInFlightRange(entry, start, end);
  if (inFlight) {
    await inFlight.promise;
    const cachedAfterWait = findCachedRange(entry, start, end);
    if (cachedAfterWait) return cachedAfterWait.file;
  }

  const cachePath = depotStreamCacheFile(entry, start, end);
  const cacheTmpPath = `${cachePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  const cachePromiseKey = depotStreamRangePromiseKey(entry, start, end);
  const promise = (async () => {
    ensureDir(path.dirname(cachePath));
    try { if (fs.existsSync(cacheTmpPath)) fs.rmSync(cacheTmpPath, { force: true }); } catch {}
    const worker = await getWorker(entry, depotLogin);
    try {
      await requestDepotStreamWorkerRange(worker, start, end, cacheTmpPath);
    } catch (e) {
      stopDepotStreamWorker(worker, `range-failed ${start}-${end}`);
      throw e;
    }
    const expected = end - start + 1;
    const st = fs.statSync(cacheTmpPath);
    if (st.size !== expected) throw new Error(`Depot stream range incomplete ${start}-${end}: ${st.size}/${expected}`);
    if (fs.existsSync(cachePath)) fs.rmSync(cachePath, { force: true });
    fs.renameSync(cacheTmpPath, cachePath);
    maybeScheduleDepotStreamCacheCleanupAfterWrite(expected);
    if (!options.silent) console.log(`[Depot Stream] cached ${entry.publishedFileId || entry.id} ${start}-${end}`);
    return cachePath;
  })();
  promise.catch(() => {});
  DEPOT_STREAM_RANGE_PROMISES.set(cachePromiseKey, { start, end, promise });
  try {
    return await promise;
  } catch (e) {
    try { if (fs.existsSync(cacheTmpPath)) fs.rmSync(cacheTmpPath, { force: true }); } catch {}
    throw e;
  } finally {
    DEPOT_STREAM_RANGE_PROMISES.delete(cachePromiseKey);
  }
}

function prefetchDepotStreamRange(entry, start, end, depotLogin, reason = 'prefetch', generation = DEPOT_STREAM_GENERATION) {
  if (SERVER_STOPPING || generation !== DEPOT_STREAM_GENERATION) return Promise.resolve('');
  const cached = findCachedRange(entry, start, end);
  if (cached) return Promise.resolve(cached.file);
  const inFlight = findDepotStreamInFlightRange(entry, start, end);
  if (inFlight) return inFlight.promise;
  console.log(`[Depot Stream] ${reason} ${entry.publishedFileId || entry.id} ${start}-${end}`);
  const promise = ensureRangeCached(entry, start, end, depotLogin, { silent: true })
    .catch(e => {
      console.warn(`[Depot Stream] ${reason} failed ${entry.publishedFileId || entry.id} ${start}-${end}: ${e.message}`);
      throw e;
    });
  promise.catch(() => {});
  return promise;
}

function scheduleInitialPrefetch(entry, depotLogin) {
  const total = parseInt(String(entry && entry.size || '0'), 10);
  if (!Number.isFinite(total) || total <= 0) return [];
  const generation = DEPOT_STREAM_GENERATION;
  const tasks = [];
  const firstRange = clampDepotStreamRange(total, 0, Math.min(DEPOT_STREAM_FIRST_RANGE_BYTES, DEPOT_STREAM_MAX_RANGE_BYTES));
  const nextInitialStart = firstRange ? firstRange.end + 1 : 0;
  const nextInitialBytes = Math.min(DEPOT_STREAM_INITIAL_BUFFER_BYTES, DEPOT_STREAM_MAX_RANGE_BYTES);
  const initialRange = nextInitialBytes > 0 && nextInitialStart < total
    ? clampDepotStreamRange(total, nextInitialStart, nextInitialBytes)
    : null;
  const tailStart = Math.max(0, total - Math.min(DEPOT_STREAM_TAIL_BYTES, DEPOT_STREAM_MAX_RANGE_BYTES));
  const tailRange = clampDepotStreamRange(total, tailStart, Math.min(DEPOT_STREAM_TAIL_BYTES, DEPOT_STREAM_MAX_RANGE_BYTES));
  let chain = Promise.resolve();
  if (firstRange) {
    const firstTask = prefetchDepotStreamRange(entry, firstRange.start, firstRange.end, depotLogin, 'first-buffer', generation);
    tasks.push(firstTask);
    chain = firstTask.catch(() => {});
  }
  if (tailRange && tailRange.start > 0) {
    const tailTask = chain.then(() => sleep(150)).then(() => prefetchDepotStreamRange(entry, tailRange.start, tailRange.end, depotLogin, 'tail-buffer', generation)).catch(() => {});
    tasks.push(tailTask);
    chain = tailTask;
  }
  if (initialRange) {
    const initialTask = chain.then(() => prefetchDepotStreamRange(entry, initialRange.start, initialRange.end, depotLogin, 'initial-buffer', generation)).catch(() => {});
    tasks.push(initialTask);
    chain = initialTask;
  }
  return tasks;
}

function scheduleAheadPrefetch(entry, currentStart, currentEnd, depotLogin) {
  const total = parseInt(String(entry && entry.size || '0'), 10);
  if (!Number.isFinite(total) || total <= 0 || DEPOT_STREAM_AHEAD_BYTES <= 0) return;
  const generation = DEPOT_STREAM_GENERATION;
  const aheadStart = Math.min(total - 1, Math.max(0, currentEnd + 1));
  const aheadRange = clampDepotStreamRange(total, aheadStart, Math.min(DEPOT_STREAM_AHEAD_BYTES, DEPOT_STREAM_MAX_RANGE_BYTES));
  if (aheadRange) prefetchDepotStreamRange(entry, aheadRange.start, aheadRange.end, depotLogin, 'ahead-buffer', generation).catch(() => {});
}

function activeDepotStreamCacheDirs() {
  const dirs = new Set();
  for (const worker of DEPOT_STREAM_WORKERS.values()) {
    if (!worker || worker.closed || !worker.info) continue;
    try {
      dirs.add(path.resolve(depotStreamCacheDir(worker.info)));
    } catch {}
  }
  for (const entry of getDepotVideoStreams()) {
    if (!entry || entry.expiresAt <= Date.now()) continue;
    try {
      dirs.add(path.resolve(depotStreamCacheDir(entry)));
    } catch {}
  }
  return dirs;
}

function cacheFileProtectedByActiveVideo(filePath, activeDirs) {
  const resolved = path.resolve(filePath);
  for (const dir of activeDirs) {
    if (resolved === dir || resolved.startsWith(dir + path.sep)) return true;
  }
  return false;
}

function cleanupEmptyDepotStreamCacheDirs(root = DEPOT_STREAM_CACHE_DIR) {
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
    let empty = true;
    for (const ent of ents) {
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (!walk(fp)) empty = false;
      } else {
        empty = false;
      }
    }
    if (dir !== root && empty) {
      try { fs.rmdirSync(dir); } catch { return false; }
      return true;
    }
    return empty;
  };
  walk(root);
}

function cleanupCache(options = {}) {
  if (DEPOT_STREAM_CACHE_CLEANUP_RUNNING && !options.force) return { skipped: true, reason: 'running' };
  DEPOT_STREAM_CACHE_CLEANUP_RUNNING = true;
  let files = [];
  let removedFiles = 0;
  let removedBytes = 0;
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      const fp = path.join(dir, ent.name);
      try {
        if (ent.isDirectory()) walk(fp);
        else if (ent.isFile() && ent.name.endsWith('.bin')) {
          const st = fs.statSync(fp);
          files.push({ path: fp, size: st.size, mtimeMs: st.mtimeMs, dir: path.dirname(fp) });
        }
      } catch {}
    }
  };
  try {
    walk(DEPOT_STREAM_CACHE_DIR);
    let total = files.reduce((sum, file) => sum + file.size, 0);
    const maxBytes = getDepotStreamCacheMaxBytes();
    const highWatermarkBytes = Math.floor(maxBytes * (options.highWatermark || DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK));
    if (!options.force && total <= highWatermarkBytes) return { skipped: true, bytes: total, maxBytes };
    const targetRatio = options.targetWatermark || (total > maxBytes ? 0.75 : DEPOT_STREAM_CACHE_CLEANUP_TARGET);
    const targetBytes = Math.max(0, Math.floor(maxBytes * targetRatio));
    const activeDirs = activeDepotStreamCacheDirs();
    files.sort((a, b) => {
      const pa = cacheFileProtectedByActiveVideo(a.path, activeDirs) ? 1 : 0;
      const pb = cacheFileProtectedByActiveVideo(b.path, activeDirs) ? 1 : 0;
      if (pa !== pb) return pa - pb;
      return a.mtimeMs - b.mtimeMs;
    });
    for (const file of files) {
      if (total <= targetBytes) break;
      if (!options.force && cacheFileProtectedByActiveVideo(file.path, activeDirs) && total <= maxBytes) continue;
      try {
        fs.rmSync(file.path, { force: true });
        total -= file.size;
        removedFiles++;
        removedBytes += file.size;
      } catch {}
    }
    cleanupEmptyDepotStreamCacheDirs();
    DEPOT_STREAM_CACHE_ESTIMATED_BYTES = total;
    if (removedFiles > 0) {
      console.log(`[Depot Stream] cache cleanup removed ${removedFiles} file(s), ${fmtBytes(removedBytes) || `${removedBytes} B`}, remaining=${fmtBytes(total) || `${total} B`}`);
    }
    return { removedFiles, removedBytes, bytes: total, maxBytes };
  } finally {
    DEPOT_STREAM_CACHE_CLEANUP_RUNNING = false;
  }
}

function scheduleDepotStreamCacheCleanup(reason = 'scheduled') {
  if (DEPOT_STREAM_CACHE_CLEANUP_TIMER) return;
  DEPOT_STREAM_CACHE_CLEANUP_TIMER = setTimeout(() => {
    DEPOT_STREAM_CACHE_CLEANUP_TIMER = null;
    try { cleanupCache({ reason }); } catch (e) {
      console.warn(`[Depot Stream] cache cleanup failed: ${e.message}`);
    }
  }, DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS);
  DEPOT_STREAM_CACHE_CLEANUP_TIMER.unref?.();
}

function maybeScheduleDepotStreamCacheCleanupAfterWrite(addedBytes = 0) {
  if (DEPOT_STREAM_CACHE_CLEANUP_TIMER || DEPOT_STREAM_CACHE_CLEANUP_RUNNING) return;
  const maxBytes = getDepotStreamCacheMaxBytes();
  if (DEPOT_STREAM_CACHE_ESTIMATED_BYTES < 0) {
    // Do not recursively stat the stream cache on the playback request that
    // created its first range. The deferred maintenance pass initializes the
    // estimate without delaying the range response.
    DEPOT_STREAM_CACHE_ESTIMATED_BYTES = 0;
    scheduleDepotStreamCacheCleanup('initial-cache-size');
    return;
  } else {
    DEPOT_STREAM_CACHE_ESTIMATED_BYTES += Math.max(0, Number(addedBytes || 0));
  }
  if (DEPOT_STREAM_CACHE_ESTIMATED_BYTES >= Math.floor(maxBytes * DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK)) {
    scheduleDepotStreamCacheCleanup('high-watermark');
  }
}

function getDepotStreamCacheStats() {
  let files = 0;
  let bytes = 0;
  const walk = (dir) => {
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const ent of ents) {
      const fp = path.join(dir, ent.name);
      try {
        if (ent.isDirectory()) walk(fp);
        else if (ent.isFile()) {
          files++;
          bytes += fs.statSync(fp).size;
        }
      } catch {}
    }
  };
  walk(DEPOT_STREAM_CACHE_DIR);
  DEPOT_STREAM_CACHE_ESTIMATED_BYTES = bytes;
  return { files, bytes };
}

function clearCacheNow() {
  if (DEPOT_STREAM_CACHE_CLEANUP_TIMER) {
    clearTimeout(DEPOT_STREAM_CACHE_CLEANUP_TIMER);
    DEPOT_STREAM_CACHE_CLEANUP_TIMER = null;
  }
  stopAllWorkers('clear-stream-cache');
  for (const [key, value] of Array.from(DEPOT_STREAM_RANGE_PROMISES.entries())) {
    if (key.startsWith(path.resolve(DEPOT_STREAM_CACHE_DIR)) || key.includes(DEPOT_STREAM_CACHE_DIR)) {
      DEPOT_STREAM_RANGE_PROMISES.delete(key);
      if (value && value.promise && typeof value.promise.catch === 'function') value.promise.catch(() => {});
    }
  }
  const before = getDepotStreamCacheStats();
  try {
    fs.rmSync(DEPOT_STREAM_CACHE_DIR, { recursive: true, force: true });
    ensureDir(DEPOT_STREAM_CACHE_DIR);
    DEPOT_STREAM_CACHE_ESTIMATED_BYTES = 0;
  } catch (e) {
    // Some Android/proot/overlay filesystems can report ENOTEMPTY while the
    // directory tree already contains no files. Treat that state as cleared.
    try {
      cleanupEmptyDepotStreamCacheDirs();
      if (!hasFilesRecursive(DEPOT_STREAM_CACHE_DIR)) {
        ensureDir(DEPOT_STREAM_CACHE_DIR);
        DEPOT_STREAM_CACHE_ESTIMATED_BYTES = 0;
        return Object.assign({ success: true, warning: e.message }, before, { files: 0, bytes: 0, cacheDir: DEPOT_STREAM_CACHE_DIR });
      }
    } catch {}
    throw new Error(`\u6e05\u7406\u5728\u7ebf\u64ad\u653e\u7f13\u5b58\u5931\u8d25: ${e.message}`);
  }
  return Object.assign({ success: true }, before, { cacheDir: DEPOT_STREAM_CACHE_DIR });
}



async function handleVideoStream(req, res, token) {
  const entry = getDepotVideoStream(token);
  if (!entry) return jsonRes(res, 404, { error: 'Depot video stream expired' });
  const total = parseInt(String(entry.size || '0'), 10);
  if (!Number.isFinite(total) || total <= 0) return jsonRes(res, 500, { error: 'Depot video stream size unavailable' });

  const normalizedRange = normalizeRange(req, total);
  if (!normalizedRange || normalizedRange.error) return send(res, 416, normalizedRange && normalizedRange.error ? normalizedRange.error : 'Invalid Range');
  const rangeHeader = normalizedRange.rangeHeader || String(req.headers.range || '').trim();
  const start = normalizedRange.start;
  const end = normalizedRange.end;
  const statusCode = normalizedRange.statusCode || 206;
  console.log(`[Depot Stream] request ${entry.publishedFileId || entry.id} range="${rangeHeader || 'none'}" -> ${start}-${end}/${total}`);
  console.log(`[Depot Stream] Steam CDN route: ${describeSteamCdnRouteStrategy()} · stream max ${getSteamKitStreamMaxDownloads()}`);

  const contentType = getVideoMime(entry.fileName || entry.filename || '.mp4') || 'video/mp4';
  const outHeaders = {
    'Content-Type': contentType,
    'Content-Length': end - start + 1,
    'Accept-Ranges': 'bytes',
    'Cache-Control': 'no-store'
  };
  if (statusCode === 206) outHeaders['Content-Range'] = `bytes ${start}-${end}/${total}`;
  if (req.method === 'HEAD') {
    res.writeHead(statusCode, outHeaders);
    res.end();
    return;
  }

  const cachedRange = findCachedRange(entry, start, end);
  if (cachedRange) {
    const depotLogin = resolveDepotLogin(431960);
    if (!steamKitNeedsOwnedAccount(431960) || canUseDepotLogin(depotLogin)) {
      scheduleAheadPrefetch(entry, start, end, depotLogin);
    }
    return pipeCachedRange(res, cachedRange, start, end, outHeaders, statusCode, entry);
  }

  const inFlight = findDepotStreamInFlightRange(entry, start, end);
  if (inFlight) {
    console.log(`[Depot Stream] wait in-flight ${entry.publishedFileId || entry.id} ${start}-${end} covered by ${inFlight.start}-${inFlight.end}`);
    try {
      await inFlight.promise;
      const cachedAfterWait = findCachedRange(entry, start, end);
      if (cachedAfterWait) {
        return pipeCachedRange(res, cachedAfterWait, start, end, outHeaders, statusCode, entry);
      }
    } catch {}
  }

  const depotLogin = resolveDepotLogin(431960);
  if (steamKitNeedsOwnedAccount(431960) && !canUseDepotLogin(depotLogin)) {
    return jsonRes(res, 401, { error: makeSteamKitLoginRequiredError().message, requiresSteamLogin: true, code: 'STEAM_LOGIN_REQUIRED' });
  }

  try {
    try {
      await ensureRangeCached(entry, start, end, depotLogin);
    } catch (rangeError) {
      const err = normalizeDepotError(rangeError);
      if (shouldRetrySteamLoginRequiredError && shouldRetrySteamLoginRequiredError(err) && refreshPersistentSteamLoginForRetry) {
        console.warn(`[Depot Stream] Range ${entry.publishedFileId || entry.id} ${start}-${end} reported login required despite cached account; retrying once.`);
        const refreshed = await refreshPersistentSteamLoginForRetry(`depot-stream-range:${entry.publishedFileId || entry.id}`);
        if (!refreshed) throw err;
        await ensureRangeCached(entry, start, end, resolveDepotLogin(431960));
      } else {
        throw err;
      }
    }
    const cachedAfterFetch = findCachedRange(entry, start, end);
    if (!cachedAfterFetch) throw new Error('Depot stream range cache was not created');
    scheduleAheadPrefetch(entry, start, end, depotLogin);
    return pipeCachedRange(res, cachedAfterFetch, start, end, outHeaders, statusCode, entry);
  } catch (e) {
    const err = normalizeDepotError(e);
    return jsonRes(res, err.statusCode || 500, {
      error: err.message,
      code: err.code || '',
      requiresSteamLogin: !!err.requiresSteamLogin,
      requiresSteamGuard: !!err.requiresSteamGuard
    });
  }
}



  return {
    rangePromises: DEPOT_STREAM_RANGE_PROMISES,
    workers: DEPOT_STREAM_WORKERS,
    setServerStopping,
    buildArgs,
    getInfo,
    streamFileWithRange,
    normalizeRange,
    findCachedRange,
    pipeCachedRange,
    stopAllWorkers,
    stopWorkerByKey,
    releaseEntry,
    getWorker,
    ensureRangeCached,
    scheduleInitialPrefetch,
    scheduleAheadPrefetch,
    cleanupCache,
    scheduleCacheCleanup: scheduleDepotStreamCacheCleanup,
    maybeScheduleCacheCleanupAfterWrite: maybeScheduleDepotStreamCacheCleanupAfterWrite,
    getCacheStats: getDepotStreamCacheStats,
    clearCacheNow,
    handleVideoStream,
  };
}

module.exports = {
  createDepotStreamService,
};
