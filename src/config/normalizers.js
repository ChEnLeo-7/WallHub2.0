'use strict';

const { URL } = require('url');
const { isAndroidHostLikeEnv, isTermuxLikeEnv } = require('./platform');

const DEFAULT_STEAM_ACCESS_DOH_ENDPOINT = 'https://1.12.12.12/resolve';
const DEFAULT_STEAM_ACCESS_DOT_ENDPOINT = 'dot.pub:853';
const DEFAULT_STEAM_ACCESS_SELECTED_DOH_ENDPOINTS = [
  'https://1.12.12.12/resolve',
  'https://doh.pub/resolve',
  'https://dns.alidns.com/resolve',
];
const DEFAULT_STEAM_ACCESS_SELECTED_DOT_ENDPOINTS = [
  'dot.pub:853',
  'dns.umbrella.com:853',
  '1.1.1.1:853',
];
const STEAM_ACCESS_DOH_ENDPOINTS = [
  'https://1.12.12.12/resolve',
  'https://doh.pub/resolve',
  'https://dns.alidns.com/resolve',
  'https://doh.360.cn/dns-query',
  'https://v.recipes/dns/dns.google/dns-query',
];
const STEAM_ACCESS_DOT_ENDPOINTS = [
  '1dot1dot1dot1.cloudflare-dns.com:853',
  'dot.pub:853',
  'dns.alidns.com:853',
  'dns.adguard.com:853',
  'dns.umbrella.com:853',
  'dns.google:853',
  'dns.quad9.net:853',
  '1.1.1.1:853',
];
const STEAM_ACCESS_MODES = new Set(['resolver', 'hosts']);
const STEAM_ACCESS_RESOLVER_PROTOCOLS = new Set(['doh', 'dot']);
const STEAM_ACCESS_RESOLVER_MODES = new Set(['fastest', 'fixed']);
const STEAM_ACCESS_SELECTED_ENDPOINT_LIMIT = 64;
const STEAM_ACCESS_CUSTOM_ENDPOINT_LIMIT = 32;

function normalizeMaxConcurrentDownloads(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return 1;
  return Math.max(1, Math.min(4, parsed));
}

function normalizeSteamCdnRouteStrategy(value) {
  const strategy = String(value || '').trim().toLowerCase();
  return strategy === 'proxy' ? 'proxy' : 'nearest';
}

function normalizeProxyInput(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  return raw
    .replace(/^socks5h\s*\/\s*socks5:\/\//i, 'socks5h://')
    .replace(/^socks5\s*\/\s*socks5h:\/\//i, 'socks5h://')
    .replace(/^socks5\s*\/\s*socks5:\/\//i, 'socks5://')
    .replace(/^socks5h\s*\/\s*/i, 'socks5h://')
    .replace(/^socks5\s*\/\s*/i, 'socks5://');
}

function normalizeSteamHttpProxyUrl(value) {
  const raw = normalizeProxyInput(value);
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Steam HTTP 代理地址格式无效，请使用 http://host:port 或 socks5://host:port');
  }
  const protocol = String(parsed.protocol || '').toLowerCase();
  if (!['http:', 'https:', 'socks4:', 'socks4a:', 'socks5:', 'socks5h:'].includes(protocol)) {
    throw new Error('Steam HTTP 代理仅支持 http、https、socks4、socks5');
  }
  if (!parsed.hostname) throw new Error('Steam HTTP 代理地址缺少主机名');
  return parsed.toString();
}

function normalizeSteamKitMaxDownloads(value) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(1, Math.min(32, parsed));
}

function normalizeDepotStreamCacheMaxMb(value) {
  const parsed = parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 512;
  return Math.max(64, Math.min(65536, parsed));
}

function normalizeSteamAccessDohEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_STEAM_ACCESS_DOH_ENDPOINT;
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('DoH resolver URL is invalid');
  }
  if (String(parsed.protocol || '').toLowerCase() !== 'https:') {
    throw new Error('DoH resolver must use https://');
  }
  if (!parsed.hostname) throw new Error('DoH resolver URL is missing host');
  return parsed.toString();
}

function normalizeSteamAccessDotEndpoint(value) {
  const raw = String(value || '').trim();
  if (!raw) return DEFAULT_STEAM_ACCESS_DOT_ENDPOINT;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) throw new Error('DoT resolver must use host:port');
  if (/[/?#\\]/.test(raw)) throw new Error('DoT resolver must use host:port');
  const lastColon = raw.lastIndexOf(':');
  const hasPort = lastColon > 0 && /^\d+$/.test(raw.slice(lastColon + 1));
  const host = (hasPort ? raw.slice(0, lastColon) : raw).trim().toLowerCase();
  const port = hasPort ? parseInt(raw.slice(lastColon + 1), 10) : 853;
  if (!host || /[:\s]/.test(host)) throw new Error('DoT resolver host is invalid');
  if (!Number.isFinite(port) || port < 1 || port > 65535) throw new Error('DoT resolver port is invalid');
  return `${host}:${port}`;
}

function normalizeSteamAccessMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'doh' || mode === 'dot') return 'resolver';
  if (mode === 'smart' || mode === 'enhanced') return 'resolver';
  return STEAM_ACCESS_MODES.has(mode) ? mode : 'resolver';
}

function normalizeSteamAccessResolverProtocol(value) {
  const protocol = String(value || '').trim().toLowerCase();
  return STEAM_ACCESS_RESOLVER_PROTOCOLS.has(protocol) ? protocol : 'doh';
}

function normalizeSteamAccessResolverMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  return STEAM_ACCESS_RESOLVER_MODES.has(mode) ? mode : 'fastest';
}

function normalizeSteamAccessEndpointList(value, protocol = 'doh', options = {}) {
  const list = Array.isArray(value) ? value : [];
  const normalize = normalizeSteamAccessResolverProtocol(protocol) === 'dot'
    ? normalizeSteamAccessDotEndpoint
    : normalizeSteamAccessDohEndpoint;
  const limit = Math.max(0, Math.min(256, Number(options.limit || STEAM_ACCESS_SELECTED_ENDPOINT_LIMIT)));
  const strict = !!options.strict;
  const seen = new Set();
  const normalized = [];
  for (const item of list) {
    try {
      const endpoint = normalize(item);
      if (!endpoint || seen.has(endpoint)) continue;
      seen.add(endpoint);
      normalized.push(endpoint);
      if (normalized.length >= limit) break;
    } catch (e) {
      if (strict) throw e;
    }
  }
  return normalized;
}

function normalizeSteamAccessHostsUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('Hosts URL is invalid');
  }
  const protocol = String(parsed.protocol || '').toLowerCase();
  if (protocol !== 'http:' && protocol !== 'https:') throw new Error('Hosts URL must use http:// or https://');
  if (!parsed.hostname) throw new Error('Hosts URL is missing host');
  if (parsed.username || parsed.password) throw new Error('Hosts URL must not include credentials');
  return parsed.toString();
}

function normalizeSteamAccessHostsUpdateIntervalHours(value) {
  const parsed = Number.parseFloat(String(value || '').trim());
  if (!Number.isFinite(parsed) || parsed <= 0) return 24;
  return Math.max(0.5, Math.min(168, parsed));
}

function normalizeSteamAccessDohMode(value) {
  return normalizeSteamAccessResolverMode(value);
}

function normalizeSteamContentCellId(value) {
  const parsed = parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return Math.max(1, Math.min(2147483647, parsed));
}

function getDefaultSteamKitMaxDownloads() {
  if (process.platform === 'win32') return 24;
  return isTermuxLikeEnv() || isAndroidHostLikeEnv() ? 12 : 16;
}

module.exports = {
  DEFAULT_STEAM_ACCESS_DOH_ENDPOINT,
  DEFAULT_STEAM_ACCESS_DOT_ENDPOINT,
  DEFAULT_STEAM_ACCESS_SELECTED_DOH_ENDPOINTS,
  DEFAULT_STEAM_ACCESS_SELECTED_DOT_ENDPOINTS,
  STEAM_ACCESS_DOH_ENDPOINTS,
  STEAM_ACCESS_DOT_ENDPOINTS,
  STEAM_ACCESS_SELECTED_ENDPOINT_LIMIT,
  STEAM_ACCESS_CUSTOM_ENDPOINT_LIMIT,
  normalizeMaxConcurrentDownloads,
  normalizeSteamCdnRouteStrategy,
  normalizeProxyInput,
  normalizeSteamHttpProxyUrl,
  normalizeSteamKitMaxDownloads,
  normalizeDepotStreamCacheMaxMb,
  normalizeSteamAccessDohEndpoint,
  normalizeSteamAccessDotEndpoint,
  normalizeSteamAccessMode,
  normalizeSteamAccessResolverProtocol,
  normalizeSteamAccessResolverMode,
  normalizeSteamAccessEndpointList,
  normalizeSteamAccessHostsUrl,
  normalizeSteamAccessHostsUpdateIntervalHours,
  normalizeSteamAccessDohMode,
  normalizeSteamContentCellId,
  getDefaultSteamKitMaxDownloads,
};
