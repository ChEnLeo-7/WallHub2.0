'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSteamAccessConnectionPool, routeKey } = require('./connectionPool');

test('connection pool uses bounded HTTP/1.1 keep-alive agents', () => {
  const pool = createSteamAccessConnectionPool({ logger: { warn() {}, network() {} } });
  const route = { hostname: 'api.steampowered.com', ip: '1.2.3.4', port: 443 };
  const agent = pool.getAgent(route, '1.2.3.4', { type: 'hidden', mode: 'hidden' });

  assert.equal(agent.keepAlive, true);
  assert.equal(agent.maxSockets, 1);
  assert.equal(agent.maxFreeSockets, 1);
});

test('connection pool key includes host, ip, family, sni and protocol', () => {
  const key = routeKey({ hostname: 'steamcommunity.com' }, '2606:4700::1', { type: 'hidden' }, 'h2');

  assert.equal(key, 'steamcommunity.com|2606:4700::1|6|hidden|h2');
});
