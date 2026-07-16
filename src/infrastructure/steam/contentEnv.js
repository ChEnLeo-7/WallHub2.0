'use strict';

const { normalizeSteamCdnRouteStrategy, normalizeSteamHttpProxyUrl } = require('../../config/normalizers');

const PROXY_ENV_KEYS = ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy'];

const STEAM_CONTENT_NO_PROXY_HOSTS = [
  'steamcontent.com',
  '.steamcontent.com',
  'steamserver.net',
  '.steamserver.net',
  'cm.steampowered.com',
  '.cm.steampowered.com',
  'steamstatic.com',
  '.steamstatic.com',
  'steamcdn-a.akamaihd.net',
  'akamaihd.net',
  '.akamaihd.net',
  'cdn.cloudflare.steamstatic.com',
  'fastly.steamstatic.com',
  '.fastly.steamstatic.com',
  'akamai.steamstatic.com',
  '.akamai.steamstatic.com',
  'lancache.steamcontent.com',
];

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
    const noProxy = mergeNoProxyValue(env.NO_PROXY || env.no_proxy || '', STEAM_CONTENT_NO_PROXY_HOSTS);
    env.NO_PROXY = noProxy;
    env.no_proxy = noProxy;
    delete env.WALLHUB_STEAM_CONTENT_DIRECT;
    env.WALLHUB_STEAM_CDN_ROUTE_STRATEGY = 'proxy';
    env.WALLHUB_STEAM_CONTENT_CDN_MODE = 'proxy';
    return env;
  }
  const env = Object.assign({}, baseEnv);
  delete env.WALLHUB_STEAM_CONTENT_DIRECT;
  env.WALLHUB_STEAM_CDN_ROUTE_STRATEGY = 'nearest';
  env.WALLHUB_STEAM_CONTENT_CDN_MODE = 'nearest';
  return env;
}

module.exports = {
  PROXY_ENV_KEYS,
  STEAM_CONTENT_NO_PROXY_HOSTS,
  applySteamHttpProxyEnvFromUrl,
  mergeNoProxyValue,
  buildSteamContentEnvForStrategy,
};
