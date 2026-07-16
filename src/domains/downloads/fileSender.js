'use strict';

const fs = require('fs');

function createDownloadFileSender(options = {}) {
  const fsApi = options.fs || fs;

  function emitDebug(sendOptions, message) {
    if (typeof sendOptions.onDebug !== 'function') return;
    try { sendOptions.onDebug(String(message)); } catch {}
  }

  function sendDownloadFile(req, res, filePath, fileName, sendOptions = {}) {
    const stat = fsApi.statSync(filePath);
    const startedAt = Date.now();
    const requestedRange = String(req && req.headers && req.headers.range || '').trim() || '-';
    let streamedBytes = 0;
    let responseFinished = false;
    const debug = (message) => emitDebug(sendOptions, message);

    debug(`response headers filename=${fileName} bytes=${stat.size} range=${requestedRange}`);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(fileName)}`,
      'Cache-Control': 'no-store'
    });
    if (sendOptions.deleteAfterSend) {
      res.on('finish', () => { setTimeout(() => { try { fsApi.rmSync(filePath, { force: true }); } catch {} }, 5000); });
      res.on('close', () => { setTimeout(() => { try { fsApi.rmSync(filePath, { force: true }); } catch {} }, 15000); });
    }

    const stream = fsApi.createReadStream(filePath);
    stream.on('data', chunk => { streamedBytes += Buffer.byteLength(chunk); });
    stream.once('open', () => debug(`stream opened filename=${fileName}`));
    stream.once('error', (error) => {
      debug(`stream read error filename=${fileName} bytes=${streamedBytes} error=${error && error.message || error}`);
      if (typeof res.destroy === 'function' && !res.destroyed) res.destroy(error);
    });
    if (typeof res.once === 'function') {
      res.once('finish', () => {
        responseFinished = true;
        debug(`stream completed filename=${fileName} bytes=${streamedBytes} elapsedMs=${Date.now() - startedAt}`);
      });
      res.once('close', () => {
        if (!responseFinished) debug(`stream closed before finish filename=${fileName} bytes=${streamedBytes} elapsedMs=${Date.now() - startedAt}`);
      });
      res.once('error', error => debug(`response error filename=${fileName} bytes=${streamedBytes} error=${error && error.message || error}`));
    }
    stream.pipe(res);
  }

  return sendDownloadFile;
}

module.exports = {
  createDownloadFileSender,
};
