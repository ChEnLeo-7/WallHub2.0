'use strict';

const fs = require('fs');

function createDepotStreamHttpResponse(options) {
  const {
    getVideoMime,
    send,
    createAbortError,
    pinCacheFile,
    readWindowBytes = 512 * 1024,
    logger = console,
  } = options;

  function streamFileWithRange(req, res, filePath) {
    const stat = fs.statSync(filePath);
    const total = stat.size;
    const contentType = getVideoMime(filePath);
    const range = req.headers.range;
    if (!range) {
      res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': total, 'Accept-Ranges': 'bytes' });
      fs.createReadStream(filePath).pipe(res);
      return;
    }
    const match = /^bytes=(\d*)-(\d*)$/i.exec(String(range).trim());
    if (!match) return send(res, 416, 'Invalid Range');
    const start = match[1] ? parseInt(match[1], 10) : 0;
    let end = match[2] ? parseInt(match[2], 10) : total - 1;
    if (Number.isNaN(start) || Number.isNaN(end) || start > end || start >= total) {
      return send(res, 416, 'Range Not Satisfiable');
    }
    end = Math.min(end, total - 1);
    res.writeHead(206, {
      'Content-Type': contentType,
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${total}`,
      'Accept-Ranges': 'bytes',
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  }

  function pipeCachedRange(res, cache, start, end, headers, statusCode, entry) {
    logger.log(`[Depot Stream] cache hit ${entry.publishedFileId || entry.id} ${start}-${end}`);
    try {
      const now = new Date();
      fs.utimesSync(cache.file, now, now);
    } catch {}
    res.writeHead(statusCode, headers);
    const release = pinCacheFile(cache.file);
    const source = fs.createReadStream(cache.file, { start: cache.offset, end: cache.offset + end - start });
    source.once('close', release);
    source.pipe(res);
  }

  function streamCacheSegment(res, segment, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(createAbortError());
      const release = pinCacheFile(segment.file);
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
        release();
        if (err) reject(err);
        else resolve();
      };
      const onAbort = () => source.destroy(createAbortError());
      const onError = err => finish(err);
      const onEnd = () => finish();
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
      source.once('error', onError);
      source.once('end', onEnd);
      source.pipe(res, { end: false });
    });
  }

  async function streamCacheSegments(res, segments, signal) {
    const touched = new Set();
    for (const segment of segments) {
      if (signal && signal.aborted) throw createAbortError();
      if (!touched.has(segment.file)) {
        touched.add(segment.file);
        try {
          const now = new Date();
          fs.utimesSync(segment.file, now, now);
        } catch {}
      }
      await streamCacheSegment(res, segment, signal);
    }
  }

  async function streamRangeTask(res, task, start, end, signal, delivery = null) {
    let cursor = start;
    if (task.downloadedUntil <= cursor) await task.waitForProgress(cursor, signal);
    if (task.error) throw task.error;
    let handle;
    let readingTemp = false;
    let releaseCache = null;
    const closeHandle = async () => {
      if (handle) await handle.close().catch(() => {});
      handle = null;
      if (readingTemp) task.endRead?.();
      readingTemp = false;
      if (releaseCache) releaseCache();
      releaseCache = null;
    };
    const openHandle = async () => {
      if (!task.committed) {
        readingTemp = true;
        task.beginRead?.();
        try {
          handle = await fs.promises.open(task.cacheTmpPath, 'r');
          return;
        } catch (error) {
          task.endRead?.();
          readingTemp = false;
          if (!task.committed) throw error;
        }
      }
      releaseCache = pinCacheFile ? pinCacheFile(task.cachePath) : null;
      try {
        handle = await fs.promises.open(task.cachePath, 'r');
      } catch (error) {
        if (releaseCache) releaseCache();
        releaseCache = null;
        throw error;
      }
    };
    const waitForDrain = () => new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(createAbortError());
      let settled = false;
      const finish = (error) => {
        if (settled) return;
        settled = true;
        res.removeListener('drain', onDrain);
        res.removeListener('close', onClose);
        res.removeListener('error', onError);
        if (signal) signal.removeEventListener('abort', onAbort);
        if (error) reject(error);
        else resolve();
      };
      const onDrain = () => finish();
      const onClose = () => finish(createAbortError());
      const onError = error => finish(error);
      const onAbort = () => finish(createAbortError());
      res.once('drain', onDrain);
      res.once('close', onClose);
      res.once('error', onError);
      if (signal) signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
      await openHandle();
      const buffer = Buffer.allocUnsafe(Math.max(64 * 1024, readWindowBytes));
      while (cursor <= end) {
        if (signal && signal.aborted) throw createAbortError();
        if (task.downloadedUntil <= cursor) await task.waitForProgress(cursor, signal);
        if (task.error) throw task.error;
        const available = Math.min(end - cursor + 1, task.downloadedUntil - cursor, buffer.length);
        if (available <= 0) {
          if (task.settled) throw new Error(`Depot stream read-through ended early ${cursor}-${end}`);
          continue;
        }
        const read = await handle.read(buffer, 0, available, cursor - task.start);
        if (!read.bytesRead) {
          if (task.settled) throw new Error(`Depot stream read-through ended early ${cursor}-${end}`);
          await task.waitForProgress(cursor, signal);
          continue;
        }
        cursor += read.bytesRead;
        task.servedUntil = Math.max(Number(task.servedUntil) || task.start, cursor);
        if (delivery && delivery.entry && delivery.requestedAt === delivery.entry.depotPlaybackRangeAnchor?.requestedAt) {
          delivery.entry.depotPlaybackRangeAnchor.servedUntil = cursor;
        }
        if (!res.write(buffer.subarray(0, read.bytesRead))) {
          // A paused browser can hold back an open response indefinitely. Release
          // the Windows temp handle so the completed extent can be committed and
          // subsequent prefetch work can continue while waiting for drain.
          // Observe rejection immediately: the response may close while the
          // Windows handle is still closing, before this function can await it.
          // Leaving that promise briefly unhandled terminates modern Node
          // processes even though the request-level catch runs moments later.
          const drainResult = waitForDrain().then(
            () => null,
            error => error
          );
          await closeHandle();
          const drainError = await drainResult;
          if (drainError) throw drainError;
          if (cursor <= end) await openHandle();
        }
      }
    } finally {
      await closeHandle();
    }
  }

  function endResponse(res, signal) {
    return new Promise((resolve) => {
      if (signal && signal.aborted) return resolve(false);
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

  return { streamFileWithRange, pipeCachedRange, streamCacheSegments, streamRangeTask, endResponse };
}

module.exports = { createDepotStreamHttpResponse };
