'use strict';

const http = require('http');
const net = require('net');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHttpClient } = require('../client');

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject);
      resolve(server.address().port);
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

test('native transport follows relative redirects', async () => {
  const paths = [];
  const server = http.createServer((req, res) => {
    paths.push(req.url);
    if (req.url === '/start') {
      res.writeHead(302, { Location: '/final?ok=1' });
      res.end();
      return;
    }
    res.end('redirected');
  });
  const port = await listen(server);

  try {
    const client = createHttpClient({ getProxyCandidates: () => [null] });
    const body = await client.get(`http://127.0.0.1:${port}/start`, {
      wallhubDisableCurlProxy: true,
    });

    assert.equal(body.toString('utf8'), 'redirected');
    assert.deepEqual(paths, ['/start', '/final?ok=1']);
  } finally {
    await close(server);
  }
});

test('HTTP proxy transport sends an absolute target URL and proxy authorization', async () => {
  let received;
  const proxyServer = http.createServer((req, res) => {
    received = { url: req.url, authorization: req.headers['proxy-authorization'] };
    res.end('proxied');
  });
  const port = await listen(proxyServer);

  try {
    const client = createHttpClient({
      getProxyCandidates: () => [{ protocol: 'http:', hostname: '127.0.0.1', port }],
      proxyAuth: () => 'Basic dGVzdA==',
    });
    const body = await client.doRequest({
      protocol: 'http:',
      hostname: 'example.test',
      path: '/asset?id=1',
      method: 'GET',
      headers: {},
      timeout: 1000,
      disableCurlProxy: true,
    });

    assert.equal(body.toString('utf8'), 'proxied');
    assert.deepEqual(received, {
      url: 'http://example.test/asset?id=1',
      authorization: 'Basic dGVzdA==',
    });
  } finally {
    await close(proxyServer);
  }
});

test('native transport retries the next proxy after a connection failure', async () => {
  const failingProxy = http.createServer((req) => req.socket.destroy());
  const workingProxy = http.createServer((req, res) => res.end('second proxy'));
  const failingPort = await listen(failingProxy);
  const workingPort = await listen(workingProxy);

  try {
    const client = createHttpClient({
      getProxyCandidates: () => [
        { protocol: 'http:', hostname: '127.0.0.1', port: failingPort },
        { protocol: 'http:', hostname: '127.0.0.1', port: workingPort },
      ],
      shouldRetryWithNextProxy: error => error && error.code === 'ECONNRESET',
    });
    const body = await client.doRequest({
      protocol: 'http:',
      hostname: 'example.test',
      path: '/',
      method: 'GET',
      headers: {},
      timeout: 1000,
      disableCurlProxy: true,
    });

    assert.equal(body.toString('utf8'), 'second proxy');
  } finally {
    await Promise.all([close(failingProxy), close(workingProxy)]);
  }
});

test('SOCKS transport delegates socket creation to the configured connector', async () => {
  const targetServer = http.createServer((req, res) => res.end('through socks'));
  const port = await listen(targetServer);
  let connection;
  let connectedSocket;

  try {
    const proxy = { protocol: 'socks5:', hostname: 'proxy.test', port: 1080 };
    const client = createHttpClient({
      getProxyCandidates: () => [proxy],
      isSocksProxyProtocol: protocol => protocol === 'socks5:',
      connectViaSocksProxy: (receivedProxy, host, targetPort, timeout) => {
        connection = { receivedProxy, host, targetPort, timeout };
        return new Promise((resolve, reject) => {
          const socket = net.connect({ host: '127.0.0.1', port: targetPort });
          connectedSocket = socket;
          socket.once('connect', () => resolve(socket));
          socket.once('error', reject);
        });
      },
    });
    const body = await client.doRequest({
      protocol: 'http:',
      hostname: '127.0.0.1',
      port,
      path: '/',
      method: 'GET',
      headers: { Connection: 'close' },
      timeout: 1000,
      disableCurlProxy: true,
    });

    assert.equal(body.toString('utf8'), 'through socks');
    assert.deepEqual(connection, {
      receivedProxy: proxy,
      host: '127.0.0.1',
      targetPort: port,
      timeout: 1000,
    });
  } finally {
    if (connectedSocket) connectedSocket.destroy();
    await close(targetServer);
  }
});

test('CONNECT transport reports a rejected proxy tunnel', async () => {
  const proxyServer = http.createServer();
  proxyServer.on('connect', (req, socket) => {
    socket.end('HTTP/1.1 407 Proxy Authentication Required\r\n\r\n');
  });
  const port = await listen(proxyServer);

  try {
    const client = createHttpClient({
      getProxyCandidates: () => [{ protocol: 'http:', hostname: '127.0.0.1', port }],
    });
    await assert.rejects(client.doRequest({
      protocol: 'https:',
      hostname: 'example.test',
      path: '/',
      method: 'GET',
      headers: {},
      timeout: 1000,
      disableCurlProxy: true,
    }), /Proxy CONNECT 407/);
  } finally {
    await close(proxyServer);
  }
});
