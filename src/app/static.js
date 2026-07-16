'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function cacheControlForStaticPath(rel) {
  const normalized = String(rel || '').replace(/\\/g, '/');
  if (/(?:^|\/)index\.html?$/i.test(normalized)) return 'no-cache';
  if (/(?:^|\/)assets\/.+/i.test(normalized)) return 'public, max-age=31536000, immutable';
  return 'public, max-age=3600';
}

function etagForStat(stat) {
  return `W/\"${Number(stat.size || 0).toString(16)}-${Math.floor(Number(stat.mtimeMs || 0)).toString(16)}\"`;
}

function acceptsEncoding(req, encoding) {
  const accept = String(req && req.headers && req.headers['accept-encoding'] || '').toLowerCase();
  return new RegExp(`(?:^|[,\\s])${encoding}(?:[;,\\s]|$)`).test(accept);
}

function isCompressibleContentType(contentType) {
  return /^(?:text\/|application\/(?:javascript|json|xml)|image\/svg\+xml)/i.test(String(contentType || ''));
}

function createStaticHandler(options = {}) {
  const publicDir = path.resolve(options.publicDir || 'public');
  const send = options.send;
  const mimeType = options.mimeType || (() => 'application/octet-stream');

  return function serveStatic(req, res) {
    let rel;
    try { rel = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { rel = '/'; }
    if (rel === '/' || rel === '') rel = '/index.html';
    const safe = path.normalize(path.join(publicDir, rel));
    if (!safe.startsWith(publicDir)) {
      send(res, 403, 'Forbidden');
      return;
    }
    fs.stat(safe, (err, stat) => {
      if (err || !stat.isFile()) {
        send(res, 404, 'Not Found');
        return;
      }
      const contentType = mimeType(safe);
      const etag = etagForStat(stat);
      const headers = {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': cacheControlForStaticPath(rel),
        ETag: etag,
        'Last-Modified': stat.mtime.toUTCString(),
      };
      if (String(req.headers && req.headers['if-none-match'] || '') === etag) {
        res.writeHead(304, headers);
        res.end();
        return;
      }

      const shouldCompress = stat.size >= 1024 && isCompressibleContentType(contentType);
      const encoding = shouldCompress && acceptsEncoding(req, 'br')
        ? 'br'
        : shouldCompress && acceptsEncoding(req, 'gzip')
          ? 'gzip'
          : '';
      if (encoding) {
        headers['Content-Encoding'] = encoding;
        headers.Vary = 'Accept-Encoding';
      } else {
        headers['Content-Length'] = stat.size;
      }
      res.writeHead(200, headers);
      const source = fs.createReadStream(safe);
      if (encoding === 'br') source.pipe(zlib.createBrotliCompress()).pipe(res);
      else if (encoding === 'gzip') source.pipe(zlib.createGzip()).pipe(res);
      else source.pipe(res);
    });
  };
}

module.exports = {
  createStaticHandler,
  cacheControlForStaticPath,
  etagForStat,
};
