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
});

test('gateway control-plane cache route prefers recent real WebAPI request success', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-gateway-'));
  const gateway = createSteamAccessGateway({
    configDir: dir,
    logger: { warn() {}, log() {} },
    enabled: () => true,
    directWebApi: () => true,
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
});
