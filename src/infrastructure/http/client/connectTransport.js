'use strict';

const http = require('http');
const https = require('https');
const tls = require('tls');

function createConnectRequest(opts, timeout, proxy, auth, onResponse, onError) {
  return new Promise((resolve, reject) => {
    const headers = {};
    if (auth) headers['Proxy-Authorization'] = auth;
    const connectReq = http.request({
      hostname: proxy.hostname,
      port: proxy.port || 80,
      method: 'CONNECT',
      path: `${opts.hostname}:${opts.port || 443}`,
      headers,
      timeout,
    });

    connectReq.on('connect', (response, socket) => {
      if (response.statusCode !== 200) {
        socket.destroy();
        reject(new Error(`Proxy CONNECT ${response.statusCode}`));
        return;
      }
      const secureSocket = tls.connect({ socket, servername: opts.hostname });
      secureSocket.on('error', onError);
      resolve(https.request({
        hostname: opts.hostname,
        port: opts.port || 443,
        path: opts.path,
        method: opts.method || 'GET',
        headers: opts.headers || {},
        createConnection: () => secureSocket,
        agent: false,
        timeout,
      }, onResponse));
    });
    connectReq.on('error', reject);
    connectReq.on('timeout', () => connectReq.destroy(new Error('Timeout')));
    connectReq.end();
  });
}

module.exports = {
  createConnectRequest,
};
