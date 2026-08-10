'use strict';

const fs = require('fs');

function createDepotStreamHttpResponse(options) {
  const {
    getVideoMime,
    send,
    createAbortError,
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
    console.log(`[Depot Stream] cache hit ${entry.publishedFileId || entry.id} ${start}-${end}`);
    try {
      const now = new Date();
      fs.utimesSync(cache.file, now, now);
    } catch {}
    res.writeHead(statusCode, headers);
    fs.createReadStream(cache.file, { start: cache.offset, end: cache.offset + end - start }).pipe(res);
  }

  function streamCacheSegment(res, segment, signal) {
    return new Promise((resolve, reject) => {
      if (signal && signal.aborted) return reject(createAbortError());
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

  return { streamFileWithRange, pipeCachedRange, streamCacheSegments, endResponse };
}

module.exports = { createDepotStreamHttpResponse };
