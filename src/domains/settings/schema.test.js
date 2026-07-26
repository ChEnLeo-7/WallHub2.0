'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLoadedCacheSettings, applyCacheSettingsPatch } = require('./schema');

test('loaded settings migrate stale current DoH endpoint to selected endpoint', () => {
  const settings = normalizeLoadedCacheSettings({
    wallhubSteamAccessDohEndpoint: 'https://cloudflare-dns.com/resolve',
    wallhubSteamAccessSelectedDohEndpoints: ['https://dns.alidns.com/resolve'],
  }, { logger: { warn() {} } });

  assert.equal(settings.wallhubSteamAccessDohEndpoint, 'https://dns.alidns.com/resolve');
  assert.deepEqual(settings.wallhubSteamAccessSelectedDohEndpoints, ['https://dns.alidns.com/resolve']);
});

test('experimental settings keep verbose network logs flag', () => {
  const settings = normalizeLoadedCacheSettings({
    wallhubSteamAccessExperimental: { verboseNetworkLogs: true },
  }, { logger: { warn() {} } });

  assert.equal(settings.wallhubSteamAccessExperimental.verboseNetworkLogs, true);
});

test('settings normalize server log level and per static CDN host controls', () => {
  const settings = normalizeLoadedCacheSettings({
    wallhubLogLevel: 'debug',
    wallhubSteamAccessStaticCdnHosts: {
      imagesSteamusercontent: { enhance: true, reuseConnection: false },
      sharedAkamaiSteamstatic: { enhance: false, reuseConnection: true },
    },
  }, { logger: { warn() {} } });

  assert.equal(settings.wallhubLogLevel, 'debug');
  assert.equal(settings.wallhubSteamAccessStaticCdnHosts.imagesSteamusercontent.enhance, true);
  assert.equal(settings.wallhubSteamAccessStaticCdnHosts.imagesSteamusercontent.reuseConnection, false);
  assert.equal(settings.wallhubSteamAccessStaticCdnHosts.sharedAkamaiSteamstatic.enhance, false);
  assert.equal(settings.wallhubSteamAccessStaticCdnHosts.sharedAkamaiSteamstatic.reuseConnection, true);
});

test('settings normalize MPKG texture profile to fast or compact', () => {
  const compact = normalizeLoadedCacheSettings({ mpkgTextureProfile: 'compact' }, { logger: { warn() {} } });
  const invalid = normalizeLoadedCacheSettings({ mpkgTextureProfile: 'smaller-but-unknown' }, { logger: { warn() {} } });

  assert.equal(compact.mpkgTextureProfile, 'compact');
  assert.equal(invalid.mpkgTextureProfile, 'fast');
});

test('legacy remote subscription experiment is removed during settings normalization', () => {
  const settings = normalizeLoadedCacheSettings({ steamRemoteSubscribeEnabled: 'yes' }, { logger: { warn() {} } });

  assert.equal(Object.hasOwn(settings, 'steamRemoteSubscribeEnabled'), false);
});

test('Steam Web API key is retained while removed query-source settings are discarded', () => {
  const loaded = normalizeLoadedCacheSettings({
    steamApiKey: 'old-key',
    useSteamApi: true,
    workshopQueryMode: 'legacy',
    workshopHtmlOrderMode: true,
  }, { logger: { warn() {} } });
  const patched = applyCacheSettingsPatch(loaded, {
    steamApiKey: 'new-key',
    useSteamApi: true,
    workshopQueryMode: 'steamkit-first',
    workshopHtmlOrderMode: true,
  });

  assert.equal(loaded.steamApiKey, 'old-key');
  assert.equal(patched.settings.steamApiKey, 'new-key');
  assert.equal(patched.steamApiKeyChanged, true);
  for (const key of ['useSteamApi', 'workshopQueryMode', 'workshopHtmlOrderMode']) {
    assert.equal(Object.hasOwn(loaded, key), false);
    assert.equal(Object.hasOwn(patched.settings, key), false);
  }
});
