'use strict';

const http = require('http');
const https = require('https');
const tls = require('tls');

async function createSocksRequest(opts, timeout, proxy, connectViaSocksProxy, onResponse, onError) {
  const protocol = opts.protocol || 'https:';
  const targetPort = opts.port || (protocol === 'http:' ? 80 : 443);
  const socket = await connectViaSocksProxy(proxy, opts.hostname, targetPort, timeout);
  if (protocol === 'http:') {
    return http.request({
      hostname: opts.hostname,
      port: opts.port || 80,
      path: opts.path,
      method: opts.method || 'GET',
      headers: opts.headers || {},
      createConnection: () => socket,
      agent: false,
      timeout,
    }, onResponse);
  }

  const secureSocket = tls.connect({ socket, servername: opts.hostname });
  secureSocket.on('error', onError);
  return https.request({
    hostname: opts.hostname,
    port: opts.port || 443,
    path: opts.path,
    method: opts.method || 'GET',
    headers: opts.headers || {},
    createConnection: () => secureSocket,
    agent: false,
    timeout,
  }, onResponse);
}

module.exports = {
  createSocksRequest,
};
