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
  const DEPOT_STREAM_DEMAND_EPOCHS = new Map();
  const DEPOT_STREAM_ACTIVE_TEMP_FILES = new Set();
  const DEPOT_STREAM_TEMP_CLEANUP_RETRIES = new Map();
  const DEPOT_STREAM_TMP_STALE_MS = Math.max(
    60 * 1000,
    parseInt(process.env.WALLHUB_DEPOT_STREAM_TMP_STALE_MS || String(30 * 60 * 1000), 10) || 30 * 60 * 1000
  );
  let DEPOT_STREAM_GENERATION = 0;
  let DEPOT_STREAM_JOB_SEQUENCE = 0;
  let DEPOT_STREAM_AHEAD_SCHEDULE_COUNT = 0;
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
    const maxRangeBytes = Math.max(1, parseInt(String(DEPOT_STREAM_MAX_RANGE_BYTES || 1), 10) || 1);
    const firstRangeBytes = Math.max(1, parseInt(String(DEPOT_STREAM_FIRST_RANGE_BYTES || maxRangeBytes), 10) || maxRangeBytes);
    return {
      start: 0,
      end: Math.min(total - 1, Math.min(firstRangeBytes, maxRangeBytes) - 1),
      statusCode: 206,
      rangeHeader: ''
    };
  }
  const parsed = parseSingleHttpByteRange(header, total);
  if (!parsed || parsed.error) return parsed;
  let { start, end } = parsed;
  const maxRangeBytes = Math.max(1, parseInt(String(DEPOT_STREAM_MAX_RANGE_BYTES || 1), 10) || 1);
  const firstRangeBytes = Math.max(1, parseInt(String(DEPOT_STREAM_FIRST_RANGE_BYTES || maxRangeBytes), 10) || maxRangeBytes);
  const limit = start === 0 && /^bytes=\d+-$/i.test(header)
    ? Math.min(firstRangeBytes, maxRangeBytes)
    : maxRangeBytes;
  if (end - start + 1 > limit) {
    if (/^bytes=-\d+$/i.test(header)) start = Math.max(0, end - limit + 1);
    else end = Math.min(total - 1, start + limit - 1);
  }
  return { start, end, statusCode: 206, rangeHeader: header };
}

function planDepotStreamBlocks(total, start, end, requestedBlockSize = DEPOT_STREAM_FIRST_RANGE_BYTES) {
  const safeTotal = parseInt(String(total || 0), 10);
  const safeStart = parseInt(String(start || 0), 10);
  const safeEnd = parseInt(String(end || 0), 10);
  const maxRangeBytes = Math.max(1, parseInt(String(DEPOT_STREAM_MAX_RANGE_BYTES || 1), 10) || 1);
  const blockSize = Math.max(1, Math.min(
    maxRangeBytes,
    parseInt(String(requestedBlockSize || DEPOT_STREAM_FIRST_RANGE_BYTES || maxRangeBytes), 10) || maxRangeBytes
  ));
  if (!Number.isFinite(safeTotal) || safeTotal <= 0 || !Number.isFinite(safeStart) ||
      !Number.isFinite(safeEnd) || safeStart < 0 || safeStart > safeEnd || safeStart >= safeTotal) {
    return [];
  }
  const last = Math.min(safeTotal - 1, safeEnd);
  const blocks = [];
  for (let blockStart = Math.floor(safeStart / blockSize) * blockSize; blockStart <= last; blockStart += blockSize) {
    const blockEnd = Math.min(safeTotal - 1, blockStart + blockSize - 1);
    blocks.push({
      start: blockStart,
      end: blockEnd,
      responseStart: Math.max(safeStart, blockStart),
      responseEnd: Math.min(last, blockEnd),
      index: blocks.length,
    });
  }
  return blocks;
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

function listDepotStreamCacheRanges(entry) {
  const dir = depotStreamCacheDir(entry);
  let ents = [];
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const ranges = [];
  for (const ent of ents) {
    if (!ent.isFile()) continue;
    const m = /^(\d+)-(\d+)\.bin$/.exec(ent.name);
    if (!m) continue;
    const cachedStart = parseInt(m[1], 10);
    const cachedEnd = parseInt(m[2], 10);
    if (!Number.isFinite(cachedStart) || !Number.isFinite(cachedEnd)) continue;
    const file = path.join(dir, ent.name);
    try {
      if (fs.statSync(file).size !== cachedEnd - cachedStart + 1) continue;
      ranges.push({ file, start: cachedStart, end: cachedEnd });
    } catch {}
  }
  ranges.sort((a, b) => a.start - b.start || b.end - a.end);
  return ranges;
}

function selectDepotStreamCoverage(entry, start, end) {
  const ranges = listDepotStreamCacheRanges(entry);
  const segments = [];
  const gaps = [];
  let cursor = start;
  while (cursor <= end) {
    let best = null;
    for (const range of ranges) {
      if (range.start > cursor) break;
      if (range.end < cursor) continue;
      if (!best || range.end > best.end) best = range;
    }
    if (best) {
      const segmentEnd = Math.min(end, best.end);
      segments.push({
        file: best.file,
        start: cursor,
        end: segmentEnd,
        offset: cursor - best.start,
        cachedStart: best.start,
        cachedEnd: best.end,
      });
      cursor = segmentEnd + 1;
      continue;
    }
    let nextStart = end + 1;
    for (const range of ranges) {
      if (range.start > cursor) {
        nextStart = Math.min(nextStart, range.start);
        break;
      }
    }
    const gapEnd = Math.min(end, nextStart - 1);
    gaps.push({ start: cursor, end: gapEnd });
    cursor = gapEnd + 1;
  }
  return { complete: gaps.length === 0, segments, gaps };
}

function findCachedRange(entry, start, end) {
  const coverage = selectDepotStreamCoverage(entry, start, end);
  if (!coverage.complete || coverage.segments.length !== 1) return null;
  const segment = coverage.segments[0];
  return { file: segment.file, offset: segment.offset };
}

function depotStreamRangePromiseKey(entry, start, end) {
  return `${depotStreamCacheDir(entry)}|${start}-${end}`;
}

function depotStreamRangeTaskReusable(task) {
  return !!task && !task.cancelled && !task.settled && !(task.job && task.job.cancelled);
}

function findDepotStreamInFlightRange(entry, start, end) {
  const prefix = `${depotStreamCacheDir(entry)}|`;
  for (const [key, value] of DEPOT_STREAM_RANGE_PROMISES) {
    if (!key.startsWith(prefix) || !depotStreamRangeTaskReusable(value)) continue;
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

function depotStreamWorkerProcessExited(cp) {
  return !cp || (cp.exitCode !== null && cp.exitCode !== undefined) ||
    (cp.signalCode !== null && cp.signalCode !== undefined);
}

function killDepotStreamWorkerProcess(cp) {
  if (!cp || depotStreamWorkerProcessExited(cp) || cp.killed) return;
  try {
    if (process.platform === 'win32') {
      cp.kill('SIGKILL');
      try { execFileSync('taskkill', ['/pid', String(cp.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
    } else {
      try { process.kill(-cp.pid, 'SIGKILL'); } catch { cp.kill('SIGKILL'); }
    }
  } catch {}
}

function clearDepotStreamWorkerForceKillTimer(worker) {
  if (!worker || !worker.forceKillTimer) return;
  clearTimeout(worker.forceKillTimer);
  worker.forceKillTimer = null;
}

function scheduleDepotStreamWorkerForceKill(worker) {
  if (!worker || !worker.cp) return;
  clearDepotStreamWorkerForceKillTimer(worker);
  if (depotStreamWorkerProcessExited(worker.cp)) return;
  worker.forceKillTimer = setTimeout(() => {
    worker.forceKillTimer = null;
    if (!depotStreamWorkerProcessExited(worker.cp)) killDepotStreamWorkerProcess(worker.cp);
  }, 1200);
  worker.forceKillTimer.unref?.();
}

function forgetDepotStreamTempCleanup(tempPath) {
  const resolved = path.resolve(tempPath);
  const pending = DEPOT_STREAM_TEMP_CLEANUP_RETRIES.get(resolved);
  if (pending && pending.timer) clearTimeout(pending.timer);
  DEPOT_STREAM_TEMP_CLEANUP_RETRIES.delete(resolved);
  if (pending && pending.worker && pending.worker.tempCleanupPaths) {
    pending.worker.tempCleanupPaths.delete(resolved);
  }
}

function removeDepotStreamTempFileNow(tempPath) {
  const resolved = path.resolve(tempPath);
  if (DEPOT_STREAM_ACTIVE_TEMP_FILES.has(resolved)) return false;
  try {
    fs.rmSync(resolved, { force: true });
    if (fs.existsSync(resolved)) return false;
    forgetDepotStreamTempCleanup(resolved);
    return true;
  } catch {
    return false;
  }
}

function scheduleDepotStreamTempCleanup(tempPath, worker = null, attempt = 0, delayMs = null) {
  const resolved = path.resolve(tempPath);
  if (worker) {
    if (!worker.tempCleanupPaths) worker.tempCleanupPaths = new Set();
    worker.tempCleanupPaths.add(resolved);
  }
  if (removeDepotStreamTempFileNow(resolved)) {
    if (worker && worker.tempCleanupPaths) worker.tempCleanupPaths.delete(resolved);
    return true;
  }
  const previous = DEPOT_STREAM_TEMP_CLEANUP_RETRIES.get(resolved);
  if (previous && previous.timer) clearTimeout(previous.timer);
  const cleanupWorker = worker || previous && previous.worker || null;
  if (DEPOT_STREAM_ACTIVE_TEMP_FILES.has(resolved)) {
    DEPOT_STREAM_TEMP_CLEANUP_RETRIES.delete(resolved);
    if (cleanupWorker && cleanupWorker.closed && cleanupWorker.tempCleanupPaths) {
      cleanupWorker.tempCleanupPaths.delete(resolved);
    }
    return false;
  }
  const nextAttempt = Math.max(attempt, previous && previous.attempt || 0);
  if (nextAttempt >= 8) {
    DEPOT_STREAM_TEMP_CLEANUP_RETRIES.delete(resolved);
    if (cleanupWorker && cleanupWorker.closed && cleanupWorker.tempCleanupPaths) {
      cleanupWorker.tempCleanupPaths.delete(resolved);
    }
    return false;
  }
  const pending = { worker: cleanupWorker, attempt: nextAttempt, timer: null };
  DEPOT_STREAM_TEMP_CLEANUP_RETRIES.set(resolved, pending);
  const delay = delayMs === null ? Math.min(30000, 250 * (2 ** nextAttempt)) : Math.max(0, delayMs);
  pending.timer = setTimeout(() => {
    pending.timer = null;
    scheduleDepotStreamTempCleanup(resolved, cleanupWorker, nextAttempt + 1);
  }, delay);
  pending.timer.unref?.();
  return false;
}

function retryDepotStreamWorkerTempCleanups(worker) {
  if (!worker || !worker.tempCleanupPaths) return;
  for (const tempPath of Array.from(worker.tempCleanupPaths)) {
    const pending = DEPOT_STREAM_TEMP_CLEANUP_RETRIES.get(tempPath);
    scheduleDepotStreamTempCleanup(tempPath, worker, pending && pending.attempt || 0, 0);
  }
}

function attachDepotStreamWorkerLifecycleCleanup(worker) {
  const cp = worker && worker.cp;
  if (!cp || typeof cp.once !== 'function' || worker.lifecycleCleanupAttached) return;
  worker.lifecycleCleanupAttached = true;
  cp.once('exit', () => clearDepotStreamWorkerForceKillTimer(worker));
  cp.once('close', () => {
    clearDepotStreamWorkerForceKillTimer(worker);
    retryDepotStreamWorkerTempCleanups(worker);
  });
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

function refreshDepotStreamWorkerIdle(worker) {
  if (!worker) return;
  worker.lastUsedAt = Date.now();
  if (worker.idleTimer) clearTimeout(worker.idleTimer);
  worker.idleTimer = setTimeout(() => {
    const current = DEPOT_STREAM_WORKERS.get(worker.key);
    if (current !== worker) return;
    if (depotStreamWorkerHasWork(worker)) {
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

function settleDepotStreamWorkerJob(job, err, value) {
  if (!job || job.settled) return;
  job.settled = true;
  job.state = err ? 'rejected' : 'resolved';
  clearTimeout(job.timer);
  job.timer = null;
  if (err) job.reject(err);
  else job.resolve(value);
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

function pumpDepotStreamWorker(worker) {
  if (!worker || worker.closed) return;
  ensureDepotStreamWorkerScheduler(worker);
  if (worker.activeJob) return;
  const job = takeNextDepotStreamWorkerJob(worker);
  if (!job) {
    refreshDepotStreamWorkerIdle(worker);
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
  const timeout = Math.max(30000, parseInt(process.env.WALLHUB_DEPOT_STREAM_RANGE_TIMEOUT || '180000', 10) || 180000);
  job.timer = setTimeout(() => {
    if (worker.activeJob !== job || job.settled) return;
    const err = new Error(`Depot stream range timeout ${job.start}-${job.end}`);
    stopDepotStreamWorker(worker, `range-timeout ${job.start}-${job.end}`, err);
    settleDepotStreamWorkerJob(job, err);
  }, timeout);
  job.timer.unref?.();
  try {
    worker.cp.stdin.write(JSON.stringify({
      type: 'range',
      id: job.id,
      start: job.start,
      end: job.end,
      path: job.outPath,
    }) + os.EOL);
  } catch (e) {
    worker.pending.delete(job.id);
    worker.activeJob = null;
    settleDepotStreamWorkerJob(job, e);
    queueMicrotask(() => pumpDepotStreamWorker(worker));
  }
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
  refreshDepotStreamWorkerIdle(worker);
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
      try {
        worker.cp.stdin.write(JSON.stringify({ type: 'cancel', id: job.id }) + os.EOL);
      } catch (e) {
        worker.pending.delete(job.id);
        worker.activeJob = null;
        settleDepotStreamWorkerJob(job, e);
        queueMicrotask(() => pumpDepotStreamWorker(worker));
      }
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

function promoteDepotStreamWorkerJob(worker, job, options = {}) {
  if (!worker || !job || job.settled) return;
  ensureDepotStreamWorkerScheduler(worker);
  const wasPrefetch = job.priority === 'prefetch';
  job.priority = 'foreground';
  const previousEpoch = Number(job.epoch || 0);
  const promotedEpoch = Number(options.epoch || 0);
  const promotedBlockIndex = options.blockIndex ?? Number.MAX_SAFE_INTEGER;
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

function attachDepotStreamWorkerStdinErrorHandler(worker) {
  const stdin = worker && worker.cp && worker.cp.stdin;
  if (!stdin || typeof stdin.on !== 'function' || worker.stdinErrorHandler) return;
  const onStdinError = (cause) => {
    worker.stdinFailed = true;
    if (worker.closed) return;
    const err = cause instanceof Error ? cause : new Error(String(cause || 'Depot stream worker stdin failed'));
    stopDepotStreamWorker(worker, 'stdin-error', err);
  };
  worker.stdinErrorHandler = onStdinError;
  stdin.on('error', onStdinError);
}

function stopDepotStreamWorker(worker, reason = 'stop', cause = null) {
  if (!worker || worker.closed) return;
  worker.closed = true;
  if (worker.idleTimer) clearTimeout(worker.idleTimer);
  DEPOT_STREAM_WORKERS.delete(worker.key);
  const err = cause || new Error(`Depot stream worker stopped: ${reason}`);
  if (!worker.ready && typeof worker.readyReject === 'function') worker.readyReject(err);
  rejectDepotStreamWorkerPending(worker, err);
  try {
    if (worker.cp && worker.cp.stdin && !worker.stdinFailed &&
        !worker.cp.stdin.destroyed && !worker.cp.stdin.writableEnded) {
      worker.cp.stdin.write(JSON.stringify({ type: 'exit' }) + os.EOL);
    }
  } catch {}
  scheduleDepotStreamWorkerForceKill(worker);
}

function stopAllWorkers(reason = 'settings-changed') {
  DEPOT_STREAM_GENERATION++;
  DEPOT_STREAM_DEMAND_EPOCHS.clear();
  for (const worker of Array.from(DEPOT_STREAM_WORKERS.values())) {
    stopDepotStreamWorker(worker, reason);
  }
}

function stopWorkerByKey(workerKey, reason = 'release') {
  const key = String(workerKey || '').trim();
  if (!key) return false;
  const worker = DEPOT_STREAM_WORKERS.get(key);
  if (!worker || worker.closed) return false;
  stopDepotStreamWorker(worker, reason);
  return true;
}

function releaseEntry(entry, reason = 'release') {
  if (!entry) return { stopped: false };
  const demandKey = depotStreamCacheDir(entry);
  DEPOT_STREAM_DEMAND_EPOCHS.set(demandKey, (DEPOT_STREAM_DEMAND_EPOCHS.get(demandKey) || 0) + 1);
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
    lastUsedAt: Date.now()
  };
  worker.readyPromise = new Promise((resolve, reject) => {
    worker.readyResolve = resolve;
    worker.readyReject = reject;
  });
  worker.readyPromise.catch(() => {});
  DEPOT_STREAM_WORKERS.set(key, worker);
  attachDepotStreamWorkerStdinErrorHandler(worker);
  attachDepotStreamWorkerLifecycleCleanup(worker);
  console.log(`[Depot Stream] starting worker: ${executable}`);
  console.log(`[Depot Stream] Steam CDN route: ${describeSteamCdnRouteStrategy()} · stream max ${getSteamKitStreamMaxDownloads()}`);

  if (built.inputLines.length && cp.stdin) {
    built.inputLines.forEach((line, idx) => {
      setTimeout(() => {
        if (worker.closed || worker.stdinFailed || cp.stdin.destroyed || cp.stdin.writableEnded) return;
        try { cp.stdin.write(String(line || '') + os.EOL); } catch (e) {
          worker.stdinErrorHandler?.(e);
        }
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
        handleDepotStreamWorkerMessage(worker, msg);
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
    clearDepotStreamWorkerForceKillTimer(worker);
    retryDepotStreamWorkerTempCleanups(worker);
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

function requestDepotStreamWorkerRange(worker, start, end, outPath, options = {}) {
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
    priority: options.priority === 'prefetch' ? 'prefetch' : 'foreground',
    epoch: Number(options.epoch || 0),
    blockIndex: Number.isFinite(options.blockIndex) ? options.blockIndex : Number.MAX_SAFE_INTEGER,
    sequence: ++DEPOT_STREAM_JOB_SEQUENCE,
    state: 'queued',
    timer: null,
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

function cancelDepotStreamRangeTask(task, reason = 'Depot stream request cancelled') {
  if (!task || task.settled || task.cancelled) return false;
  task.cancelled = true;
  if (task.worker && task.job) cancelDepotStreamWorkerJob(task.worker, task.job, reason);
  return true;
}

function promoteDepotStreamRangeTask(task, options = {}) {
  if (!task || task.settled || options.priority === 'prefetch') return;
  const wasPrefetch = task.priority === 'prefetch';
  task.priority = 'foreground';
  const previousEpoch = Number(task.epoch || 0);
  const promotedEpoch = Number(options.epoch || 0);
  const promotedBlockIndex = Number.isFinite(options.blockIndex) ? options.blockIndex : Number.MAX_SAFE_INTEGER;
  if (wasPrefetch || promotedEpoch > previousEpoch) {
    task.epoch = promotedEpoch;
    task.blockIndex = promotedBlockIndex;
  } else if (promotedEpoch === previousEpoch) {
    task.blockIndex = Math.min(task.blockIndex ?? Number.MAX_SAFE_INTEGER, promotedBlockIndex);
  }
  if (task.worker && task.job) {
    promoteDepotStreamWorkerJob(task.worker, task.job, task);
  }
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

function normalizeDepotStreamWaiter(waiter) {
  if (typeof waiter === 'string') {
    return { priority: waiter, epoch: 0, blockIndex: Number.MAX_SAFE_INTEGER };
  }
  return {
    priority: waiter && waiter.priority === 'prefetch' ? 'prefetch' : 'foreground',
    epoch: Number(waiter && waiter.epoch || 0),
    blockIndex: Number.isFinite(waiter && waiter.blockIndex) ? waiter.blockIndex : Number.MAX_SAFE_INTEGER,
  };
}

function depotStreamWaiterSchedule(waiters, priority) {
  const candidates = waiters.filter(waiter => waiter.priority === priority);
  if (candidates.length === 0) return null;
  const epoch = Math.max(...candidates.map(waiter => waiter.epoch));
  const blockIndex = Math.min(...candidates.filter(waiter => waiter.epoch === epoch).map(waiter => waiter.blockIndex));
  return { priority, epoch, blockIndex };
}

function reconcileDepotStreamRangeTaskWaiters(task) {
  if (!task || task.settled) return;
  if (task.waiters.size === 0) {
    cancelDepotStreamRangeTask(task);
    return;
  }
  const waiters = Array.from(task.waiters.values(), normalizeDepotStreamWaiter);
  const schedule = depotStreamWaiterSchedule(waiters, 'foreground') ||
    depotStreamWaiterSchedule(waiters, 'prefetch');
  task.priority = schedule.priority;
  task.epoch = schedule.epoch;
  task.blockIndex = schedule.blockIndex;
  if (schedule.priority === 'prefetch' && task.demandKey &&
      schedule.epoch !== (DEPOT_STREAM_DEMAND_EPOCHS.get(task.demandKey) || 0)) {
    cancelDepotStreamRangeTask(task, 'Stale shared prefetch demand');
    return;
  }
  if (task.worker && task.job) setDepotStreamWorkerJobSchedule(task.worker, task.job, schedule);
}

function waitForDepotStreamRangeTask(task, signal, options = {}) {
  if (!task) return Promise.reject(new Error('Depot stream range task unavailable'));
  if (!depotStreamRangeTaskReusable(task)) {
    return Promise.reject(createDepotStreamAbortError('Depot stream range task is no longer reusable'));
  }
  if (signal && signal.aborted) {
    reconcileDepotStreamRangeTaskWaiters(task);
    return Promise.reject(createDepotStreamAbortError());
  }
  const waiter = Symbol('depot-stream-waiter');
  const priority = options.priority === 'prefetch' ? 'prefetch' : 'foreground';
  task.waiters.set(waiter, {
    priority,
    epoch: Number(options.epoch || 0),
    blockIndex: Number.isFinite(options.blockIndex) ? options.blockIndex : Number.MAX_SAFE_INTEGER,
  });
  promoteDepotStreamRangeTask(task, options);
  reconcileDepotStreamRangeTaskWaiters(task);
  return new Promise((resolve, reject) => {
    let done = false;
    const finish = (err, value) => {
      if (done) return;
      done = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      task.waiters.delete(waiter);
      reconcileDepotStreamRangeTaskWaiters(task);
      if (err) reject(err);
      else resolve(value);
    };
    const onAbort = () => {
      finish(createDepotStreamAbortError());
    };
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    task.promise.then(value => finish(null, value), finish);
  });
}

function depotStreamPrefetchTaskIsCurrent(entry, task) {
  if (!task || task.priority !== 'prefetch') return true;
  return task.epoch === (DEPOT_STREAM_DEMAND_EPOCHS.get(depotStreamCacheDir(entry)) || 0);
}

function createDepotStreamRangeTask(entry, start, end, depotLogin, options = {}) {
  const cachePath = depotStreamCacheFile(entry, start, end);
  const cacheTmpPath = `${cachePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`;
  const cachePromiseKey = depotStreamRangePromiseKey(entry, start, end);
  const resolvedCacheTmpPath = path.resolve(cacheTmpPath);
  DEPOT_STREAM_ACTIVE_TEMP_FILES.add(resolvedCacheTmpPath);
  const task = {
    start,
    end,
    cachePath,
    cacheTmpPath,
    priority: options.priority === 'prefetch' ? 'prefetch' : 'foreground',
    epoch: Number(options.epoch || 0),
    blockIndex: Number.isFinite(options.blockIndex) ? options.blockIndex : Number.MAX_SAFE_INTEGER,
    waiters: new Map(),
    demandKey: depotStreamCacheDir(entry),
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
    if (task.cancelled || !depotStreamPrefetchTaskIsCurrent(entry, task)) {
      task.cancelled = true;
      throw createDepotStreamAbortError('Stale depot stream prefetch cancelled');
    }
    const workerPromise = requestDepotStreamWorkerRange(worker, start, end, cacheTmpPath, task);
    task.job = workerPromise.job;
    if (task.cancelled) cancelDepotStreamWorkerJob(worker, task.job);
    try {
      await workerPromise;
    } catch (e) {
      if (shouldStopDepotStreamWorkerForRangeError(e)) stopDepotStreamWorker(worker, `range-failed ${start}-${end}`, e);
      throw e;
    }
    if (task.cancelled) throw createDepotStreamAbortError();
    const expected = end - start + 1;
    const st = fs.statSync(cacheTmpPath);
    if (st.size !== expected) throw new Error(`Depot stream range incomplete ${start}-${end}: ${st.size}/${expected}`);
    if (fs.existsSync(cachePath)) fs.rmSync(cachePath, { force: true });
    fs.renameSync(cacheTmpPath, cachePath);
    maybeScheduleDepotStreamCacheCleanupAfterWrite(expected);
    if (!options.silent) console.log(`[Depot Stream] cached ${entry.publishedFileId || entry.id} ${start}-${end}`);
    return cachePath;
  })().finally(() => {
    task.settled = true;
    DEPOT_STREAM_ACTIVE_TEMP_FILES.delete(resolvedCacheTmpPath);
    scheduleDepotStreamTempCleanup(resolvedCacheTmpPath, task.worker);
    if (DEPOT_STREAM_RANGE_PROMISES.get(cachePromiseKey) === task) DEPOT_STREAM_RANGE_PROMISES.delete(cachePromiseKey);
  });
  task.promise.catch(() => {});
  DEPOT_STREAM_RANGE_PROMISES.set(cachePromiseKey, task);
  return task;
}

async function ensureRangeCached(entry, start, end, depotLogin, options = {}) {
  let coverage = selectDepotStreamCoverage(entry, start, end);
  if (coverage.complete) return coverage.segments[0] && coverage.segments[0].file || '';
  const cachePromiseKey = depotStreamRangePromiseKey(entry, start, end);
  let task = DEPOT_STREAM_RANGE_PROMISES.get(cachePromiseKey) || findDepotStreamInFlightRange(entry, start, end);
  if (!depotStreamRangeTaskReusable(task)) task = null;
  if (!task) task = createDepotStreamRangeTask(entry, start, end, depotLogin, options);
  await waitForDepotStreamRangeTask(task, options.signal, options);
  coverage = selectDepotStreamCoverage(entry, start, end);
  if (!coverage.complete) {
    throw new Error(`Depot stream range cache was not created ${start}-${end}`);
  }
  return coverage.segments[0] && coverage.segments[0].file || '';
}

async function prepareDepotStreamBlock(entry, block, depotLogin, options = {}) {
  let coverage = selectDepotStreamCoverage(entry, block.start, block.end);
  if (!coverage.complete) {
    await Promise.all(coverage.gaps.map((gap, gapIndex) => ensureRangeCached(
      entry,
      gap.start,
      gap.end,
      depotLogin,
      Object.assign({}, options, { blockIndex: (options.blockIndex || 0) + gapIndex / 1000 })
    )));
    coverage = selectDepotStreamCoverage(entry, block.start, block.end);
  }
  if (!coverage.complete) throw new Error(`Depot stream block cache incomplete ${block.start}-${block.end}`);
  const responseCoverage = selectDepotStreamCoverage(entry, block.responseStart, block.responseEnd);
  if (!responseCoverage.complete) throw new Error(`Depot stream response cache incomplete ${block.responseStart}-${block.responseEnd}`);
  return responseCoverage.segments;
}

function prefetchDepotStreamRange(entry, start, end, depotLogin, reason = 'prefetch', generation = DEPOT_STREAM_GENERATION, epoch = 0) {
  const demandKey = depotStreamCacheDir(entry);
  if (SERVER_STOPPING || generation !== DEPOT_STREAM_GENERATION ||
      epoch !== (DEPOT_STREAM_DEMAND_EPOCHS.get(demandKey) || 0)) {
    return Promise.resolve('');
  }
  const coverage = selectDepotStreamCoverage(entry, start, end);
  if (coverage.complete) return Promise.resolve(coverage.segments[0] && coverage.segments[0].file || '');
  console.log(`[Depot Stream] ${reason} ${entry.publishedFileId || entry.id} ${start}-${end}`);
  const blocks = planDepotStreamBlocks(entry.size, start, end);
  const promise = Promise.all(blocks.map((block, blockIndex) => prepareDepotStreamBlock(entry, block, depotLogin, {
    silent: true,
    priority: 'prefetch',
    epoch,
    blockIndex,
  })))
    .then(() => depotStreamCacheFile(entry, start, end))
    .catch(e => {
      if (!isDepotStreamAbortError(e)) {
        console.warn(`[Depot Stream] ${reason} failed ${entry.publishedFileId || entry.id} ${start}-${end}: ${e.message}`);
      }
      throw e;
    });
  promise.catch(() => {});
  return promise;
}

function scheduleInitialPrefetch(entry, depotLogin) {
  const total = parseInt(String(entry && entry.size || '0'), 10);
  if (!Number.isFinite(total) || total <= 0) return [];
  const generation = DEPOT_STREAM_GENERATION;
  const epoch = DEPOT_STREAM_DEMAND_EPOCHS.get(depotStreamCacheDir(entry)) || 0;
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
    const firstTask = prefetchDepotStreamRange(entry, firstRange.start, firstRange.end, depotLogin, 'first-buffer', generation, epoch);
    tasks.push(firstTask);
    chain = firstTask.catch(() => {});
  }
  if (tailRange && tailRange.start > 0) {
    const tailTask = chain.then(() => sleep(150)).then(() => prefetchDepotStreamRange(entry, tailRange.start, tailRange.end, depotLogin, 'tail-buffer', generation, epoch)).catch(() => {});
    tasks.push(tailTask);
    chain = tailTask;
  }
  if (initialRange) {
    const initialTask = chain.then(() => prefetchDepotStreamRange(entry, initialRange.start, initialRange.end, depotLogin, 'initial-buffer', generation, epoch)).catch(() => {});
    tasks.push(initialTask);
    chain = initialTask;
  }
  return tasks;
}

function scheduleAheadPrefetch(entry, currentStart, currentEnd, depotLogin, epoch = 0) {
  const total = parseInt(String(entry && entry.size || '0'), 10);
  if (!Number.isFinite(total) || total <= 0 || DEPOT_STREAM_AHEAD_BYTES <= 0) return;
  const generation = DEPOT_STREAM_GENERATION;
  const aheadStart = Math.min(total - 1, Math.max(0, currentEnd + 1));
  const aheadRange = clampDepotStreamRange(total, aheadStart, Math.min(DEPOT_STREAM_AHEAD_BYTES, DEPOT_STREAM_MAX_RANGE_BYTES));
  if (aheadRange) {
    DEPOT_STREAM_AHEAD_SCHEDULE_COUNT++;
    prefetchDepotStreamRange(entry, aheadRange.start, aheadRange.end, depotLogin, 'ahead-buffer', generation, epoch).catch(() => {});
  }
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
  let tempFiles = [];
  let removedFiles = 0;
  let removedBytes = 0;
  let removedTempFiles = 0;
  let removedTempBytes = 0;
  const staleTempCutoff = Date.now() - DEPOT_STREAM_TMP_STALE_MS;
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
        } else if (ent.isFile() && ent.name.endsWith('.tmp')) {
          const st = fs.statSync(fp);
          const resolved = path.resolve(fp);
          tempFiles.push({
            path: resolved,
            size: st.size,
            stale: st.mtimeMs <= staleTempCutoff && !DEPOT_STREAM_ACTIVE_TEMP_FILES.has(resolved),
          });
        }
      } catch {}
    }
  };
  try {
    walk(DEPOT_STREAM_CACHE_DIR);
    let remainingTempBytes = tempFiles.reduce((sum, file) => sum + file.size, 0);
    for (const tempFile of tempFiles) {
      if (!tempFile.stale) continue;
      if (DEPOT_STREAM_ACTIVE_TEMP_FILES.has(tempFile.path)) continue;
      if (removeDepotStreamTempFileNow(tempFile.path)) {
        removedTempFiles++;
        removedTempBytes += tempFile.size;
        remainingTempBytes -= tempFile.size;
      } else {
        scheduleDepotStreamTempCleanup(tempFile.path);
      }
    }
    let total = files.reduce((sum, file) => sum + file.size, remainingTempBytes);
    const maxBytes = getDepotStreamCacheMaxBytes();
    const highWatermarkBytes = Math.floor(maxBytes * (options.highWatermark || DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK));
    if (!options.force && total <= highWatermarkBytes) {
      return { skipped: true, bytes: total, maxBytes, removedTempFiles, removedTempBytes };
    }
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
    if (removedFiles > 0 || removedTempFiles > 0) {
      const tempSummary = removedTempFiles > 0
        ? `, stale temp=${removedTempFiles} (${fmtBytes(removedTempBytes) || `${removedTempBytes} B`})`
        : '';
      console.log(`[Depot Stream] cache cleanup removed ${removedFiles} cache file(s), ${fmtBytes(removedBytes) || `${removedBytes} B`}${tempSummary}, remaining=${fmtBytes(total) || `${total} B`}`);
    }
    return { removedFiles, removedBytes, removedTempFiles, removedTempBytes, bytes: total, maxBytes };
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
      cancelDepotStreamRangeTask(value, 'Stream cache cleared');
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

function nextDepotStreamDemandEpoch(entry) {
  const key = depotStreamCacheDir(entry);
  const epoch = (DEPOT_STREAM_DEMAND_EPOCHS.get(key) || 0) + 1;
  DEPOT_STREAM_DEMAND_EPOCHS.set(key, epoch);
  return epoch;
}

function cancelDepotStreamEntryPrefetch(entry, depotLogin) {
  const worker = DEPOT_STREAM_WORKERS.get(depotStreamWorkerKey(entry, depotLogin));
  if (worker && !worker.closed) cancelDepotStreamWorkerPrefetch(worker);
}

function createDepotStreamRequestAbort(req, res) {
  const controller = new AbortController();
  const abort = () => {
    if (!controller.signal.aborted) controller.abort();
  };
  const onRequestClose = () => {
    if (req.aborted || req.complete === false) abort();
  };
  const onResponseClose = () => {
    if (!res.writableFinished) abort();
  };
  req.once('aborted', abort);
  req.once('close', onRequestClose);
  res.once('close', onResponseClose);
  res.once('error', abort);
  if (req.aborted || res.destroyed) abort();
  return {
    signal: controller.signal,
    abort,
    cleanup() {
      req.removeListener('aborted', abort);
      req.removeListener('close', onRequestClose);
      res.removeListener('close', onResponseClose);
      res.removeListener('error', abort);
    },
  };
}

function streamDepotCacheSegment(res, segment, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(createDepotStreamAbortError());
      return;
    }
    const length = segment.end - segment.start + 1;
    const source = fs.createReadStream(segment.file, {
      start: segment.offset,
      end: segment.offset + length - 1,
    });
    let settled = false;
    const finish = (err) => {
      if (settled) return;
      settled = true;
      if (signal) signal.removeEventListener('abort', onAbort);
      source.removeListener('error', onError);
      source.removeListener('end', onEnd);
      if (err) reject(err);
      else resolve();
    };
    const onAbort = () => source.destroy(createDepotStreamAbortError());
    const onError = err => finish(err);
    const onEnd = () => finish();
    if (signal) signal.addEventListener('abort', onAbort, { once: true });
    source.once('error', onError);
    source.once('end', onEnd);
    source.pipe(res, { end: false });
  });
}

async function streamDepotCacheSegments(res, segments, signal) {
  const touched = new Set();
  for (const segment of segments) {
    if (signal && signal.aborted) throw createDepotStreamAbortError();
    if (!touched.has(segment.file)) {
      touched.add(segment.file);
      try {
        const now = new Date();
        fs.utimesSync(segment.file, now, now);
      } catch {}
    }
    await streamDepotCacheSegment(res, segment, signal);
  }
}

function endDepotStreamResponse(res, signal) {
  return new Promise((resolve) => {
    if (signal && signal.aborted) {
      resolve(false);
      return;
    }
    let settled = false;
    const finish = (completed) => {
      if (settled) return;
      settled = true;
      res.removeListener('finish', onFinish);
      res.removeListener('close', onClose);
      res.removeListener('error', onError);
      resolve(completed);
    };
    const onFinish = () => finish(true);
    const onClose = () => finish(!!res.writableFinished);
    const onError = () => finish(false);
    res.once('finish', onFinish);
    res.once('close', onClose);
    res.once('error', onError);
    res.end();
  });
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
  const depotLogin = resolveDepotLogin(431960);
  const initialCoverage = selectDepotStreamCoverage(entry, start, end);
  if (!initialCoverage.complete && steamKitNeedsOwnedAccount(431960) && !canUseDepotLogin(depotLogin)) {
    return jsonRes(res, 401, { error: makeSteamKitLoginRequiredError().message, requiresSteamLogin: true, code: 'STEAM_LOGIN_REQUIRED' });
  }
  const epoch = nextDepotStreamDemandEpoch(entry, depotLogin);
  const requestAbort = createDepotStreamRequestAbort(req, res);
  const blocks = planDepotStreamBlocks(total, start, end);
  let loginRetryPromise = null;
  const prepareWithLoginRetry = async (block, blockIndex) => {
    const alreadyCached = selectDepotStreamCoverage(entry, block.responseStart, block.responseEnd);
    if (alreadyCached.complete) return alreadyCached.segments;
    try {
      return await prepareDepotStreamBlock(entry, block, depotLogin, {
        priority: 'foreground',
        epoch,
        blockIndex,
        signal: requestAbort.signal,
      });
    } catch (rangeError) {
      const err = normalizeDepotError(rangeError);
      if (!isDepotStreamAbortError(err) && shouldRetrySteamLoginRequiredError &&
          shouldRetrySteamLoginRequiredError(err) && refreshPersistentSteamLoginForRetry) {
        if (!loginRetryPromise) {
          console.warn(`[Depot Stream] Range ${entry.publishedFileId || entry.id} ${block.start}-${block.end} reported login required despite cached account; retrying once.`);
          loginRetryPromise = refreshPersistentSteamLoginForRetry(`depot-stream-range:${entry.publishedFileId || entry.id}`);
        }
        const refreshed = await loginRetryPromise;
        if (!refreshed) throw err;
        return prepareDepotStreamBlock(entry, block, resolveDepotLogin(431960), {
          priority: 'foreground',
          epoch,
          blockIndex,
          signal: requestAbort.signal,
        });
      }
      throw err;
    }
  };
  const preparations = blocks.map((block, blockIndex) => prepareWithLoginRetry(block, blockIndex));
  let preparationFailure = null;
  for (const preparation of preparations) {
    preparation.catch((error) => {
      if (!preparationFailure && !requestAbort.signal.aborted &&
          !isDepotStreamAbortError(error) && !res.destroyed) {
        preparationFailure = error;
        requestAbort.abort();
      }
    });
  }
  // Creating the preparations synchronously promotes any shared range needed
  // by this demand. Only then is it safe to cancel unrelated prefetch work.
  cancelDepotStreamEntryPrefetch(entry, depotLogin);
  try {
    for (let blockIndex = 0; blockIndex < blocks.length; blockIndex++) {
      const segments = await preparations[blockIndex];
      if (requestAbort.signal.aborted) throw createDepotStreamAbortError();
      if (!res.headersSent) {
        console.log(`[Depot Stream] cache ready ${entry.publishedFileId || entry.id} ${start}-${end}`);
        res.writeHead(statusCode, outHeaders);
      }
      await streamDepotCacheSegments(res, segments, requestAbort.signal);
    }
    const completed = await endDepotStreamResponse(res, requestAbort.signal);
    if (completed && (!steamKitNeedsOwnedAccount(431960) || canUseDepotLogin(depotLogin))) {
      scheduleAheadPrefetch(entry, start, end, depotLogin, epoch);
    }
  } catch (e) {
    const failure = preparationFailure || e;
    const requestWasAborted = res.destroyed || (!preparationFailure &&
      (requestAbort.signal.aborted || isDepotStreamAbortError(e)));
    if (requestWasAborted) return;
    if (!requestAbort.signal.aborted) requestAbort.abort();
    const err = normalizeDepotError(failure);
    if (res.headersSent) {
      try { res.destroy(err); } catch {}
      return;
    }
    return jsonRes(res, err.statusCode || 500, {
      error: err.message,
      code: err.code || '',
      requiresSteamLogin: !!err.requiresSteamLogin,
      requiresSteamGuard: !!err.requiresSteamGuard
    });
  } finally {
    requestAbort.cleanup();
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
    _test: {
      planDepotStreamBlocks,
      listDepotStreamCacheRanges,
      selectDepotStreamCoverage,
      requestDepotStreamWorkerRange,
      handleDepotStreamWorkerMessage,
      cancelDepotStreamWorkerJob,
      promoteDepotStreamWorkerJob,
      demoteDepotStreamWorkerJob,
      waitForDepotStreamRangeTask,
      reconcileDepotStreamRangeTaskWaiters,
      createDepotStreamAbortError,
      isDepotStreamAbortError,
      shouldStopDepotStreamWorkerForRangeError,
      createDepotStreamRequestAbort,
      prepareDepotStreamBlock,
      prefetchDepotStreamRange,
      nextDepotStreamDemandEpoch,
      cancelDepotStreamEntryPrefetch,
      depotStreamWorkerKey,
      depotStreamRangePromiseKey,
      depotStreamRangeTaskReusable,
      findDepotStreamInFlightRange,
      depotStreamPrefetchTaskIsCurrent,
      attachDepotStreamWorkerStdinErrorHandler,
      depotStreamWorkerProcessExited,
      killDepotStreamWorkerProcess,
      clearDepotStreamWorkerForceKillTimer,
      scheduleDepotStreamWorkerForceKill,
      attachDepotStreamWorkerLifecycleCleanup,
      scheduleDepotStreamTempCleanup,
      retryDepotStreamWorkerTempCleanups,
      activeTempFiles: DEPOT_STREAM_ACTIVE_TEMP_FILES,
      tempCleanupRetries: DEPOT_STREAM_TEMP_CLEANUP_RETRIES,
      tmpStaleMs: DEPOT_STREAM_TMP_STALE_MS,
      getEstimatedCacheBytes: () => DEPOT_STREAM_CACHE_ESTIMATED_BYTES,
      getAheadScheduleCount: () => DEPOT_STREAM_AHEAD_SCHEDULE_COUNT,
      getDemandEpoch: entry => DEPOT_STREAM_DEMAND_EPOCHS.get(depotStreamCacheDir(entry)) || 0,
      getGeneration: () => DEPOT_STREAM_GENERATION,
    },
  };
}

module.exports = {
  createDepotStreamService,
};
