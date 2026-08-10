'use strict';

const {
  DEFAULT_STEAM_ACCESS_DOH_ENDPOINT,
  DEFAULT_STEAM_ACCESS_DOT_ENDPOINT,
  STEAM_ACCESS_DOH_ENDPOINTS,
  STEAM_ACCESS_DOT_ENDPOINTS,
  STEAM_ACCESS_SELECTED_ENDPOINT_LIMIT,
  STEAM_ACCESS_CUSTOM_ENDPOINT_LIMIT,
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
} = require('../../config/normalizers');
const {
  DEFAULT_CACHE_SETTINGS,
  DEFAULT_STEAM_ACCESS_STATIC_CDN_HOSTS,
} = require('./defaults');
const {
  migrateSteamCdnRouteSettings,
  pruneLegacySteamCdnSettings,
  pruneRemovedSteamAccessSettings,
} = require('./migrations');

const MAX_STEAM_ACCESS_HOSTS_TEXT_BYTES = 2 * 1024 * 1024;
const STEAM_WEBAPI_ROUTES = new Set(['follow', 'direct']);
const STEAM_WEBAPI_PROTOCOLS = new Set(['https', 'http']);
const STEAM_WEBAPI_HOSTS = new Set(['api.steampowered.com', 'community.steam-api.com']);
const WALLHUB_LOG_LEVELS = new Set(['info', 'debug']);
const MPKG_TEXTURE_PROFILES = new Set(['fast', 'compact']);
const STEAM_DATA_SOURCES = new Set(['community', 'webapi', 'cm']);

function normalizeHostsText(value) {
  const text = String(value || '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .trim();
  if (Buffer.byteLength(text, 'utf8') > MAX_STEAM_ACCESS_HOSTS_TEXT_BYTES) {
    throw new Error('hosts 文本过大，请控制在 2MB 以内');
  }
  return text;
}

function parseSteamHostsText(text) {
  const map = new Map();
  const lines = String(text || '').split(/\r?\n/);
  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const body = line.split(/\s+#|\s+;/, 1)[0].trim();
    const parts = body.split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;
    const ip = parts[0];
    const hosts = parts.slice(1).map((host) => String(host || '').trim().toLowerCase()).filter(Boolean);
    if (!hosts.length) continue;
    for (const host of hosts) {
      if (host.includes('/') || host.includes('://') || /\s/.test(host)) continue;
      map.set(host, { ip, host });
    }
  }
  return map;
}

function normalizeTimestamp(value) {
  const parsed = Number(value || 0);
  if (!Number.isFinite(parsed) || parsed < 0) return 0;
  return Math.floor(parsed);
}

function normalizeSteamWebApiRoute(value) {
  const route = String(value || '').trim().toLowerCase();
  return STEAM_WEBAPI_ROUTES.has(route) ? route : 'follow';
}

function normalizeSteamWebApiProtocol(value) {
  const protocol = String(value || '').trim().toLowerCase().replace(/:$/, '');
  return STEAM_WEBAPI_PROTOCOLS.has(protocol) ? protocol : 'https';
}

function normalizeSteamWebApiHost(value) {
  const host = String(value || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  return STEAM_WEBAPI_HOSTS.has(host) ? host : 'api.steampowered.com';
}

function normalizeWallhubLogLevel(value) {
  const level = String(value || '').trim().toLowerCase();
  return WALLHUB_LOG_LEVELS.has(level) ? level : 'info';
}

function normalizeMpkgTextureProfile(value) {
  const profile = String(value || '').trim().toLowerCase();
  return MPKG_TEXTURE_PROFILES.has(profile) ? profile : 'fast';
}

function normalizeSteamDataSource(value) {
  const source = String(value || '').trim().toLowerCase();
  return STEAM_DATA_SOURCES.has(source) ? source : 'community';
}

function normalizeStaticCdnHostControl(value, fallback) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    enhance: Object.prototype.hasOwnProperty.call(raw, 'enhance') ? !!raw.enhance : !!fallback.enhance,
    reuseConnection: Object.prototype.hasOwnProperty.call(raw, 'reuseConnection') ? !!raw.reuseConnection : fallback.reuseConnection !== false,
  };
}

function normalizeSteamAccessStaticCdnHosts(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    imagesSteamusercontent: normalizeStaticCdnHostControl(raw.imagesSteamusercontent, DEFAULT_STEAM_ACCESS_STATIC_CDN_HOSTS.imagesSteamusercontent),
    sharedAkamaiSteamstatic: normalizeStaticCdnHostControl(raw.sharedAkamaiSteamstatic, DEFAULT_STEAM_ACCESS_STATIC_CDN_HOSTS.sharedAkamaiSteamstatic),
  };
}

function anyStaticCdnHostEnhanceEnabled(value) {
  const normalized = normalizeSteamAccessStaticCdnHosts(value);
  return Object.values(normalized).some(item => !!item.enhance);
}

function stableStringify(value) {
  return JSON.stringify(value == null ? null : value);
}

function normalizeSteamAccessExperimental(value) {
  const raw = value && typeof value === 'object' ? value : {};
  return {
    hiddenSniForAll: !!raw.hiddenSniForAll,
    fakeSniFallback: !!raw.fakeSniFallback,
    compressedProxy: !!raw.compressedProxy,
    http2Enabled: !!raw.http2Enabled,
    disableNormalFallback: !!raw.disableNormalFallback,
    verboseNetworkLogs: !!raw.verboseNetworkLogs,
  };
}

function normalizeSteamAccessHostList(value) {
  const list = Array.isArray(value) ? value : String(value || '').split(/[\s,]+/);
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const host = String(item || '').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/^\.+/, '');
    if (!host || seen.has(host) || /[^a-z0-9.-]/i.test(host)) continue;
    seen.add(host);
    out.push(host);
    if (out.length >= 128) break;
  }
  return out;
}

function normalizeListField(next, key, protocol, limit, logger, label) {
  try {
    next[key] = normalizeSteamAccessEndpointList(next[key], protocol, { limit });
  } catch (e) {
    logger?.warn?.(`[Settings] Ignoring invalid ${label}:`, e.message);
    next[key] = [];
  }
}

function normalizeCurrentEndpoint(next, protocol, logger) {
  const key = protocol === 'dot' ? 'wallhubSteamAccessDotEndpoint' : 'wallhubSteamAccessDohEndpoint';
  const normalize = protocol === 'dot' ? normalizeSteamAccessDotEndpoint : normalizeSteamAccessDohEndpoint;
  const fallback = protocol === 'dot' ? DEFAULT_STEAM_ACCESS_DOT_ENDPOINT : DEFAULT_STEAM_ACCESS_DOH_ENDPOINT;
  try {
    next[key] = normalize(next[key]);
  } catch (e) {
    logger?.warn?.(`[Settings] Ignoring invalid Wallhub Steam ${protocol.toUpperCase()} endpoint:`, e.message);
    next[key] = fallback;
  }
  return next[key];
}

function includeEndpoint(list, endpoint) {
  if (endpoint && !list.includes(endpoint)) list.push(endpoint);
}

function migrateCurrentEndpointFromSelection(next, protocol) {
  const selectedKey = protocol === 'dot' ? 'wallhubSteamAccessSelectedDotEndpoints' : 'wallhubSteamAccessSelectedDohEndpoints';
  const endpointKey = protocol === 'dot' ? 'wallhubSteamAccessDotEndpoint' : 'wallhubSteamAccessDohEndpoint';
  const selected = Array.isArray(next[selectedKey]) ? next[selectedKey] : [];
  const current = String(next[endpointKey] || '');
  if (selected.length && current && !selected.includes(current)) next[endpointKey] = selected[0];
}

function normalizeSteamAccessEndpointSettings(next, logger = console, options = {}) {
  const migrateSingleEndpoints = options.migrateSingleEndpoints !== false;
  const dohEndpoint = normalizeCurrentEndpoint(next, 'doh', logger);
  const dotEndpoint = normalizeCurrentEndpoint(next, 'dot', logger);
  normalizeListField(next, 'wallhubSteamAccessCustomDohEndpoints', 'doh', STEAM_ACCESS_CUSTOM_ENDPOINT_LIMIT, logger, 'custom DoH endpoints');
  normalizeListField(next, 'wallhubSteamAccessCustomDotEndpoints', 'dot', STEAM_ACCESS_CUSTOM_ENDPOINT_LIMIT, logger, 'custom DoT endpoints');
  normalizeListField(next, 'wallhubSteamAccessSelectedDohEndpoints', 'doh', STEAM_ACCESS_SELECTED_ENDPOINT_LIMIT, logger, 'selected DoH endpoints');
  normalizeListField(next, 'wallhubSteamAccessSelectedDotEndpoints', 'dot', STEAM_ACCESS_SELECTED_ENDPOINT_LIMIT, logger, 'selected DoT endpoints');

  const builtinDoh = new Set(normalizeSteamAccessEndpointList(STEAM_ACCESS_DOH_ENDPOINTS, 'doh'));
  const builtinDot = new Set(normalizeSteamAccessEndpointList(STEAM_ACCESS_DOT_ENDPOINTS, 'dot'));
  if (migrateSingleEndpoints) {
    if (!builtinDoh.has(dohEndpoint)) includeEndpoint(next.wallhubSteamAccessCustomDohEndpoints, dohEndpoint);
    if (!builtinDot.has(dotEndpoint)) includeEndpoint(next.wallhubSteamAccessCustomDotEndpoints, dotEndpoint);
  }

  const customDoh = new Set(next.wallhubSteamAccessCustomDohEndpoints);
  const customDot = new Set(next.wallhubSteamAccessCustomDotEndpoints);
  next.wallhubSteamAccessSelectedDohEndpoints = next.wallhubSteamAccessSelectedDohEndpoints.filter(endpoint => builtinDoh.has(endpoint) || customDoh.has(endpoint));
  next.wallhubSteamAccessSelectedDotEndpoints = next.wallhubSteamAccessSelectedDotEndpoints.filter(endpoint => builtinDot.has(endpoint) || customDot.has(endpoint));
  migrateCurrentEndpointFromSelection(next, 'doh');
  migrateCurrentEndpointFromSelection(next, 'dot');
}

function normalizeLoadedCacheSettings(settings, options = {}) {
  const logger = options.logger || console;
  const maxConcurrentDownloads = typeof options.getMaxConcurrentDownloads === 'function'
    ? options.getMaxConcurrentDownloads
    : () => settings.maxConcurrentDownloads;
  const rawMode = String(settings && settings.wallhubSteamAccessMode || '').trim().toLowerCase();
  const hadStaticCdnHostControls = !!(settings && Object.prototype.hasOwnProperty.call(settings, 'wallhubSteamAccessStaticCdnHosts'));
  const next = Object.assign({}, DEFAULT_CACHE_SETTINGS, settings || {});
  next.steamApiKey = String(next.steamApiKey || '').trim();
  next.steamDataSource = normalizeSteamDataSource(next.steamDataSource);
  next.wallhubLogLevel = normalizeWallhubLogLevel(next.wallhubLogLevel);
  next.wallhubAutoUpdateEnabled = !!next.wallhubAutoUpdateEnabled;
  next.wallhubOnboardingCompletedAt = normalizeTimestamp(next.wallhubOnboardingCompletedAt);
  next.mpkgTextureProfile = normalizeMpkgTextureProfile(next.mpkgTextureProfile);
  delete next.mpkgMaxConcurrentBuilds;
  next.maxConcurrentDownloads = maxConcurrentDownloads(next);
  migrateSteamCdnRouteSettings(next, logger);
  pruneLegacySteamCdnSettings(next);
  pruneRemovedSteamAccessSettings(next);
  next.steamKitMaxDownloads = normalizeSteamKitMaxDownloads(next.steamKitMaxDownloads);
  next.steamKitDepotStreaming = !!next.steamKitDepotStreaming;
  next.wallhubSteamAccessEnhance = !!next.wallhubSteamAccessEnhance;
  next.wallhubSteamAccessDirectWebApi = !!next.wallhubSteamAccessDirectWebApi;
  next.wallhubSteamWebApiRoute = normalizeSteamWebApiRoute(next.wallhubSteamWebApiRoute || (next.wallhubSteamAccessDirectWebApi ? 'direct' : 'follow'));
  next.wallhubSteamWebApiProtocol = normalizeSteamWebApiProtocol(next.wallhubSteamWebApiProtocol);
  next.wallhubSteamWebApiHost = normalizeSteamWebApiHost(next.wallhubSteamWebApiHost);
  next.wallhubSteamAccessDirectWebApi = next.wallhubSteamWebApiRoute === 'direct';
  if (rawMode === 'doh' || rawMode === 'dot') {
    next.wallhubSteamAccessMode = 'resolver';
    next.wallhubSteamAccessResolverProtocol = rawMode;
  } else {
    next.wallhubSteamAccessMode = normalizeSteamAccessMode(next.wallhubSteamAccessMode || 'resolver');
  }
  next.wallhubSteamAccessResolverProtocol = normalizeSteamAccessResolverProtocol(next.wallhubSteamAccessResolverProtocol);
  next.wallhubSteamAccessHosts = normalizeHostsText(next.wallhubSteamAccessHosts);
  try {
    next.wallhubSteamAccessHostsUrl = normalizeSteamAccessHostsUrl(next.wallhubSteamAccessHostsUrl);
  } catch (e) {
    logger?.warn?.('[Settings] Ignoring Wallhub Steam hosts URL:', e.message);
    next.wallhubSteamAccessHostsUrl = '';
  }
  next.wallhubSteamAccessHostsAutoUpdateEnabled = !!next.wallhubSteamAccessHostsAutoUpdateEnabled;
  next.wallhubSteamAccessHostsUpdateIntervalHours = normalizeSteamAccessHostsUpdateIntervalHours(next.wallhubSteamAccessHostsUpdateIntervalHours);
  next.wallhubSteamAccessHostsLastUpdatedAt = normalizeTimestamp(next.wallhubSteamAccessHostsLastUpdatedAt);
  next.wallhubSteamAccessHostsLastError = String(next.wallhubSteamAccessHostsLastError || '').slice(0, 1000);
  next.wallhubSteamAccessDohMode = normalizeSteamAccessResolverMode(next.wallhubSteamAccessDohMode);
  next.wallhubSteamAccessDotMode = normalizeSteamAccessResolverMode(next.wallhubSteamAccessDotMode);
  next.wallhubSteamAccessExperimental = normalizeSteamAccessExperimental(next.wallhubSteamAccessExperimental);
  next.wallhubSteamAccessHostBlacklist = normalizeSteamAccessHostList(next.wallhubSteamAccessHostBlacklist);
  next.wallhubSteamAccessStaticCdnEnhance = !!next.wallhubSteamAccessStaticCdnEnhance;
  next.wallhubSteamAccessStaticCdnHosts = normalizeSteamAccessStaticCdnHosts(next.wallhubSteamAccessStaticCdnHosts);
  if (next.wallhubSteamAccessStaticCdnEnhance && !hadStaticCdnHostControls) {
    next.wallhubSteamAccessStaticCdnHosts.imagesSteamusercontent.enhance = true;
    next.wallhubSteamAccessStaticCdnHosts.sharedAkamaiSteamstatic.enhance = true;
  }
  next.wallhubSteamAccessStaticCdnEnhance = anyStaticCdnHostEnhanceEnabled(next.wallhubSteamAccessStaticCdnHosts);
  normalizeSteamAccessEndpointSettings(next, logger);
  delete next.wallhubSteamResourceProxy;
  next.depotStreamCacheMaxMb = normalizeDepotStreamCacheMaxMb(next.depotStreamCacheMaxMb);
  return pruneRemovedSteamAccessSettings(next);
}

module.exports = {
  anyStaticCdnHostEnhanceEnabled,
  includeEndpoint,
  normalizeHostsText,
  normalizeLoadedCacheSettings,
  normalizeMpkgTextureProfile,
  normalizeSteamAccessEndpointSettings,
  normalizeSteamAccessExperimental,
  normalizeSteamAccessHostList,
  normalizeSteamAccessStaticCdnHosts,
  normalizeSteamDataSource,
  normalizeSteamWebApiHost,
  normalizeSteamWebApiProtocol,
  normalizeSteamWebApiRoute,
  normalizeTimestamp,
  normalizeWallhubLogLevel,
  parseSteamHostsText,
  stableStringify,
};
