'use strict';

const zlib = require('zlib');

function decodeWallhubProxyBody(body, headers, logger = console) {
  const buf = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
  const encoding = String(headers && headers['content-encoding'] || '').trim().toLowerCase();
  if (!encoding || encoding === 'identity') return buf;
  try {
    if (encoding.includes('gzip')) return zlib.gunzipSync(buf);
    if (encoding.includes('br')) return zlib.brotliDecompressSync(buf);
    if (encoding.includes('deflate')) return zlib.inflateSync(buf);
  } catch (error) {
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`[UrlProxy] failed to decode ${encoding || 'encoded'} response: ${error.message}`);
    }
  }
  return buf;
}

function createWallhubProxyResponseHeaders(target, upstreamHeaders, contentType, bodyLength, rewriteText, isHead, helpers = {}) {
  const isAuthApiTarget = helpers.isAuthApiTarget || (() => false);
  const isWebApiServiceTarget = helpers.isWebApiServiceTarget || (() => false);
  const urlProxyPath = helpers.urlProxyPath || ((location) => location);
  const transformSetCookie = helpers.transformSetCookie || (() => []);

  const headers = {
    'Content-Type': contentType,
    'Cache-Control': isAuthApiTarget(target) ? 'no-store' : (rewriteText ? 'no-store' : (upstreamHeaders['cache-control'] || 'public, max-age=604800')),
    'X-WallHub-Proxy-Target': target.hostname,
  };
  if (upstreamHeaders['accept-ranges'] && !rewriteText) headers['Accept-Ranges'] = upstreamHeaders['accept-ranges'];
  const location = upstreamHeaders.location;
  if (location) headers.Location = urlProxyPath(location, target.toString());
  const setCookie = transformSetCookie(upstreamHeaders['set-cookie'], target.hostname);
  if (setCookie.length) headers['Set-Cookie'] = setCookie;
  if (isWebApiServiceTarget(target)) {
    for (const key of ['x-eresult', 'x-error_message']) {
      if (upstreamHeaders[key] !== undefined) headers[key] = upstreamHeaders[key];
    }
  }
  if (upstreamHeaders['content-range'] && !rewriteText) headers['Content-Range'] = upstreamHeaders['content-range'];
  for (const key of ['last-modified', 'expires']) {
    if (upstreamHeaders[key]) headers[key] = upstreamHeaders[key];
  }
  if (upstreamHeaders.etag && !rewriteText) headers.ETag = upstreamHeaders.etag;
  if (!isHead && Number.isFinite(bodyLength)) headers['Content-Length'] = String(bodyLength);
  return headers;
}

module.exports = {
  decodeWallhubProxyBody,
  createWallhubProxyResponseHeaders,
};
