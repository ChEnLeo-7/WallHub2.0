'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { DEFAULT_CACHE_SETTINGS } = require('../settings/schema');
const {
  normalizeOnboardingNetworkSettings,
  createOnboardingSteamAccessGateway,
} = require('./networkSettings');

test('onboarding network settings normalize resolver fields and ignore unrelated input', () => {
  const settings = normalizeOnboardingNetworkSettings(DEFAULT_CACHE_SETTINGS, {
    wallhubSteamAccessMode: 'resolver',
    wallhubSteamAccessResolverProtocol: 'dot',
    wallhubSteamAccessCustomDotEndpoints: ['dns.example.com'],
    wallhubSteamAccessSelectedDotEndpoints: ['dns.example.com'],
    wallhubSteamAccessDotEndpoint: 'dns.example.com',
    wallhubOnboardingCompletedAt: 999,
    steamApiKey: 'must-not-pass',
  }, { logger: { warn() {} } });

  assert.equal(settings.wallhubSteamAccessMode, 'resolver');
  assert.equal(settings.wallhubSteamAccessResolverProtocol, 'dot');
  assert.deepEqual(settings.wallhubSteamAccessCustomDotEndpoints, ['dns.example.com:853']);
  assert.deepEqual(settings.wallhubSteamAccessSelectedDotEndpoints, ['dns.example.com:853']);
  assert.equal(Object.hasOwn(settings, 'wallhubOnboardingCompletedAt'), false);
  assert.equal(Object.hasOwn(settings, 'steamApiKey'), false);
});

test('onboarding Hosts mode requires at least one valid mapping', () => {
  assert.throws(
    () => normalizeOnboardingNetworkSettings(DEFAULT_CACHE_SETTINGS, {
      wallhubSteamAccessMode: 'hosts',
      wallhubSteamAccessHosts: 'not-an-ip steamcommunity.com',
    }, { logger: { warn() {} } }),
    error => error.code === 'ONBOARDING_HOSTS_REQUIRED'
  );

  const settings = normalizeOnboardingNetworkSettings(DEFAULT_CACHE_SETTINGS, {
    wallhubSteamAccessMode: 'hosts',
    wallhubSteamAccessHosts: '1.2.3.4 steamcommunity.com',
  }, { logger: { warn() {} } });
  assert.equal(settings.wallhubSteamAccessHosts, '1.2.3.4 steamcommunity.com');
});

test('onboarding gateway keeps its IP pool in memory', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-onboarding-gateway-'));
  const gateway = createOnboardingSteamAccessGateway({
    ...DEFAULT_CACHE_SETTINGS,
    wallhubSteamAccessMode: 'hosts',
    wallhubSteamAccessHosts: '1.2.3.4 steamcommunity.com',
  }, {
    configDir: root,
    logger: { log() {}, warn() {}, network() {} },
    isGatewayHost: () => true,
    isStaticCdnHost: () => false,
  });

  gateway.ipPool.mergeHostIps('steamcommunity.com', ['1.2.3.4'], 'hosts');
  gateway.ipPool.saveNow();
  gateway.clear();
  assert.equal(fs.existsSync(path.join(root, 'steam-access-ip-pool.json')), false);
  fs.rmSync(root, { recursive: true, force: true });
});
