'use strict';

const http = require('http');
const https = require('https');
const { redactUrlPathForLog } = require('./shared');
const { createRedirectError } = require('./redirectPolicy');
const { createHttpProxyRequest } = require('./httpProxyTransport');
const { createConnectRequest } = require('./connectTransport');
const { createSocksRequest } = require('./socksTransport');

function createDirectRequest(opts, timeout, onResponse) {
  const protocol = opts.protocol || 'https:';
  const mod = protocol === 'http:' ? http : https;
  return mod.request({
    protocol,
    hostname: opts.hostname,
    port: opts.port || (protocol === 'http:' ? 80 : 443),
    path: opts.path,
    method: opts.method || 'GET',
    headers: opts.headers || {},
    timeout,
  }, onResponse);
}

function selectRequest(opts, timeout, proxy, helpers, onResponse, onError) {
  if (!proxy) return createDirectRequest(opts, timeout, onResponse);
  const isSocksProxyProtocol = helpers.isSocksProxyProtocol || (() => false);
  if (isSocksProxyProtocol(proxy.protocol)) {
    return createSocksRequest(opts, timeout, proxy, helpers.connectViaSocksProxy, onResponse, onError);
  }
  const auth = (helpers.proxyAuth || (() => ''))(proxy);
  if ((opts.protocol || 'https:') === 'http:') {
    return createHttpProxyRequest(opts, timeout, proxy, auth, onResponse);
  }
  return createConnectRequest(opts, timeout, proxy, auth, onResponse, onError);
}

function requestNative(opts, body, timeout, proxy, helpers = {}) {
  return new Promise((resolve, reject) => {
    let request;
    let abort = null;
    const cleanup = () => {
      if (abort && opts.signal) opts.signal.removeEventListener('abort', abort);
    };
    const fail = (error) => {
      cleanup();
      reject(error);
    };
    const onResponse = (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
        response.resume();
        fail(createRedirectError(response.headers.location));
        return;
      }
      if (response.statusCode < 200 || response.statusCode >= 300) {
        response.resume();
        fail(new Error(`HTTP ${response.statusCode} ${opts.hostname}${redactUrlPathForLog(opts.path || '/')}`));
        return;
      }
      const buffers = [];
      response.on('data', data => buffers.push(data));
      response.on('end', () => {
        cleanup();
        resolve(Buffer.concat(buffers));
      });
      response.on('error', fail);
    };

    if (opts.signal && opts.signal.aborted) {
      fail(Object.assign(new Error('Request aborted'), { code: 'ABORT_ERR' }));
      return;
    }
    Promise.resolve(selectRequest(opts, timeout, proxy, helpers, onResponse, fail)).then((createdRequest) => {
      request = createdRequest;
      request.on('error', fail);
      request.on('timeout', () => request.destroy(new Error('Timeout')));
      if (opts.signal) {
        abort = () => request.destroy(Object.assign(new Error('Request aborted'), { code: 'ABORT_ERR' }));
        if (opts.signal.aborted) {
          abort();
          return;
        }
        opts.signal.addEventListener('abort', abort, { once: true });
      }
      if (body) request.write(body);
      request.end();
    }).catch(fail);
  });
}

module.exports = {
  createDirectRequest,
  selectRequest,
  requestNative,
};
