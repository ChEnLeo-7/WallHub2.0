'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSteamAccessGateway } = require('./gateway');

test('gateway.shouldUse follows policy, proxy and direct WebAPI rules', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-gateway-'));
  const gateway = createSteamAccessGateway({
    configDir: dir,
    logger: { warn() {}, log() {} },
    enabled: () => true,
    directWebApi: () => true,
    isGatewayHost: host => String(host || '').endsWith('steamcommunity.com') || host === 'api.steampowered.com',
  });

  assert.equal(gateway.shouldUse({ protocol: 'https:', hostname: 'steamcommunity.com' }, null), true);
  assert.equal(gateway.shouldUse({ protocol: 'https:', hostname: 'steamcommunity.com' }, { hostname: '127.0.0.1' }), false);
  assert.equal(gateway.shouldUse({ protocol: 'http:', hostname: 'steamcommunity.com' }, null), false);
  assert.equal(gateway.shouldUse({ protocol: 'https:', hostname: 'api.steampowered.com' }, null), false);
  assert.equal(typeof gateway.logger.warn, 'function');
  assert.deepEqual(Object.keys(gateway).sort(), [
    'cdnIpDatabase',
    'chooseRoute',
    'clear',
    'diagnosticSnapshot',
    'ensureReady',
    'getDohEndpoint',
    'getDohMode',
    'getDotEndpoint',
    'getDotMode',
    'getResolverProtocol',
    'getSelectedDohEndpoints',
    'getSelectedDotEndpoints',
    'ipPool',
    'isWarmingUp',
    'logResolvedRoutes',
    'logger',
    'policyForHost',
    'removeCachedIp',
    'request',
    'requestStream',
    'resolveHost',
    'routeStore',
    'runtimeSnapshot',
    'shouldUse',
    'statusSnapshot',
    'warmup',
    'warmupCdnBackground',
    'warmupControlPlane',
    'warmupCore',
  ].sort());
});

test('disabled gateway refuses explicit route construction', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-gateway-'));
  const logs = [];
  const gateway = createSteamAccessGateway({
    configDir: dir,
    logger: { warn(message) { logs.push(message); }, log(message) { logs.push(message); } },
    enabled: () => false,
    directWebApi: () => false,
    isGatewayHost: () => true,
  });

  const route = await gateway.chooseRoute('api.steampowered.com', 443, { forceRefresh: true });
  const ready = await gateway.ensureReady('disabled-test', 1000);

  assert.equal(route, null);
  assert.equal(ready.ready, false);
  assert.equal(ready.disabled, true);
  assert.equal(gateway.runtimeSnapshot().current, null);
  assert.equal(logs.some(line => /probe |DoT|DoH/i.test(String(line))), false);
});

test('gateway control-plane cache route prefers recent real WebAPI request success', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-gateway-'));
  const gateway = createSteamAccessGateway({
    configDir: dir,
    logger: { warn() {}, log() {} },
    enabled: () => true,
    directWebApi: () => false,
    isGatewayHost: host => host === 'api.steampowered.com',
  });

  gateway.routeStore.mergeResolved('api.steampowered.com', ['184.87.199.210', '23.36.106.129'], 'resolver');
  for (let i = 0; i < 8; i++) {
    gateway.routeStore.feedbackSuccess('api.steampowered.com', '184.87.199.210', { rttMs: 80, probeLevel: 'application' });
  }
  gateway.routeStore.feedbackSuccess('api.steampowered.com', '23.36.106.129', {
    rttMs: 453,
    elapsedMs: 453,
    probeLevel: 'application',
    actualRequest: true,
    requestOk: true,
  });

  const route = await gateway.chooseRoute('api.steampowered.com', 443, {
    cacheOnly: true,
    requireApplicationProbe: true,
    backgroundRefresh: false,
  });

  assert.equal(route.ips[0], '23.36.106.129');
  assert.equal(route.source, 'ip-pool-application-cache');

  const updates = [];
  const ready = await gateway.ensureReady('test', 1000, {
    onProgress: update => updates.push(update),
  });
  assert.equal(ready.cached, true);
  assert.equal(ready.completed, 1);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].completed, 1);
  assert.equal(updates[0].total, 3);
});

test('gateway hosts route stays visible in snapshots and clear removes it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-gateway-'));
  const gateway = createSteamAccessGateway({
    configDir: dir,
    logger: { warn() {}, log() {} },
    enabled: () => true,
    isGatewayHost: host => host === 'steamcommunity.com',
    getAccessMode: () => 'hosts',
    getHostsText: () => '203.0.113.10 steamcommunity.com',
  });

  const route = await gateway.chooseRoute('SteamCommunity.com', 443);
  assert.equal(route.hostname, 'steamcommunity.com');
  assert.equal(route.ip, '203.0.113.10');
  assert.equal(route.resolverProtocol, 'hosts');

  const runtime = gateway.runtimeSnapshot();
  assert.equal(runtime.hosts.entries, 1);
  assert.equal(runtime.current.ip, '203.0.113.10');
  assert.equal(gateway.statusSnapshot().routes.length, 1);

  gateway.clear();
  assert.equal(gateway.runtimeSnapshot().current, null);
  assert.deepEqual(gateway.statusSnapshot().routes, []);
});
