'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const { createInternalSteamResolverHandler, createInternalSteamWebApiBrokerHandler, isLoopbackAddress, steamHostAllowedForDepotResolver } = require('./internalResolver');

function makeReq(url, options = {}) {
  return {
    method: options.method || 'GET',
    url,
    headers: Object.assign({}, options.headers || {}),
    socket: { remoteAddress: options.remoteAddress || '127.0.0.1' },
  };
}

function makeHandler(options = {}) {
  const calls = [];
  const systemCalls = [];
  const routeCalls = [];
  const handler = createInternalSteamResolverHandler({
    token: 'secret-token',
    resolveHost: async (host) => {
      calls.push(host);
      return { ips: ['203.0.113.10'], protocol: 'doh', endpoints: ['https://dns.alidns.com/resolve'], source: 'resolver' };
    },
    resolveSystemHost: async (host) => {
      systemCalls.push(host);
      return { ips: ['192.0.2.10'] };
    },
    chooseRoute: async (host, port, routeOptions) => {
      routeCalls.push({ host, port, routeOptions });
      return { ip: '198.51.100.20', ips: ['198.51.100.20', '198.51.100.21'], source: 'route-cache', resolverProtocol: 'doh', resolverEndpoints: ['https://doh.pub/resolve'] };
    },
    jsonRes: (res, code, body) => {
      res.statusCode = code;
      res.body = body;
    },
    logger: { warn() {}, log() {} },
    ...options,
  });
  return { handler, calls, systemCalls, routeCalls };
}

test('isLoopbackAddress accepts IPv4, IPv6 and IPv4-mapped loopback', () => {
  assert.equal(isLoopbackAddress('127.0.0.1'), true);
  assert.equal(isLoopbackAddress('::1'), true);
  assert.equal(isLoopbackAddress('::ffff:127.0.0.1'), true);
  assert.equal(isLoopbackAddress('192.168.1.2'), false);
});
test('steamHostAllowedForDepotResolver only allows Steam WebAPI hosts', () => {
  assert.equal(steamHostAllowedForDepotResolver('api.steampowered.com'), true);
  assert.equal(steamHostAllowedForDepotResolver('community.steam-api.com'), true);
  assert.equal(steamHostAllowedForDepotResolver('dl.steam.clngaa.com'), true);
  assert.equal(steamHostAllowedForDepotResolver('xz.pphimalayanrt.com'), true);
  assert.equal(steamHostAllowedForDepotResolver('cache1-hkg1.steamcontent.com'), true);
  assert.equal(steamHostAllowedForDepotResolver('cm1-sto1.cm.steampowered.com'), false);
  assert.equal(steamHostAllowedForDepotResolver('cm1-hkg1.steamserver.net'), false);
  assert.equal(steamHostAllowedForDepotResolver('example.com'), false);
});

test('internal resolver rejects missing token before resolving', async () => {
  const { handler, calls } = makeHandler();
  const res = {};

  await handler(makeReq('/api/internal/steam/resolve?host=api.steampowered.com'), res);

  assert.equal(res.statusCode, 403);
  assert.equal(calls.length, 0);
});

test('internal resolver rejects non-loopback clients', async () => {
  const { handler, calls } = makeHandler();
  const res = {};

  await handler(makeReq('/api/internal/steam/resolve?host=api.steampowered.com', {
    remoteAddress: '10.0.0.5',
    headers: { 'x-wallhub-resolver-token': 'secret-token' },
  }), res);

  assert.equal(res.statusCode, 403);
  assert.equal(calls.length, 0);
});

test('internal resolver rejects non-Steam hosts', async () => {
  const { handler, calls } = makeHandler();
  const res = {};

  await handler(makeReq('/api/internal/steam/resolve?host=example.com', {
    headers: { 'x-wallhub-resolver-token': 'secret-token' },
  }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(calls.length, 0);
});

test('internal resolver returns WallHub resolver result for allowed host', async () => {
  const { handler, calls } = makeHandler();
  const res = {};

  await handler(makeReq('/api/internal/steam/resolve?host=api.steampowered.com', {
    headers: { 'x-wallhub-resolver-token': 'secret-token' },
  }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, ['api.steampowered.com']);
  assert.deepEqual(res.body.ips, ['203.0.113.10']);
  assert.equal(res.body.protocol, 'doh');
  assert.deepEqual(res.body.endpoints, ['https://dns.alidns.com/resolve']);
});

test('disabled internal resolver uses system DNS without SteamAccess resolution or probes', async () => {
  const logs = [];
  const { handler, calls, systemCalls, routeCalls } = makeHandler({
    enabled: () => false,
    logger: { warn() {}, log(message) { logs.push(message); } },
  });
  const res = {};

  await handler(makeReq('/api/internal/steam/resolve?host=api.steampowered.com&port=443&route=1', {
    headers: { 'x-wallhub-resolver-token': 'secret-token' },
  }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.ips, ['192.0.2.10']);
  assert.equal(res.body.source, 'system');
  assert.deepEqual(systemCalls, ['api.steampowered.com']);
  assert.deepEqual(calls, []);
  assert.deepEqual(routeCalls, []);
  assert.equal(logs.some(line => String(line).includes('internal depot resolver start')), false);
});

test('internal resolver route mode returns prewarmed application-probed SteamAccess route without probing inline', async () => {
  const { handler, calls, routeCalls } = makeHandler();
  const res = {};

  await handler(makeReq('/api/internal/steam/resolve?host=api.steampowered.com&port=443&route=1', {
    headers: { 'x-wallhub-resolver-token': 'secret-token' },
  }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(calls, []);
  assert.deepEqual(routeCalls.map(item => [item.host, item.port, item.routeOptions]), [[
    'api.steampowered.com',
    443,
    {
      forceRefresh: false,
      cacheOnly: true,
      requireApplicationProbe: true,
      backgroundRefresh: false,
      maxAgeMs: 10 * 60 * 1000,
    },
  ]]);
  assert.deepEqual(res.body.ips, ['198.51.100.20', '198.51.100.21']);
  assert.equal(res.body.source, 'route-cache');
  assert.equal(res.body.protocol, 'doh');
  assert.deepEqual(res.body.endpoints, ['https://doh.pub/resolve']);
  assert.equal(res.body.lease.type, 'wallhub-steam-webapi-route-lease');
  assert.equal(res.body.lease.mode, 'broker-preferred');
  assert.equal(res.body.lease.requireApplicationProbe, true);
  assert.equal(res.body.lease.quality, 'probed');
});

test('internal resolver route mode returns 503 when prewarmed control-plane route is missing', async () => {
  const { handler, calls, routeCalls } = makeHandler({
    chooseRoute: async (host, port, routeOptions) => {
      routeCalls.push({ host, port, routeOptions });
      return null;
    },
  });
  const res = {};

  await handler(makeReq('/api/internal/steam/resolve?host=api.steampowered.com&port=443&route=1', {
    headers: { 'x-wallhub-resolver-token': 'secret-token' },
  }), res);

  assert.equal(res.statusCode, 503);
  assert.equal(res.body.code, 'STEAM_WEBAPI_ROUTE_NOT_READY');
  assert.deepEqual(calls, []);
  assert.equal(routeCalls.length, 1);
});

test('internal resolver rejects CM records because Depot CM DNS is no longer intercepted', async () => {
  const { handler, calls, routeCalls } = makeHandler();
  const res = {};

  await handler(makeReq('/api/internal/steam/resolve?host=cm1-hkg1.steamserver.net&port=27018&route=0', {
    headers: { 'x-wallhub-resolver-token': 'secret-token' },
  }), res);

  assert.equal(res.statusCode, 400);
  assert.deepEqual(routeCalls, []);
  assert.deepEqual(calls, []);
});

function makeBodyReq(url, options = {}) {
  const req = options.body === undefined ? Readable.from([]) : Readable.from([Buffer.from(options.body)]);
  req.method = options.method || 'POST';
  req.url = url;
  req.headers = Object.assign({}, options.headers || {});
  req.socket = { remoteAddress: options.remoteAddress || '127.0.0.1' };
  return req;
}

function makeBrokerRes() {
  return {
    statusCode: 0,
    headers: {},
    body: Buffer.alloc(0),
    writeHead(code, headers) {
      this.statusCode = code;
      this.headers = headers || {};
    },
    end(chunk) {
      this.body = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk || '');
    },
  };
}

test('internal Steam WebAPI broker forwards through SteamAccess with application-probed route options', async () => {
  const calls = [];
  const handler = createInternalSteamWebApiBrokerHandler({
    token: 'secret-token',
    requestSteam: async (opts, body, timeout) => {
      calls.push({ opts, body: body && body.toString('utf8'), timeout });
      return Buffer.from('{"response":{"ok":true}}');
    },
    jsonRes: (res, code, body) => { res.statusCode = code; res.body = body; },
    logger: { warn() {}, log() {} },
  });
  const res = makeBrokerRes();

  await handler(makeBodyReq('/api/internal/steam/webapi?host=api.steampowered.com&port=443&path=%2FISteamWebAPIUtil%2FGetSupportedAPIList%2Fv1%2F%3Fformat%3Djson', {
    method: 'POST',
    body: 'key=value',
    headers: {
      'x-wallhub-resolver-token': 'secret-token',
      'content-type': 'application/x-www-form-urlencoded',
      'connection': 'close',
      'x-wallhub-target-host': 'evil.example',
    },
  }), res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['X-WallHub-Steam-WebAPI-Broker'], '1');
  assert.equal(res.body.toString('utf8'), '{"response":{"ok":true}}');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].opts.hostname, 'api.steampowered.com');
  assert.equal(calls[0].opts.path, '/ISteamWebAPIUtil/GetSupportedAPIList/v1/?format=json');
  assert.equal(calls[0].opts.method, 'POST');
  assert.equal(calls[0].opts.routeOptions.requireApplicationProbe, true);
  assert.equal(calls[0].opts.routeOptions.backgroundRefresh, false);
  assert.equal(calls[0].opts.headers.connection, undefined);
  assert.equal(calls[0].opts.headers['x-wallhub-target-host'], undefined);
  assert.equal(calls[0].body, 'key=value');
});

test('disabled internal Steam WebAPI broker uses the normal request path without Gateway route options', async () => {
  const gatewayCalls = [];
  const directCalls = [];
  const handler = createInternalSteamWebApiBrokerHandler({
    token: 'secret-token',
    enabled: () => false,
    requestSteam: async (opts) => { gatewayCalls.push(opts); return Buffer.alloc(0); },
    requestDirect: async (opts, body, timeout) => {
      directCalls.push({ opts, body: body && body.toString('utf8'), timeout });
      return Buffer.from('{"response":{"direct":true}}');
    },
    jsonRes: (res, code, body) => { res.statusCode = code; res.body = body; },
    logger: { warn() {}, log() {} },
  });
  const res = makeBrokerRes();

  await handler(makeBodyReq('/api/internal/steam/webapi?host=api.steampowered.com&path=%2Ftest', {
    headers: { 'x-wallhub-resolver-token': 'secret-token' },
  }), res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(gatewayCalls, []);
  assert.equal(directCalls.length, 1);
  assert.equal(directCalls[0].opts.disableSteamAccessGateway, true);
  assert.equal(directCalls[0].opts.routeOptions, undefined);
  assert.equal(res.body.toString('utf8'), '{"response":{"direct":true}}');
});

test('internal Steam WebAPI broker rejects non-Steam targets before forwarding', async () => {
  let called = false;
  const handler = createInternalSteamWebApiBrokerHandler({
    token: 'secret-token',
    requestSteam: async () => { called = true; return Buffer.alloc(0); },
    jsonRes: (res, code, body) => { res.statusCode = code; res.body = body; },
    logger: { warn() {}, log() {} },
  });
  const res = makeBrokerRes();

  await handler(makeReq('/api/internal/steam/webapi?host=example.com&path=%2F', {
    headers: { 'x-wallhub-resolver-token': 'secret-token' },
  }), res);

  assert.equal(res.statusCode, 400);
  assert.equal(called, false);
});
