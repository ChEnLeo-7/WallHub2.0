'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntimeSettings } = require('./runtimeSettings');
const { buildSteamContentEnvForStrategy } = require('../../infrastructure/steam/contentEnv');

function createSettings(overrides = {}, env = {}) {
  const state = Object.assign({
    wallhubSteamAccessEnhance: true,
    steamCdnRouteStrategy: 'nearest',
    steamHttpProxyUrl: '',
    wallhubSteamAccessExperimental: {},
  }, overrides);
  return createRuntimeSettings({
    cacheSettingsStore: { state, load: () => state, save() {}, snapshot: () => state, setState() {}, applyPatch: () => ({ settings: state }) },
    getSettings: () => state,
    env,
    normalizeMaxConcurrentDownloads: value => Number(value || 1),
    normalizeDepotStreamCacheMaxMb: value => Number(value || 512),
    normalizeSteamContentCellId: value => String(value || ''),
    normalizeSteamKitMaxDownloads: value => Number(value || 0),
    normalizeSteamCdnRouteStrategy: value => value === 'proxy' ? value : 'nearest',
    getDefaultSteamKitMaxDownloads: () => 1,
    applySteamHttpProxyEnvFromUrl: baseEnv => Object.assign({}, baseEnv),
    buildSteamContentEnvForStrategy,
    applyDownloadDir() {},
    getCurrentDownloadDir: () => '',
  });
}

test('Steam access enhancement does not force DepotDownloader Steam3 websocket', () => {
  const runtimeSettings = createSettings();
  const env = runtimeSettings.buildSteamContentEnv({ HTTPS_PROXY: 'http://127.0.0.1:7890' });

  assert.equal(env.WALLHUB_DEPOT_STEAM3_PROTOCOL, undefined);
  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7890');
});

test('explicit Steam3 protocol environment is still honored', () => {
  const runtimeSettings = createSettings({}, { WALLHUB_DEPOT_STEAM3_PROTOCOL: 'websocket' });
  const env = runtimeSettings.buildSteamContentEnv({});

  assert.equal(env.WALLHUB_DEPOT_STEAM3_PROTOCOL, 'websocket');
});

test('SteamKit child environment no longer exports Depot CM DoH resolver settings', () => {
  const runtimeSettings = createSettings({
    wallhubSteamAccessEnhance: true,
    wallhubSteamAccessResolverProtocol: 'doh',
    wallhubSteamAccessDohMode: 'fastest',
    wallhubSteamAccessDohEndpoint: 'https://cloudflare-dns.com/resolve',
    wallhubSteamAccessSelectedDohEndpoints: ['https://dns.alidns.com/resolve'],
    wallhubSteamAccessCustomDohEndpoints: ['https://example.com/dns-query'],
  });

  const env = runtimeSettings.buildSteamContentEnv({});

  assert.equal(env.WALLHUB_DEPOT_CM_RESOLVER, undefined);
  assert.equal(env.WALLHUB_DEPOT_DOH_CM, undefined);
  assert.equal(env.WALLHUB_DEPOT_RESOLVER_PROTOCOL, undefined);
  assert.equal(env.WALLHUB_DEPOT_RESOLVER_MODE, undefined);
  assert.equal(env.WALLHUB_DEPOT_DOH_ENDPOINTS, undefined);
});

test('SteamKit child environment includes internal WallHub resolver bridge when configured', () => {
  const runtimeSettings = createSettings(
    { wallhubSteamAccessEnhance: true },
    {
      WALLHUB_DEPOT_RESOLVER_URL: 'http://127.0.0.1:3090/api/internal/steam/resolve',
      WALLHUB_DEPOT_RESOLVER_TOKEN: 'token-123',
      WALLHUB_DEPOT_WEBAPI_BROKER_URL: 'http://127.0.0.1:3090/api/internal/steam/webapi',
      WALLHUB_DEPOT_WEBAPI_BROKER_TOKEN: 'token-123',
    }
  );

  const env = runtimeSettings.buildSteamContentEnv({});

  assert.equal(env.WALLHUB_DEPOT_RESOLVER_URL, 'http://127.0.0.1:3090/api/internal/steam/resolve');
  assert.equal(env.WALLHUB_DEPOT_RESOLVER_TOKEN, 'token-123');
  assert.equal(env.WALLHUB_DEPOT_WEBAPI_BROKER_URL, 'http://127.0.0.1:3090/api/internal/steam/webapi');
  assert.equal(env.WALLHUB_DEPOT_WEBAPI_BROKER_TOKEN, 'token-123');
});

test('SteamKit child environment no longer exports DoT resolver settings', () => {
  const runtimeSettings = createSettings({
    wallhubSteamAccessEnhance: true,
    wallhubSteamAccessResolverProtocol: 'dot',
    wallhubSteamAccessDotMode: 'fixed',
    wallhubSteamAccessDotEndpoint: 'dot.pub:853',
    wallhubSteamAccessSelectedDotEndpoints: ['dns.alidns.com:853'],
    wallhubSteamAccessCustomDotEndpoints: ['1.1.1.1:853'],
  });

  const env = runtimeSettings.buildSteamContentEnv({});

  assert.equal(env.WALLHUB_DEPOT_CM_RESOLVER, undefined);
  assert.equal(env.WALLHUB_DEPOT_RESOLVER_PROTOCOL, undefined);
  assert.equal(env.WALLHUB_DEPOT_RESOLVER_MODE, undefined);
  assert.equal(env.WALLHUB_DEPOT_DOT_ENDPOINTS, undefined);
});

test('SteamKit child environment leaves Depot CM resolver untouched when SteamAccess is off', () => {
  const runtimeSettings = createSettings({ wallhubSteamAccessEnhance: false });
  const env = runtimeSettings.buildSteamContentEnv({});

  assert.equal(env.WALLHUB_DEPOT_CM_RESOLVER, undefined);
  assert.equal(env.WALLHUB_DEPOT_DOH_CM, undefined);
});


test('legacy CDN proxy URL migrates into active Steam CDN proxy input', () => {
  const { normalizeLoadedCacheSettings } = require('./schema');
  const settings = normalizeLoadedCacheSettings({
    steamContentCdnMode: 'proxy',
    downloadProxyMode: 'manual',
    steamHttpProxyUrl: 'http://127.0.0.1:7890',
  });

  assert.equal(settings.steamCdnRouteStrategy, 'proxy');
  assert.equal(settings.steamHttpProxyUrl, 'http://127.0.0.1:7890/');
  assert.equal(settings.steamContentCdnMode, undefined);
  assert.equal(settings.downloadProxyMode, undefined);
});
