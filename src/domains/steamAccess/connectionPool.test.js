'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSteamAccessConnectionPool,
  routeKey,
  servernameForStrategy,
  originForIp,
} = require('./connectionPool');

test('connection pool uses bounded HTTP/1.1 keep-alive agents', () => {
  const pool = createSteamAccessConnectionPool({ logger: { warn() {}, network() {} } });
  const route = { hostname: 'api.steampowered.com', ip: '1.2.3.4', port: 443 };
  const agent = pool.getAgent(route, '1.2.3.4', { type: 'hidden', mode: 'hidden' });

  assert.equal(agent.keepAlive, true);
  assert.equal(agent.maxSockets, 1);
  assert.equal(agent.maxFreeSockets, 1);
  assert.equal(pool.snapshot().h1Agents, 1);
  pool.clear();
});

test('connection pool key includes host, ip, family, sni and protocol', () => {
  const key = routeKey({ hostname: 'steamcommunity.com' }, '2606:4700::1', { type: 'hidden' }, 'h2');

  assert.equal(key, 'steamcommunity.com|2606:4700::1|6|hidden|h2');
});

test('connection pool preserves its public API and address helpers', () => {
  const pool = createSteamAccessConnectionPool({ logger: { warn() {}, network() {} } });

  assert.deepEqual(Object.keys(pool), [
    'getAgent',
    'getHttp2Session',
    'request',
    'prewarm',
    'markFailure',
    'prioritizeIps',
    'clear',
    'snapshot',
  ]);
  assert.equal(servernameForStrategy({ type: 'hidden' }, 'steamcommunity.com'), '');
  assert.equal(servernameForStrategy({ type: 'fake', hostname: 'example.com' }, 'steamcommunity.com'), 'example.com');
  assert.equal(servernameForStrategy({ type: 'direct' }, 'steamcommunity.com'), 'steamcommunity.com');
  assert.equal(originForIp('1.2.3.4', 8443), 'https://1.2.3.4:8443');
  assert.equal(originForIp('2606:4700::1'), 'https://[2606:4700::1]:443');
  assert.deepEqual(pool.snapshot(), {
    h1Agents: 0,
    h2Sessions: 0,
    enabledProtocols: ['h1'],
    connections: [],
  });
});

test('connection failures update snapshots, notify callers and cool an IP', () => {
  const failures = [];
  const pool = createSteamAccessConnectionPool({
    logger: { warn() {}, network() {} },
    onConnectionFailure: (...args) => failures.push(args),
  });
  const route = { hostname: 'api.steampowered.com', policy: { connectionReuseEnabled: true } };
  const strategy = { type: 'hidden', mode: 'hidden' };
  const ips = ['1.2.3.4', '5.6.7.8'];

  pool.getAgent(route, ips[0], strategy);
  const error = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
  pool.markFailure(route, ips[0], strategy, 'h1', error, { notify: true });

  const snapshot = pool.snapshot();
  assert.equal(snapshot.h1Agents, 0);
  assert.equal(snapshot.connections.length, 1);
  assert.equal(snapshot.connections[0].state, 'dead');
  assert.equal(snapshot.connections[0].lastError, 'reset');
  assert.ok(snapshot.connections[0].lastResetAt > 0);
  assert.ok(snapshot.connections[0].cooldownUntil > Date.now());
  assert.deepEqual(pool.prioritizeIps(route, ips, strategy), ips);
  assert.equal(failures.length, 1);
  assert.equal(failures[0][0], route.hostname);
  assert.equal(failures[0][1], ips[0]);
  assert.equal(failures[0][2], error);
  assert.deepEqual(failures[0][3], { stage: 'reset', protocol: 'h1', sniStrategy: 'hidden' });

  pool.clear();
  assert.deepEqual(pool.snapshot().connections, []);
});
