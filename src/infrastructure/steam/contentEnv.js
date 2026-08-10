'use strict';

const { normalizeSteamCdnRouteStrategy, normalizeSteamHttpProxyUrl } = require('../../config/normalizers');

const PROXY_ENV_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];

function stripProxyEnv(baseEnv = process.env) {
  const env = Object.assign({}, baseEnv);
  for (const key of PROXY_ENV_KEYS) delete env[key];
  return env;
}

function applySteamHttpProxyEnvFromUrl(baseEnv = process.env, rawProxyUrl = '') {
  const env = Object.assign({}, baseEnv);
  const proxyUrl = normalizeSteamHttpProxyUrl(rawProxyUrl || '');
  if (!proxyUrl) return env;
  for (const key of PROXY_ENV_KEYS) env[key] = proxyUrl;
  return env;
}

function mergeNoProxyValue(current, hosts) {
  const parts = String(current || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean);
  const seen = new Set(parts.map(v => v.toLowerCase()));
  for (const host of hosts) {
    const value = String(host || '').trim();
    if (!value || seen.has(value.toLowerCase())) continue;
    parts.push(value);
    seen.add(value.toLowerCase());
  }
  return parts.join(',');
}

function buildSteamContentEnvForStrategy(baseEnv = process.env, options = {}) {
  const strategy = normalizeSteamCdnRouteStrategy(options.strategy);
  if (strategy === 'proxy') {
    const env = applySteamHttpProxyEnvFromUrl(baseEnv, options.proxyUrl || '');
    delete env.WALLHUB_STEAM_CONTENT_DIRECT;
    env.WALLHUB_STEAM_CDN_ROUTE_STRATEGY = 'proxy';
    env.WALLHUB_STEAM_CONTENT_CDN_MODE = 'proxy';
    return env;
  }
  const env = stripProxyEnv(baseEnv);
  delete env.WALLHUB_STEAM_CONTENT_DIRECT;
  env.WALLHUB_STEAM_CDN_ROUTE_STRATEGY = 'nearest';
  env.WALLHUB_STEAM_CONTENT_CDN_MODE = 'nearest';
  return env;
}

function buildSteamContentDirectEnv(baseEnv = process.env, strategy = 'nearest') {
  return normalizeSteamCdnRouteStrategy(strategy) === 'proxy'
    ? buildSteamContentEnvForStrategy(baseEnv, { strategy, proxyUrl: '' })
    : buildSteamContentEnvForStrategy(baseEnv, { strategy: 'nearest' });
}

module.exports = {
  PROXY_ENV_KEYS,
  applySteamHttpProxyEnvFromUrl,
  stripProxyEnv,
  mergeNoProxyValue,
  buildSteamContentEnvForStrategy,
  buildSteamContentDirectEnv,
};
