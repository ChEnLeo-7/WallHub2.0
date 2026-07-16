'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildSteamContentEnvForStrategy } = require('./contentEnv');

test('nearest Steam content route keeps proxy environment available', () => {
  const env = buildSteamContentEnvForStrategy({
    HTTPS_PROXY: 'http://127.0.0.1:7890',
    http_proxy: 'http://127.0.0.1:7890',
  }, { strategy: 'nearest' });

  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7890');
  assert.equal(env.http_proxy, 'http://127.0.0.1:7890');
  assert.equal(env.WALLHUB_STEAM_CONTENT_DIRECT, undefined);
  assert.equal(env.WALLHUB_STEAM_CONTENT_CDN_MODE, 'nearest');
  assert.equal(env.WALLHUB_STEAM_CDN_ROUTE_STRATEGY, 'nearest');
});

test('legacy direct Steam content route now uses default route and keeps proxy environment', () => {
  const env = buildSteamContentEnvForStrategy({
    HTTPS_PROXY: 'http://127.0.0.1:7890',
    http_proxy: 'http://127.0.0.1:7890',
  }, { strategy: 'direct' });

  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:7890');
  assert.equal(env.http_proxy, 'http://127.0.0.1:7890');
  assert.equal(env.WALLHUB_STEAM_CONTENT_DIRECT, undefined);
  assert.equal(env.DOTNET_SYSTEM_NET_HTTP_USEPROXY, undefined);
  assert.equal(env.WALLHUB_STEAM_CONTENT_CDN_MODE, 'nearest');
  assert.equal(env.WALLHUB_STEAM_CDN_ROUTE_STRATEGY, 'nearest');
});

test('custom Steam content proxy overrides proxy environment', () => {
  const env = buildSteamContentEnvForStrategy({
    HTTPS_PROXY: 'http://127.0.0.1:7890',
  }, {
    strategy: 'proxy',
    proxyUrl: 'http://127.0.0.1:8080',
  });

  assert.equal(env.HTTPS_PROXY, 'http://127.0.0.1:8080/');
  assert.equal(env.HTTP_PROXY, 'http://127.0.0.1:8080/');
  assert.equal(env.WALLHUB_STEAM_CONTENT_DIRECT, undefined);
  assert.equal(env.WALLHUB_STEAM_CONTENT_CDN_MODE, 'proxy');
});

test('custom Steam content proxy preserves SteamKit no-proxy hosts', () => {
  const env = buildSteamContentEnvForStrategy({
    NO_PROXY: 'localhost',
  }, {
    strategy: 'proxy',
    proxyUrl: 'http://127.0.0.1:8080',
  });

  assert.match(env.NO_PROXY, /(?:^|,)localhost(?:,|$)/);
  assert.match(env.NO_PROXY, /(?:^|,)steamserver\.net(?:,|$)/);
  assert.match(env.NO_PROXY, /(?:^|,)\.steamserver\.net(?:,|$)/);
  assert.equal(env.no_proxy, env.NO_PROXY);
});
