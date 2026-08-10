'use strict';

const http = require('http');

function createHttpProxyRequest(opts, timeout, proxy, auth, onResponse) {
  const headers = Object.assign({}, opts.headers || {});
  if (auth) headers['Proxy-Authorization'] = auth;
  const port = opts.port ? `:${opts.port}` : '';
  return http.request({
    hostname: proxy.hostname,
    port: proxy.port || 80,
    method: opts.method || 'GET',
    path: `${opts.protocol || 'http:'}//${opts.hostname}${port}${opts.path || '/'}`,
    headers,
    timeout,
  }, onResponse);
}

module.exports = {
  createHttpProxyRequest,
};
