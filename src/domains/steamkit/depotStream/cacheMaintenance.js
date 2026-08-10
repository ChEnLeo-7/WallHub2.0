'use strict';

const fs = require('fs');
const path = require('path');

function createDepotStreamCacheMaintenance(options) {
  const {
    cacheDir,
    cleanupHighWatermark,
    cleanupTarget,
    cleanupDebounceMs,
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
  } = options;
  const activeTempFiles = new Set();
  const tempCleanupRetries = new Map();
  const tmpStaleMs = Math.max(
    60 * 1000,
    parseInt(process.env.WALLHUB_DEPOT_STREAM_TMP_STALE_MS || String(30 * 60 * 1000), 10) || 30 * 60 * 1000
  );
  let cleanupTimer = null;
  let cleanupRunning = false;
  let estimatedBytes = -1;

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

  function activeCacheDirs() {
    const dirs = new Set();
    for (const worker of workers.values()) {
      if (!worker || worker.closed || !worker.info) continue;
      try {
        dirs.add(path.resolve(getCacheDir(worker.info)));
      } catch {}
    }
    for (const entry of getVideoStreams()) {
      if (!entry || entry.expiresAt <= Date.now()) continue;
      try {
        dirs.add(path.resolve(getCacheDir(entry)));
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
      for (const tempFile of tempFiles) {
        if (!tempFile.stale) continue;
        if (activeTempFiles.has(tempFile.path)) continue;
        if (removeTempFileNow(tempFile.path)) {
          removedTempFiles++;
          removedTempBytes += tempFile.size;
          remainingTempBytes -= tempFile.size;
        } else {
          scheduleTempCleanup(tempFile.path);
        }
      }
      let total = files.reduce((sum, file) => sum + file.size, remainingTempBytes);
      const maxBytes = getCacheMaxBytes();
      const highWatermarkBytes = Math.floor(maxBytes * (cleanupOptions.highWatermark || cleanupHighWatermark));
      if (!cleanupOptions.force && total <= highWatermarkBytes) {
        return { skipped: true, bytes: total, maxBytes, removedTempFiles, removedTempBytes };
      }
      const targetRatio = cleanupOptions.targetWatermark || (total > maxBytes ? 0.75 : cleanupTarget);
      const targetBytes = Math.max(0, Math.floor(maxBytes * targetRatio));
      const activeDirs = activeCacheDirs();
      files.sort((a, b) => {
        const firstProtected = cacheFileProtectedByActiveVideo(a.path, activeDirs) ? 1 : 0;
        const secondProtected = cacheFileProtectedByActiveVideo(b.path, activeDirs) ? 1 : 0;
        if (firstProtected !== secondProtected) return firstProtected - secondProtected;
        return a.mtimeMs - b.mtimeMs;
      });
      for (const file of files) {
        if (total <= targetBytes) break;
        if (!cleanupOptions.force && cacheFileProtectedByActiveVideo(file.path, activeDirs) && total <= maxBytes) continue;
        try {
          fs.rmSync(file.path, { force: true });
          total -= file.size;
          removedFiles++;
          removedBytes += file.size;
        } catch {}
      }
      cleanupEmptyCacheDirs();
      estimatedBytes = total;
      if (removedFiles > 0 || removedTempFiles > 0) {
        const tempSummary = removedTempFiles > 0
          ? `, stale temp=${removedTempFiles} (${fmtBytes(removedTempBytes) || `${removedTempBytes} B`})`
          : '';
        console.log(`[Depot Stream] cache cleanup removed ${removedFiles} cache file(s), ${fmtBytes(removedBytes) || `${removedBytes} B`}${tempSummary}, remaining=${fmtBytes(total) || `${total} B`}`);
      }
      return { removedFiles, removedBytes, removedTempFiles, removedTempBytes, bytes: total, maxBytes };
    } finally {
      cleanupRunning = false;
    }
  }

  function scheduleCacheCleanup(reason = 'scheduled') {
    if (cleanupTimer) return;
    cleanupTimer = setTimeout(() => {
      cleanupTimer = null;
      try { cleanupCache({ reason }); } catch (err) {
        console.warn(`[Depot Stream] cache cleanup failed: ${err.message}`);
      }
    }, cleanupDebounceMs);
    cleanupTimer.unref?.();
  }

  function maybeScheduleCacheCleanupAfterWrite(addedBytes = 0) {
    if (cleanupTimer || cleanupRunning) return;
    const maxBytes = getCacheMaxBytes();
    if (estimatedBytes < 0) {
      // Initialize the recursive size estimate off the playback request path.
      estimatedBytes = 0;
      scheduleCacheCleanup('initial-cache-size');
      return;
    }
    estimatedBytes += Math.max(0, Number(addedBytes || 0));
    if (estimatedBytes >= Math.floor(maxBytes * cleanupHighWatermark)) {
      scheduleCacheCleanup('high-watermark');
    }
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
    estimatedBytes = bytes;
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
      estimatedBytes = 0;
    } catch (err) {
      // Some Android/proot/overlay filesystems report ENOTEMPTY after clearing all files.
      try {
        cleanupEmptyCacheDirs();
        if (!hasFilesRecursive(cacheDir)) {
          ensureDir(cacheDir);
          estimatedBytes = 0;
          return Object.assign({ success: true, warning: err.message }, before, { files: 0, bytes: 0, cacheDir });
        }
      } catch {}
      throw new Error(`\u6e05\u7406\u5728\u7ebf\u64ad\u653e\u7f13\u5b58\u5931\u8d25: ${err.message}`);
    }
    return Object.assign({ success: true }, before, { cacheDir });
  }

  return {
    activeTempFiles,
    tempCleanupRetries,
    tmpStaleMs,
    scheduleTempCleanup,
    retryWorkerTempCleanups,
    cleanupCache,
    scheduleCacheCleanup,
    maybeScheduleCacheCleanupAfterWrite,
    getCacheStats,
    clearCacheNow,
    getEstimatedBytes: () => estimatedBytes,
  };
}

module.exports = { createDepotStreamCacheMaintenance };
