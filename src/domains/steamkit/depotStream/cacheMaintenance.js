'use strict';

const fs = require('fs');
const path = require('path');

function createDepotStreamCacheMaintenance(options) {
  const {
    cacheDir,
    cleanupHighWatermark,
    cleanupTarget,
    cleanupDebounceMs,
    extentBytes,
    headBytes,
    tailBytes,
    workers,
    rangePromises,
    getCacheDir,
    getCacheMaxBytes,
    getVideoStreams,
    fmtBytes,
    hasFilesRecursive,
    ensureDir,
    stopAllWorkers,
    cancelRangeTask,
    removeCacheFile,
    clearCacheIndexes,
    logger = console,
  } = options;
  const activeTempFiles = new Set();
  const activeCacheFiles = new Map();
  const cacheWriteReservations = new Map();
  const tempCleanupRetries = new Map();
  const tmpStaleMs = Math.max(
    60 * 1000,
    parseInt(process.env.WALLHUB_DEPOT_STREAM_TMP_STALE_MS || String(30 * 60 * 1000), 10) || 30 * 60 * 1000
  );
  let cleanupTimer = null;
  let cleanupRunning = false;
  let estimatedBytes = -1;
  let reservedBytes = 0;
  let cacheEstimatePromise = null;

  async function initializeCacheEstimate() {
    if (estimatedBytes >= 0) return estimatedBytes;
    if (cacheEstimatePromise) return cacheEstimatePromise;
    const walk = async (dir) => {
      let entries = [];
      try { entries = await fs.promises.readdir(dir, { withFileTypes: true }); } catch { return 0; }
      let bytes = 0;
      for (const entry of entries) {
        const filePath = path.join(dir, entry.name);
        try {
          if (entry.isDirectory()) bytes += await walk(filePath);
          else if (entry.isFile()) bytes += (await fs.promises.stat(filePath)).size;
        } catch {}
      }
      return bytes;
    };
    cacheEstimatePromise = walk(cacheDir).then(bytes => {
      let activeTempBytes = 0;
      for (const tempPath of activeTempFiles) {
        try { activeTempBytes += fs.statSync(tempPath).size; } catch {}
      }
      if (estimatedBytes < 0) estimatedBytes = Math.max(0, bytes - activeTempBytes);
      return estimatedBytes;
    }).finally(() => {
      cacheEstimatePromise = null;
    });
    return cacheEstimatePromise;
  }

  void initializeCacheEstimate();

  function pinCacheFile(filePath) {
    const resolved = path.resolve(filePath);
    activeCacheFiles.set(resolved, (activeCacheFiles.get(resolved) || 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const readers = (activeCacheFiles.get(resolved) || 1) - 1;
      if (readers > 0) activeCacheFiles.set(resolved, readers);
      else activeCacheFiles.delete(resolved);
      if (estimatedBytes + reservedBytes > getCacheMaxBytes()) scheduleCacheCleanup('cache-reader-released', 0);
    };
  }

  function pinCacheFiles(files) {
    const releases = Array.from(new Set(files || []), pinCacheFile);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      for (const release of releases) release();
    };
  }

  function forgetTempCleanup(tempPath) {
    const resolved = path.resolve(tempPath);
    const pending = tempCleanupRetries.get(resolved);
    if (pending && pending.timer) clearTimeout(pending.timer);
    tempCleanupRetries.delete(resolved);
    if (pending && pending.worker && pending.worker.tempCleanupPaths) {
      pending.worker.tempCleanupPaths.delete(resolved);
    }
  }

  function removeTempFileNow(tempPath) {
    const resolved = path.resolve(tempPath);
    if (activeTempFiles.has(resolved)) return false;
    try {
      fs.rmSync(resolved, { force: true });
      if (fs.existsSync(resolved)) return false;
      forgetTempCleanup(resolved);
      return true;
    } catch {
      return false;
    }
  }

  function scheduleTempCleanup(tempPath, worker = null, attempt = 0, delayMs = null) {
    const resolved = path.resolve(tempPath);
    if (worker) {
      if (!worker.tempCleanupPaths) worker.tempCleanupPaths = new Set();
      worker.tempCleanupPaths.add(resolved);
    }
    if (removeTempFileNow(resolved)) {
      if (worker && worker.tempCleanupPaths) worker.tempCleanupPaths.delete(resolved);
      return true;
    }
    const previous = tempCleanupRetries.get(resolved);
    if (previous && previous.timer) clearTimeout(previous.timer);
    const cleanupWorker = worker || previous && previous.worker || null;
    if (activeTempFiles.has(resolved)) {
      tempCleanupRetries.delete(resolved);
      if (cleanupWorker && cleanupWorker.closed && cleanupWorker.tempCleanupPaths) {
        cleanupWorker.tempCleanupPaths.delete(resolved);
      }
      return false;
    }
    const nextAttempt = Math.max(attempt, previous && previous.attempt || 0);
    if (nextAttempt >= 8) {
      tempCleanupRetries.delete(resolved);
      if (cleanupWorker && cleanupWorker.closed && cleanupWorker.tempCleanupPaths) {
        cleanupWorker.tempCleanupPaths.delete(resolved);
      }
      return false;
    }
    const pending = { worker: cleanupWorker, attempt: nextAttempt, timer: null };
    tempCleanupRetries.set(resolved, pending);
    const delay = delayMs === null ? Math.min(30000, 250 * (2 ** nextAttempt)) : Math.max(0, delayMs);
    pending.timer = setTimeout(() => {
      pending.timer = null;
      scheduleTempCleanup(resolved, cleanupWorker, nextAttempt + 1);
    }, delay);
    pending.timer.unref?.();
    return false;
  }

  function retryWorkerTempCleanups(worker) {
    if (!worker || !worker.tempCleanupPaths) return;
    for (const tempPath of Array.from(worker.tempCleanupPaths)) {
      const pending = tempCleanupRetries.get(tempPath);
      scheduleTempCleanup(tempPath, worker, pending && pending.attempt || 0, 0);
    }
  }

  function activePlaybackWindows() {
    const windows = new Map();
    for (const entry of getVideoStreams()) {
      if (!entry || entry.expiresAt <= Date.now()) continue;
      try {
        const dir = path.resolve(getCacheDir(entry));
        const total = Math.max(0, Number(entry.size || 0));
        const feedback = entry.playbackFeedback || {};
        const average = feedback.duration > 0 ? total / feedback.duration : 0;
        const anchor = entry.depotPlaybackByteAnchor;
        const cursor = Math.max(0, Math.min(total,
          anchor && Number.isFinite(anchor.byte)
            ? anchor.byte
            : Number(feedback.currentTime || 0) * average));
        const adaptiveTarget = Math.max(0, Number(entry.depotAdaptivePolicy && entry.depotAdaptivePolicy.targetBytes || 0));
        const forwardBytes = Math.max(Number(extentBytes || 0) * 2, adaptiveTarget);
        windows.set(dir, {
          cursor,
          total,
          full: !!(entry.depotFullCacheTask && ['caching', 'complete'].includes(entry.depotFullCacheTask.status)),
          ranges: [
            [0, Math.min(total - 1, Math.max(0, Number(headBytes || extentBytes || 0)) - 1)],
            [Math.max(0, total - Math.max(0, Number(tailBytes || extentBytes || 0))), Math.max(0, total - 1)],
            [Math.max(0, cursor - Math.max(0, Number(extentBytes || 0)) * 2), Math.min(total - 1, cursor + forwardBytes - 1)],
          ],
        });
      } catch {}
    }
    return windows;
  }

  function parseCacheExtent(filePath) {
    const match = /^(\d+)-(\d+)\.bin$/.exec(path.basename(filePath));
    if (!match) return null;
    const start = Number(match[1]);
    const end = Number(match[2]);
    return Number.isFinite(start) && Number.isFinite(end) && end >= start ? { start, end } : null;
  }

  function cacheFileProtection(filePath, windows) {
    const resolved = path.resolve(filePath);
    if (activeCacheFiles.has(resolved)) return { protected: true, active: true, distance: 0 };
    const window = windows.get(path.dirname(resolved));
    const extent = parseCacheExtent(resolved);
    if (!window || !extent) return { protected: false, active: false, distance: Number.MAX_SAFE_INTEGER };
    if (window.full) return { protected: true, active: true, distance: 0 };
    const protectedRange = window.ranges.some(([start, end]) => extent.end >= start && extent.start <= end);
    const distance = extent.end < window.cursor
      ? window.cursor - extent.end
      : extent.start > window.cursor ? extent.start - window.cursor : 0;
    return { protected: protectedRange, active: true, distance };
  }

  function cleanupEmptyCacheDirs(root = cacheDir) {
    const walk = (dir) => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return false; }
      let empty = true;
      for (const entry of entries) {
        const filePath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (!walk(filePath)) empty = false;
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

  function cleanupCache(cleanupOptions = {}) {
    if (cleanupRunning && !cleanupOptions.force) return { skipped: true, reason: 'running' };
    cleanupRunning = true;
    const files = [];
    const tempFiles = [];
    let removedFiles = 0;
    let removedBytes = 0;
    let removedTempFiles = 0;
    let removedTempBytes = 0;
    const staleTempCutoff = Date.now() - tmpStaleMs;
    const walk = (dir) => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const filePath = path.join(dir, entry.name);
        try {
          if (entry.isDirectory()) walk(filePath);
          else if (entry.isFile() && entry.name.endsWith('.bin')) {
            const stat = fs.statSync(filePath);
            files.push({ path: filePath, size: stat.size, mtimeMs: stat.mtimeMs, dir: path.dirname(filePath) });
          } else if (entry.isFile() && entry.name.endsWith('.tmp')) {
            const stat = fs.statSync(filePath);
            const resolved = path.resolve(filePath);
            tempFiles.push({
              path: resolved,
              size: stat.size,
              stale: stat.mtimeMs <= staleTempCutoff && !activeTempFiles.has(resolved),
            });
          }
        } catch {}
      }
    };
    try {
      walk(cacheDir);
      let remainingTempBytes = tempFiles.reduce((sum, file) => sum + file.size, 0);
      let accountedTempBytes = tempFiles.reduce((sum, file) =>
        sum + (activeTempFiles.has(file.path) ? 0 : file.size), 0);
      for (const tempFile of tempFiles) {
        if (!tempFile.stale) continue;
        if (activeTempFiles.has(tempFile.path)) continue;
        if (removeTempFileNow(tempFile.path)) {
          removedTempFiles++;
          removedTempBytes += tempFile.size;
          remainingTempBytes -= tempFile.size;
          accountedTempBytes -= tempFile.size;
        } else {
          scheduleTempCleanup(tempFile.path);
        }
      }
      let total = files.reduce((sum, file) => sum + file.size, remainingTempBytes);
      let accountedTotal = files.reduce((sum, file) => sum + file.size, accountedTempBytes);
      const maxBytes = getCacheMaxBytes();
      const highWatermarkBytes = Math.floor(maxBytes * (cleanupOptions.highWatermark || cleanupHighWatermark));
      if (!cleanupOptions.force && accountedTotal <= highWatermarkBytes) {
        estimatedBytes = accountedTotal;
        return { skipped: true, bytes: total, maxBytes, removedTempFiles, removedTempBytes };
      }
      const targetRatio = cleanupOptions.targetWatermark || (accountedTotal > maxBytes ? 0.75 : cleanupTarget);
      const targetBytes = Number.isFinite(cleanupOptions.targetBytes)
        ? Math.max(0, Math.floor(cleanupOptions.targetBytes))
        : Math.max(0, Math.floor(maxBytes * targetRatio));
      const playbackWindows = activePlaybackWindows();
      files.sort((a, b) => {
        const first = cacheFileProtection(a.path, playbackWindows);
        const second = cacheFileProtection(b.path, playbackWindows);
        if (first.protected !== second.protected) return first.protected ? 1 : -1;
        if (first.active !== second.active) return first.active ? -1 : 1;
        if (first.active && first.distance !== second.distance) return second.distance - first.distance;
        return a.mtimeMs - b.mtimeMs;
      });
      for (const file of files) {
        if (accountedTotal <= targetBytes) break;
        if (cacheFileProtection(file.path, playbackWindows).protected) continue;
        try {
          fs.rmSync(file.path, { force: true });
          if (removeCacheFile) removeCacheFile(file.path);
          total -= file.size;
          accountedTotal -= file.size;
          removedFiles++;
          removedBytes += file.size;
        } catch {}
      }
      cleanupEmptyCacheDirs();
      estimatedBytes = accountedTotal;
      if (removedFiles > 0 || removedTempFiles > 0) {
        const tempSummary = removedTempFiles > 0
          ? `, stale temp=${removedTempFiles} (${fmtBytes(removedTempBytes) || `${removedTempBytes} B`})`
          : '';
        logger.log(`[Depot Stream] cache cleanup removed ${removedFiles} cache file(s), ${fmtBytes(removedBytes) || `${removedBytes} B`}${tempSummary}, remaining=${fmtBytes(total) || `${total} B`}`);
      }
      return { removedFiles, removedBytes, removedTempFiles, removedTempBytes, bytes: total, maxBytes };
    } finally {
      cleanupRunning = false;
    }
  }

  function scheduleCacheCleanup(reason = 'scheduled', delayMs = cleanupDebounceMs) {
    if (cleanupTimer) return;
    cleanupTimer = setTimeout(() => {
      cleanupTimer = null;
      try { cleanupCache({ reason }); } catch (err) {
        logger.warn(`[Depot Stream] cache cleanup failed: ${err.message}`);
      }
    }, Math.max(0, delayMs));
    cleanupTimer.unref?.();
  }

  function maybeScheduleCacheCleanupAfterWrite(addedBytes = 0) {
    const maxBytes = getCacheMaxBytes();
    if (estimatedBytes < 0) {
      // Initialize the recursive size estimate off the playback request path.
      estimatedBytes = 0;
      scheduleCacheCleanup('initial-cache-size');
      return;
    }
    estimatedBytes += Math.max(0, Number(addedBytes || 0));
    if (cleanupTimer || cleanupRunning) return;
    if (estimatedBytes >= Math.floor(maxBytes * cleanupHighWatermark)) {
      scheduleCacheCleanup('high-watermark');
    }
  }

  function reserveCacheWrite(expectedBytes, tempPath, allowCleanup = true) {
    const bytes = Math.max(0, Number(expectedBytes || 0));
    if (bytes <= 0 || bytes > getCacheMaxBytes()) return null;
    if (estimatedBytes < 0) cleanupCache();
    const maxBytes = getCacheMaxBytes();
    if (allowCleanup && estimatedBytes + reservedBytes + bytes > maxBytes) {
      cleanupCache({
        force: true,
        targetBytes: maxBytes - reservedBytes - bytes,
        reason: 'write-reservation',
      });
    }
    if (estimatedBytes + reservedBytes + bytes > maxBytes) return null;
    const reservation = { bytes, tempPath: path.resolve(tempPath) };
    cacheWriteReservations.set(reservation, reservation);
    reservedBytes += bytes;
    return reservation;
  }

  async function reserveCacheWriteAsync(expectedBytes, tempPath) {
    await initializeCacheEstimate();
    return reserveCacheWrite(expectedBytes, tempPath);
  }

  async function waitForCacheWrite(expectedBytes, tempPath, signal, timeoutMs = 3000) {
    const deadline = Date.now() + Math.max(0, timeoutMs);
    let allowCleanup = true;
    while (true) {
      if (signal && signal.aborted) return null;
      await initializeCacheEstimate();
      const reservation = reserveCacheWrite(expectedBytes, tempPath, allowCleanup);
      allowCleanup = false;
      if (reservation || Date.now() >= deadline) return reservation;
      await new Promise(resolve => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (signal) signal.removeEventListener('abort', finish);
          resolve();
        };
        const timer = setTimeout(finish, 100);
        timer.unref?.();
        if (signal) signal.addEventListener('abort', finish, { once: true });
      });
    }
  }

  function releaseCacheWrite(reservation, committedBytes = 0) {
    if (!reservation || !cacheWriteReservations.delete(reservation)) return false;
    reservedBytes = Math.max(0, reservedBytes - reservation.bytes);
    if (committedBytes > 0) maybeScheduleCacheCleanupAfterWrite(committedBytes);
    return true;
  }

  function getCacheStats() {
    let files = 0;
    let bytes = 0;
    const walk = (dir) => {
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) {
        const filePath = path.join(dir, entry.name);
        try {
          if (entry.isDirectory()) walk(filePath);
          else if (entry.isFile()) {
            files++;
            bytes += fs.statSync(filePath).size;
          }
        } catch {}
      }
    };
    walk(cacheDir);
    let activeTempBytes = 0;
    for (const tempPath of activeTempFiles) {
      try { activeTempBytes += fs.statSync(tempPath).size; } catch {}
    }
    estimatedBytes = Math.max(0, bytes - activeTempBytes);
    return { files, bytes };
  }

  function clearCacheNow() {
    if (cleanupTimer) {
      clearTimeout(cleanupTimer);
      cleanupTimer = null;
    }
    stopAllWorkers('clear-stream-cache');
    for (const [key, value] of Array.from(rangePromises.entries())) {
      if (key.startsWith(path.resolve(cacheDir)) || key.includes(cacheDir)) {
        cancelRangeTask(value, 'Stream cache cleared');
        rangePromises.delete(key);
        if (value && value.promise && typeof value.promise.catch === 'function') value.promise.catch(() => {});
      }
    }
    const before = getCacheStats();
    try {
      fs.rmSync(cacheDir, { recursive: true, force: true });
      ensureDir(cacheDir);
      if (clearCacheIndexes) clearCacheIndexes();
      estimatedBytes = 0;
      cacheWriteReservations.clear();
      reservedBytes = 0;
    } catch (err) {
      // Some Android/proot/overlay filesystems report ENOTEMPTY after clearing all files.
      try {
        cleanupEmptyCacheDirs();
        if (!hasFilesRecursive(cacheDir)) {
          ensureDir(cacheDir);
          if (clearCacheIndexes) clearCacheIndexes();
          estimatedBytes = 0;
          return Object.assign({ success: true, warning: err.message }, before, {
            files: 0,
            bytes: 0,
            removedBytes: before.bytes,
            remainingBytes: 0,
            cacheDir,
          });
        }
      } catch {}
      throw new Error(`\u6e05\u7406\u5728\u7ebf\u64ad\u653e\u7f13\u5b58\u5931\u8d25: ${err.message}`);
    }
    return Object.assign({ success: true }, before, {
      removedBytes: before.bytes,
      remainingBytes: 0,
      cacheDir,
    });
  }

  return {
    activeTempFiles,
    activeCacheFiles,
    tempCleanupRetries,
    tmpStaleMs,
    scheduleTempCleanup,
    retryWorkerTempCleanups,
    cleanupCache,
    scheduleCacheCleanup,
    maybeScheduleCacheCleanupAfterWrite,
    reserveCacheWrite,
    reserveCacheWriteAsync,
    waitForCacheWrite,
    releaseCacheWrite,
    pinCacheFile,
    pinCacheFiles,
    getCacheStats,
    clearCacheNow,
    getEstimatedBytes: () => estimatedBytes,
    getReservedBytes: () => reservedBytes,
  };
}

module.exports = { createDepotStreamCacheMaintenance };
