'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeLoadedCacheSettings } = require('./schema');

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
