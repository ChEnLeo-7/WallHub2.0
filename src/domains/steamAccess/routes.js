'use strict';

const net = require('net');

const DEFAULT_WARMUP_HOSTS = [
  'steamcommunity.com',
  'api.steampowered.com',
  'community.steam-api.com',
];

const DEFAULT_CDN_WARMUP_HOSTS = [
  'images.steamusercontent.com',
  'shared.akamai.steamstatic.com',
];

const WEBAPI_BUSINESS_PROBE_PATH = '/ISteamWebAPIUtil/GetSupportedAPIList/v1/?format=json';

const STEAM_ACCESS_EDGE_ALIAS_BY_PROFILE = {
  community: 'steamcommunity-a.akamaihd.net.edgesuite.net',
  store: 'steamstore-a.akamaihd.net.edgesuite.net',
  userimages: 'steamuserimages-a.akamaihd.net.edgesuite.net',
};

const STEAM_ACCESS_EDGE_ALIASES_BY_HOST = {
  'api.steampowered.com': [
    'api.steampowered.com.edgekey.net',
    'api.steampowered.com.edgesuite.net',
  ],
  'community.steam-api.com': [
    'community.steam-api.com.edgekey.net',
    'community.steam-api.com.edgesuite.net',
  ],
};

const STEAM_ACCESS_CORE_HOSTS = new Set([
  'steamcommunity.com',
  'api.steampowered.com',
  'community.steam-api.com',
]);

const STEAM_ACCESS_CORE_AKAMAI_IP_POOL = {
  'steamcommunity.com': [
    '23.44.248.222',
    '23.44.248.223',
    '23.52.74.146',
    '23.52.74.163',
    '104.90.128.70',
    '184.25.56.178',
  ],
  'api.steampowered.com': [
    '173.222.146.99',
    '184.85.112.102',
    '23.45.12.51',
    '23.45.12.60',
    '96.6.190.4',
    '96.7.49.34',
    '23.45.51.170',
    '23.45.51.146',
    '104.109.129.56',
    '104.109.129.24',
    '23.45.12.70',
  ],
  'community.steam-api.com': [
    '173.222.146.99',
    '184.85.112.102',
    '23.45.12.51',
    '23.45.12.60',
    '96.6.190.4',
    '96.7.49.34',
    '23.45.51.170',
    '23.45.51.146',
    '104.109.129.56',
    '104.109.129.24',
    '23.45.12.70',
  ],
};

const STEAM_ACCESS_PROFILE_BUILTIN_IP_POOL = {
  community: STEAM_ACCESS_CORE_AKAMAI_IP_POOL['steamcommunity.com'],
  webapi: STEAM_ACCESS_CORE_AKAMAI_IP_POOL['api.steampowered.com'],
  store: [
    '23.204.80.234',
    '23.204.80.232',
    '23.216.153.95',
    '23.216.153.91',
    '23.52.168.15',
    '23.52.168.27',
    '95.100.158.19',
    '95.100.158.16',
  ],
  userimages: [
    '23.46.23.34',
    '23.46.23.53',
    '23.46.23.94',
    '23.46.23.42',
  ],
  'static-cdn': [
    '23.202.34.96',
    '23.202.34.91',
    '23.202.35.251',
    '23.202.35.40',
    '23.212.62.73',
    '23.212.62.97',
    '184.26.91.162',
    '184.26.91.47',
  ],
};

const STEAM_ACCESS_IPV6_CDN_HOSTS = new Set([
  'images.steamusercontent.com',
  'steamuserimages-a.akamaihd.net',
  'shared.akamai.steamstatic.com',
  'community.fastly.steamstatic.com',
  'store.fastly.steamstatic.com',
  'shared.fastly.steamstatic.com',
  'cdn.cloudflare.steamstatic.com',
]);

const STEAM_ACCESS_IPV6_CDN_SUFFIXES = [
  '.steamusercontent.com',
  '.fastly.steamstatic.com',
  '.cloudflare.steamstatic.com',
];

function isIpLiteral(hostname) {
  return net.isIP(String(hostname || '').trim()) !== 0;
}

function normalizeHost(hostname) {
  return String(hostname || '').trim().toLowerCase();
}

function shouldProbeSteamAccessIpv6(hostname) {
  const host = normalizeHost(hostname);
  if (!host || isIpLiteral(host)) return false;
  if (host === 'api.steampowered.com' || host === 'community.steam-api.com') return true;
  if (host === 'steamcommunity.com' || host.endsWith('.steamcommunity.com')) return true;
  if (host === 'store.steampowered.com' || host === 'checkout.steampowered.com' || host === 'media.steampowered.com') return true;
  if (STEAM_ACCESS_IPV6_CDN_HOSTS.has(host)) return true;
  if (host === 'steamusercontent.com' || host === 'steamstatic.com' || host === 'akamaihd.net') return false;
  if (/^steamuserimages-[a-z0-9-]+\.akamaihd\.net$/i.test(host)) return true;
  if (/^[a-z0-9-]+\.akamai\.steamstatic\.com$/i.test(host)) {
    return host === 'shared.akamai.steamstatic.com' || host.startsWith('shared.');
  }
  return STEAM_ACCESS_IPV6_CDN_SUFFIXES.some(suffix => host.endsWith(suffix));
}

function edgeAliasForHost(hostname) {
  const host = normalizeHost(hostname);
  if (host === 'store.steampowered.com' || host === 'checkout.steampowered.com' || host === 'media.steampowered.com') return STEAM_ACCESS_EDGE_ALIAS_BY_PROFILE.store;
  if (host === 'images.steamusercontent.com' || host.endsWith('.steamusercontent.com') || host === 'steamuserimages-a.akamaihd.net' || /^steamuserimages-[a-z0-9-]+\.akamaihd\.net$/i.test(host)) return STEAM_ACCESS_EDGE_ALIAS_BY_PROFILE.userimages;
  if (host === 'steamcommunity.com' || host.endsWith('.steamcommunity.com') || host === 'help.steampowered.com' || host === 'login.steampowered.com' || host === 'support.steampowered.com') return STEAM_ACCESS_EDGE_ALIAS_BY_PROFILE.community;
  return '';
}

function edgeAliasesForHost(hostname) {
  const host = normalizeHost(hostname);
  const aliases = STEAM_ACCESS_EDGE_ALIASES_BY_HOST[host];
  if (Array.isArray(aliases) && aliases.length) return aliases.slice();
  const alias = edgeAliasForHost(host);
  return alias ? [alias] : [];
}

function hostProfile(hostname, isStaticCdnHost = () => false) {
  const host = normalizeHost(hostname);
  if (host === 'api.steampowered.com' || host === 'community.steam-api.com') return 'webapi';
  if (host === 'store.steampowered.com' || host === 'checkout.steampowered.com' || host === 'media.steampowered.com') return 'store';
  if (host === 'images.steamusercontent.com' || host.endsWith('.steamusercontent.com') || host === 'steamuserimages-a.akamaihd.net' || /^steamuserimages-[a-z0-9-]+\.akamaihd\.net$/i.test(host)) return 'userimages';
  if (host === 'steamcommunity.com' || host.endsWith('.steamcommunity.com') || host === 'help.steampowered.com' || host === 'login.steampowered.com' || host === 'support.steampowered.com') return 'community-html';
  if (isStaticCdnHost(host) || shouldProbeSteamAccessIpv6(host)) return 'static-cdn';
  return 'generic';
}

function isCoreHost(hostname) {
  return STEAM_ACCESS_CORE_HOSTS.has(normalizeHost(hostname));
}

function fixedSniForHost(hostname) {
  const host = normalizeHost(hostname);
  return { mode: 'hidden', hostname: '' };
}

function servernameForSni(sni, hostname) {
  if (!sni || sni.mode === 'hidden') return '';
  if (sni.mode === 'custom') return sni.hostname || '';
  return String(hostname || '');
}

function sniCachePart(sni) {
  if (!sni || sni.mode === 'hidden') return 'hidden';
  if (sni.mode === 'custom') return `custom:${sni.hostname || ''}`;
  return 'original';
}

function builtinIpsForHost(hostname, isStaticCdnHost = () => false) {
  const host = normalizeHost(hostname);
  if (STEAM_ACCESS_CORE_AKAMAI_IP_POOL[host]) return STEAM_ACCESS_CORE_AKAMAI_IP_POOL[host].slice();
  const profile = hostProfile(host, isStaticCdnHost);
  return (STEAM_ACCESS_PROFILE_BUILTIN_IP_POOL[profile] || []).slice();
}

function requestBudgetForHost(hostname, isStaticCdnHost = () => false) {
  const profile = hostProfile(hostname, isStaticCdnHost);
  if (profile === 'webapi') return {
    perIpTimeoutMs: 8000,
    totalTimeoutMs: 20000,
    maxIps: 4,
    batchSize: 2,
    minPoolSize: 10,
    refreshIntervalMs: 10 * 60 * 1000,
    staleAfterMs: 30 * 60 * 1000,
  };
  if (profile === 'community-html') return { perIpTimeoutMs: 4000, totalTimeoutMs: 10000, maxIps: 4, batchSize: 2, minPoolSize: 8 };
  if (profile === 'static-cdn') return { perIpTimeoutMs: 5000, totalTimeoutMs: 8000, maxIps: 2, batchSize: 1 };
  return { perIpTimeoutMs: 5000, totalTimeoutMs: 10000, maxIps: 2, batchSize: 1 };
}

function shouldHttpProbeHost(hostname, isStaticCdnHost = () => false) {
  const profile = hostProfile(hostname, isStaticCdnHost);
  return profile === 'community-html' || profile === 'webapi' || profile === 'store';
}

function httpProbePath(hostname, isStaticCdnHost = () => false) {
  const profile = hostProfile(hostname, isStaticCdnHost);
  if (profile === 'webapi') return WEBAPI_BUSINESS_PROBE_PATH;
  if (profile === 'store') return '/app/431960';
  if (profile === 'userimages') return '/ugc/1/';
  if (profile === 'static-cdn') return '/';
  return '/workshop/browse/?appid=431960&numperpage=1';
}

module.exports = {
  DEFAULT_WARMUP_HOSTS,
  DEFAULT_CDN_WARMUP_HOSTS,
  WEBAPI_BUSINESS_PROBE_PATH,
  STEAM_ACCESS_EDGE_ALIAS_BY_PROFILE,
  STEAM_ACCESS_EDGE_ALIASES_BY_HOST,
  STEAM_ACCESS_CORE_HOSTS,
  STEAM_ACCESS_CORE_AKAMAI_IP_POOL,
  STEAM_ACCESS_PROFILE_BUILTIN_IP_POOL,
  fixedSniForHost,
  servernameForSni,
  sniCachePart,
  isIpLiteral,
  shouldProbeSteamAccessIpv6,
  edgeAliasForHost,
  edgeAliasesForHost,
  hostProfile,
  isCoreHost,
  builtinIpsForHost,
  requestBudgetForHost,
  shouldHttpProbeHost,
  httpProbePath,
};
