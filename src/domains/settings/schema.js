'use strict';

const {
  DEFAULT_STEAM_ACCESS_DOH_ENDPOINT,
  DEFAULT_STEAM_ACCESS_DOT_ENDPOINT,
  DEFAULT_STEAM_ACCESS_SELECTED_DOH_ENDPOINTS,
  DEFAULT_STEAM_ACCESS_SELECTED_DOT_ENDPOINTS,
  STEAM_ACCESS_DOH_ENDPOINTS,
  STEAM_ACCESS_DOT_ENDPOINTS,
  STEAM_ACCESS_SELECTED_ENDPOINT_LIMIT,
  STEAM_ACCESS_CUSTOM_ENDPOINT_LIMIT,
  normalizeSteamCdnRouteStrategy,
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
} = require('../../config/normalizers');

const MAX_STEAM_ACCESS_HOSTS_TEXT_BYTES = 2 * 1024 * 1024;
const STEAM_WEBAPI_ROUTES = new Set(['follow', 'direct']);
const STEAM_WEBAPI_PROTOCOLS = new Set(['https', 'http']);
const STEAM_WEBAPI_HOSTS = new Set(['api.steampowered.com', 'community.steam-api.com']);
const WALLHUB_LOG_LEVELS = new Set(['info', 'debug']);
const MPKG_TEXTURE_PROFILES = new Set(['fast', 'compact']);
const DEFAULT_STEAM_ACCESS_STATIC_CDN_HOSTS = Object.freeze({
  imagesSteamusercontent: Object.freeze({ enhance: false, reuseConnection: true }),
  sharedAkamaiSteamstatic: Object.freeze({ enhance: false, reuseConnection: true }),
});

const DEFAULT_CACHE_SETTINGS = {
  steamApiKey: '',
  wallhubLogLevel: 'info',
  wallhubAutoUpdateEnabled: false,
  mpkgTextureProfile: 'fast',
  downloadDir: '',
  maxConcurrentDownloads: 1,
  steamCdnRouteStrategy: 'nearest',
  steamHttpProxyUrl: '',
  steamKitMaxDownloads: 0,
  steamKitDepotStreaming: false,
  wallhubSteamAccessEnhance: false,
  wallhubSteamAccessDirectWebApi: false,
  wallhubSteamWebApiRoute: 'follow',
  wallhubSteamWebApiProtocol: 'https',
  wallhubSteamWebApiHost: 'api.steampowered.com',
  wallhubSteamAccessMode: 'resolver',
  wallhubSteamAccessHosts: '',
  wallhubSteamAccessResolverProtocol: 'doh',
  wallhubSteamAccessSelectedDohEndpoints: DEFAULT_STEAM_ACCESS_SELECTED_DOH_ENDPOINTS.slice(),
  wallhubSteamAccessCustomDohEndpoints: [],
  wallhubSteamAccessSelectedDotEndpoints: DEFAULT_STEAM_ACCESS_SELECTED_DOT_ENDPOINTS.slice(),
  wallhubSteamAccessCustomDotEndpoints: [],
  wallhubSteamAccessHostsUrl: '',
  wallhubSteamAccessHostsAutoUpdateEnabled: false,
  wallhubSteamAccessHostsUpdateIntervalHours: 24,
  wallhubSteamAccessHostsLastUpdatedAt: 0,
  wallhubSteamAccessHostsLastError: '',
  wallhubSteamAccessDohEndpoint: DEFAULT_STEAM_ACCESS_DOH_ENDPOINT,
  wallhubSteamAccessDohMode: 'fastest',
  wallhubSteamAccessDotEndpoint: DEFAULT_STEAM_ACCESS_DOT_ENDPOINT,
  wallhubSteamAccessDotMode: 'fastest',
  wallhubSteamAccessExperimental: {
    hiddenSniForAll: false,
    fakeSniFallback: false,
    compressedProxy: false,
    http2Enabled: false,
    disableNormalFallback: false,
    verboseNetworkLogs: false,
  },
  wallhubSteamAccessHostBlacklist: [],
  wallhubSteamAccessStaticCdnEnhance: false,
  wallhubSteamAccessStaticCdnHosts: {
    imagesSteamusercontent: { enhance: false, reuseConnection: true },
    sharedAkamaiSteamstatic: { enhance: false, reuseConnection: true },
  },
  depotStreamCacheMaxMb: 512,
};

function migrateSteamCdnRouteSettings(settings, logger = console) {
  const next = settings || {};
  // Legacy builds exposed CDN mode / proxy mode as separate knobs. Avoid
  // resurrecting the old CDN-route coupling from those stale fields: only keep
  // an explicitly saved steamCdnRouteStrategy, otherwise default to Steam's
  // normal CDN selection.
  if (!Object.prototype.hasOwnProperty.call(next, 'steamCdnRouteStrategy')) {
    next.steamCdnRouteStrategy = 'nearest';
  }
  next.steamCdnRouteStrategy = normalizeSteamCdnRouteStrategy(next.steamCdnRouteStrategy);

  const oldProxyUrl = String(next.downloadProxyUrl || '').trim();
  next.steamHttpProxyUrl = String(next.steamHttpProxyUrl || oldProxyUrl || '').trim();
  if (next.steamHttpProxyUrl) {
    try {
      next.steamHttpProxyUrl = normalizeSteamHttpProxyUrl(next.steamHttpProxyUrl);
      next.steamCdnRouteStrategy = 'proxy';
    } catch (proxyErr) {
      logger.warn('[Settings] Ignoring invalid Steam HTTP proxy:', proxyErr.message);
      next.steamHttpProxyUrl = '';
      next.steamCdnRouteStrategy = 'nearest';
    }
  } else {
    next.steamCdnRouteStrategy = 'nearest';
  }
  return next;
}

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

function pruneLegacySteamCdnSettings(settings) {
  if (!settings) return settings;
  delete settings.downloadProxyMode;
  delete settings.downloadProxyUrl;
  delete settings.steamContentCdnMode;
  delete settings.steamContentCellId;
  return settings;
}

function pruneRemovedSteamAccessSettings(settings) {
  if (!settings) return settings;
  delete settings.wallhubSteamBridgeEnabled;
  delete settings.wallhubSteamBridgeFallback;
  delete settings.wallhubSteamAccessMigrationNotice;
  delete settings.wallhubSteamAccessSniMode;
  delete settings.wallhubSteamAccessSniHostname;
  delete settings.steamRemoteSubscribeEnabled;
  delete settings.useSteamApi;
  delete settings.workshopQueryMode;
  delete settings.workshopHtmlOrderMode;
  return settings;
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
  next.wallhubLogLevel = normalizeWallhubLogLevel(next.wallhubLogLevel);
  next.wallhubAutoUpdateEnabled = !!next.wallhubAutoUpdateEnabled;
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

function applyCacheSettingsPatch(settings, data, options = {}) {
  const next = pruneRemovedSteamAccessSettings(Object.assign({}, settings || {}));
  const has = (key) => Object.prototype.hasOwnProperty.call(data || {}, key);
  const previousSteamApiKey = String(settings && settings.steamApiKey || '').trim();
  const previousSteamAccessSnapshot = {
    enhance: !!next.wallhubSteamAccessEnhance,
    webApiRoute: normalizeSteamWebApiRoute(next.wallhubSteamWebApiRoute || (next.wallhubSteamAccessDirectWebApi ? 'direct' : 'follow')),
    webApiProtocol: normalizeSteamWebApiProtocol(next.wallhubSteamWebApiProtocol),
    webApiHost: normalizeSteamWebApiHost(next.wallhubSteamWebApiHost),
    mode: normalizeSteamAccessMode(next.wallhubSteamAccessMode),
    hosts: String(next.wallhubSteamAccessHosts || ''),
    hostsUrl: String(next.wallhubSteamAccessHostsUrl || ''),
    hostsAutoUpdate: !!next.wallhubSteamAccessHostsAutoUpdateEnabled,
    hostsInterval: normalizeSteamAccessHostsUpdateIntervalHours(next.wallhubSteamAccessHostsUpdateIntervalHours),
    protocol: normalizeSteamAccessResolverProtocol(next.wallhubSteamAccessResolverProtocol),
    selectedDoh: normalizeSteamAccessEndpointList(next.wallhubSteamAccessSelectedDohEndpoints, 'doh'),
    customDoh: normalizeSteamAccessEndpointList(next.wallhubSteamAccessCustomDohEndpoints, 'doh'),
    selectedDot: normalizeSteamAccessEndpointList(next.wallhubSteamAccessSelectedDotEndpoints, 'dot'),
    customDot: normalizeSteamAccessEndpointList(next.wallhubSteamAccessCustomDotEndpoints, 'dot'),
    dohEndpoint: String(next.wallhubSteamAccessDohEndpoint || DEFAULT_CACHE_SETTINGS.wallhubSteamAccessDohEndpoint),
    dohMode: normalizeSteamAccessResolverMode(next.wallhubSteamAccessDohMode),
    dotEndpoint: String(next.wallhubSteamAccessDotEndpoint || DEFAULT_CACHE_SETTINGS.wallhubSteamAccessDotEndpoint),
    dotMode: normalizeSteamAccessResolverMode(next.wallhubSteamAccessDotMode),
    experimental: normalizeSteamAccessExperimental(next.wallhubSteamAccessExperimental),
    hostBlacklist: normalizeSteamAccessHostList(next.wallhubSteamAccessHostBlacklist),
    staticCdnEnhance: !!next.wallhubSteamAccessStaticCdnEnhance,
    staticCdnHosts: normalizeSteamAccessStaticCdnHosts(next.wallhubSteamAccessStaticCdnHosts),
  };

  if (has('wallhubLogLevel')) next.wallhubLogLevel = normalizeWallhubLogLevel(data.wallhubLogLevel);
  else next.wallhubLogLevel = normalizeWallhubLogLevel(next.wallhubLogLevel);
  if (has('wallhubAutoUpdateEnabled')) next.wallhubAutoUpdateEnabled = !!data.wallhubAutoUpdateEnabled;
  else next.wallhubAutoUpdateEnabled = !!next.wallhubAutoUpdateEnabled;
  if (has('mpkgTextureProfile')) next.mpkgTextureProfile = normalizeMpkgTextureProfile(data.mpkgTextureProfile);
  else next.mpkgTextureProfile = normalizeMpkgTextureProfile(next.mpkgTextureProfile);
  delete next.mpkgMaxConcurrentBuilds;
  if (has('downloadDir') && typeof options.applyDownloadDir === 'function') next.downloadDir = options.applyDownloadDir(data.downloadDir);
  if (has('maxConcurrentDownloads') && typeof options.normalizeMaxConcurrentDownloads === 'function') next.maxConcurrentDownloads = options.normalizeMaxConcurrentDownloads(data.maxConcurrentDownloads);
  if (has('steamCdnRouteStrategy')) {
    next.steamCdnRouteStrategy = normalizeSteamCdnRouteStrategy(data.steamCdnRouteStrategy);
  } else if (has('steamContentCdnMode')) {
    next.steamCdnRouteStrategy = String(data.steamContentCdnMode || '').trim().toLowerCase() === 'proxy' ? 'proxy' : 'nearest';
  } else if (has('downloadProxyMode')) {
    next.steamCdnRouteStrategy = String(data.downloadProxyMode || '').trim().toLowerCase() === 'manual' ? 'proxy' : normalizeSteamCdnRouteStrategy(next.steamCdnRouteStrategy);
  }
  if (has('steamApiKey')) next.steamApiKey = String(data.steamApiKey || '').trim();
  else next.steamApiKey = String(next.steamApiKey || '').trim();
  if (has('steamHttpProxyUrl')) next.steamHttpProxyUrl = String(data.steamHttpProxyUrl || '').trim();
  else if (has('downloadProxyUrl')) next.steamHttpProxyUrl = String(data.downloadProxyUrl || '').trim();
  if (next.steamHttpProxyUrl) {
    next.steamHttpProxyUrl = normalizeSteamHttpProxyUrl(next.steamHttpProxyUrl);
    next.steamCdnRouteStrategy = 'proxy';
  } else {
    next.steamCdnRouteStrategy = 'nearest';
  }
  if (has('steamKitMaxDownloads')) next.steamKitMaxDownloads = normalizeSteamKitMaxDownloads(data.steamKitMaxDownloads);
  if (has('steamKitDepotStreaming')) next.steamKitDepotStreaming = !!data.steamKitDepotStreaming;

  if (has('wallhubSteamAccessEnhance')) {
    next.wallhubSteamAccessEnhance = !!data.wallhubSteamAccessEnhance;
  }
  if (has('wallhubSteamAccessDirectWebApi') && !has('wallhubSteamWebApiRoute')) next.wallhubSteamWebApiRoute = data.wallhubSteamAccessDirectWebApi ? 'direct' : 'follow';
  if (has('wallhubSteamWebApiRoute')) next.wallhubSteamWebApiRoute = normalizeSteamWebApiRoute(data.wallhubSteamWebApiRoute);
  if (has('wallhubSteamWebApiProtocol')) next.wallhubSteamWebApiProtocol = normalizeSteamWebApiProtocol(data.wallhubSteamWebApiProtocol);
  if (has('wallhubSteamWebApiHost')) next.wallhubSteamWebApiHost = normalizeSteamWebApiHost(data.wallhubSteamWebApiHost);
  next.wallhubSteamAccessDirectWebApi = normalizeSteamWebApiRoute(next.wallhubSteamWebApiRoute) === 'direct';
  if (has('wallhubSteamAccessMode')) {
    const rawMode = String(data.wallhubSteamAccessMode || 'resolver').trim().toLowerCase();
    if (rawMode === 'dot' || rawMode === 'doh') {
      next.wallhubSteamAccessMode = 'resolver';
      next.wallhubSteamAccessResolverProtocol = rawMode;
    } else {
      next.wallhubSteamAccessMode = normalizeSteamAccessMode(rawMode);
    }
  }
  if (has('wallhubSteamAccessHosts')) next.wallhubSteamAccessHosts = normalizeHostsText(data.wallhubSteamAccessHosts);
  if (has('wallhubSteamAccessHostsUrl')) next.wallhubSteamAccessHostsUrl = normalizeSteamAccessHostsUrl(data.wallhubSteamAccessHostsUrl);
  if (has('wallhubSteamAccessHostsAutoUpdateEnabled')) next.wallhubSteamAccessHostsAutoUpdateEnabled = !!data.wallhubSteamAccessHostsAutoUpdateEnabled;
  if (has('wallhubSteamAccessHostsUpdateIntervalHours')) next.wallhubSteamAccessHostsUpdateIntervalHours = normalizeSteamAccessHostsUpdateIntervalHours(data.wallhubSteamAccessHostsUpdateIntervalHours);
  if (has('wallhubSteamAccessHostsLastUpdatedAt')) next.wallhubSteamAccessHostsLastUpdatedAt = normalizeTimestamp(data.wallhubSteamAccessHostsLastUpdatedAt);
  if (has('wallhubSteamAccessHostsLastError')) next.wallhubSteamAccessHostsLastError = String(data.wallhubSteamAccessHostsLastError || '').slice(0, 1000);
  if (has('wallhubSteamAccessResolverProtocol')) next.wallhubSteamAccessResolverProtocol = normalizeSteamAccessResolverProtocol(data.wallhubSteamAccessResolverProtocol);
  if (has('wallhubSteamAccessDohEndpoint')) {
    next.wallhubSteamAccessDohEndpoint = normalizeSteamAccessDohEndpoint(data.wallhubSteamAccessDohEndpoint);
    includeEndpoint(next.wallhubSteamAccessSelectedDohEndpoints, next.wallhubSteamAccessDohEndpoint);
  }
  if (has('wallhubSteamAccessDohMode')) next.wallhubSteamAccessDohMode = normalizeSteamAccessResolverMode(data.wallhubSteamAccessDohMode);
  if (has('wallhubSteamAccessDotEndpoint')) {
    next.wallhubSteamAccessDotEndpoint = normalizeSteamAccessDotEndpoint(data.wallhubSteamAccessDotEndpoint);
    includeEndpoint(next.wallhubSteamAccessSelectedDotEndpoints, next.wallhubSteamAccessDotEndpoint);
  }
  if (has('wallhubSteamAccessDotMode')) next.wallhubSteamAccessDotMode = normalizeSteamAccessResolverMode(data.wallhubSteamAccessDotMode);
  if (has('wallhubSteamAccessCustomDohEndpoints')) next.wallhubSteamAccessCustomDohEndpoints = normalizeSteamAccessEndpointList(data.wallhubSteamAccessCustomDohEndpoints, 'doh', { limit: STEAM_ACCESS_CUSTOM_ENDPOINT_LIMIT, strict: true });
  if (has('wallhubSteamAccessCustomDotEndpoints')) next.wallhubSteamAccessCustomDotEndpoints = normalizeSteamAccessEndpointList(data.wallhubSteamAccessCustomDotEndpoints, 'dot', { limit: STEAM_ACCESS_CUSTOM_ENDPOINT_LIMIT, strict: true });
  if (has('wallhubSteamAccessSelectedDohEndpoints')) next.wallhubSteamAccessSelectedDohEndpoints = normalizeSteamAccessEndpointList(data.wallhubSteamAccessSelectedDohEndpoints, 'doh', { limit: STEAM_ACCESS_SELECTED_ENDPOINT_LIMIT, strict: true });
  if (has('wallhubSteamAccessSelectedDotEndpoints')) next.wallhubSteamAccessSelectedDotEndpoints = normalizeSteamAccessEndpointList(data.wallhubSteamAccessSelectedDotEndpoints, 'dot', { limit: STEAM_ACCESS_SELECTED_ENDPOINT_LIMIT, strict: true });
  if (has('wallhubSteamAccessExperimental')) next.wallhubSteamAccessExperimental = normalizeSteamAccessExperimental(data.wallhubSteamAccessExperimental);
  else next.wallhubSteamAccessExperimental = normalizeSteamAccessExperimental(next.wallhubSteamAccessExperimental);
  if (has('wallhubSteamAccessHostBlacklist')) next.wallhubSteamAccessHostBlacklist = normalizeSteamAccessHostList(data.wallhubSteamAccessHostBlacklist);
  else next.wallhubSteamAccessHostBlacklist = normalizeSteamAccessHostList(next.wallhubSteamAccessHostBlacklist);
  if (has('wallhubSteamAccessStaticCdnHosts')) next.wallhubSteamAccessStaticCdnHosts = normalizeSteamAccessStaticCdnHosts(data.wallhubSteamAccessStaticCdnHosts);
  else next.wallhubSteamAccessStaticCdnHosts = normalizeSteamAccessStaticCdnHosts(next.wallhubSteamAccessStaticCdnHosts);
  if (has('wallhubSteamAccessStaticCdnEnhance')) {
    next.wallhubSteamAccessStaticCdnEnhance = !!data.wallhubSteamAccessStaticCdnEnhance;
    if (!has('wallhubSteamAccessStaticCdnHosts')) {
      next.wallhubSteamAccessStaticCdnHosts.imagesSteamusercontent.enhance = next.wallhubSteamAccessStaticCdnEnhance;
      next.wallhubSteamAccessStaticCdnHosts.sharedAkamaiSteamstatic.enhance = next.wallhubSteamAccessStaticCdnEnhance;
    }
  }
  next.wallhubSteamAccessStaticCdnEnhance = anyStaticCdnHostEnhanceEnabled(next.wallhubSteamAccessStaticCdnHosts);
  normalizeSteamAccessEndpointSettings(next, options.logger || console, { migrateSingleEndpoints: false });
  delete next.wallhubSteamResourceProxy;
  if (has('depotStreamCacheMaxMb')) next.depotStreamCacheMaxMb = normalizeDepotStreamCacheMaxMb(data.depotStreamCacheMaxMb);
  pruneRemovedSteamAccessSettings(next);

  const currentSteamAccessSnapshot = {
    enhance: !!next.wallhubSteamAccessEnhance,
    webApiRoute: normalizeSteamWebApiRoute(next.wallhubSteamWebApiRoute || (next.wallhubSteamAccessDirectWebApi ? 'direct' : 'follow')),
    webApiProtocol: normalizeSteamWebApiProtocol(next.wallhubSteamWebApiProtocol),
    webApiHost: normalizeSteamWebApiHost(next.wallhubSteamWebApiHost),
    mode: normalizeSteamAccessMode(next.wallhubSteamAccessMode),
    hosts: String(next.wallhubSteamAccessHosts || ''),
    hostsUrl: String(next.wallhubSteamAccessHostsUrl || ''),
    hostsAutoUpdate: !!next.wallhubSteamAccessHostsAutoUpdateEnabled,
    hostsInterval: normalizeSteamAccessHostsUpdateIntervalHours(next.wallhubSteamAccessHostsUpdateIntervalHours),
    protocol: normalizeSteamAccessResolverProtocol(next.wallhubSteamAccessResolverProtocol),
    selectedDoh: normalizeSteamAccessEndpointList(next.wallhubSteamAccessSelectedDohEndpoints, 'doh'),
    customDoh: normalizeSteamAccessEndpointList(next.wallhubSteamAccessCustomDohEndpoints, 'doh'),
    selectedDot: normalizeSteamAccessEndpointList(next.wallhubSteamAccessSelectedDotEndpoints, 'dot'),
    customDot: normalizeSteamAccessEndpointList(next.wallhubSteamAccessCustomDotEndpoints, 'dot'),
    dohEndpoint: String(next.wallhubSteamAccessDohEndpoint || DEFAULT_CACHE_SETTINGS.wallhubSteamAccessDohEndpoint),
    dohMode: normalizeSteamAccessResolverMode(next.wallhubSteamAccessDohMode),
    dotEndpoint: String(next.wallhubSteamAccessDotEndpoint || DEFAULT_CACHE_SETTINGS.wallhubSteamAccessDotEndpoint),
    dotMode: normalizeSteamAccessResolverMode(next.wallhubSteamAccessDotMode),
    experimental: normalizeSteamAccessExperimental(next.wallhubSteamAccessExperimental),
    hostBlacklist: normalizeSteamAccessHostList(next.wallhubSteamAccessHostBlacklist),
    staticCdnEnhance: !!next.wallhubSteamAccessStaticCdnEnhance,
    staticCdnHosts: normalizeSteamAccessStaticCdnHosts(next.wallhubSteamAccessStaticCdnHosts),
  };
  const steamAccessEnhanceChanged = previousSteamAccessSnapshot.enhance !== currentSteamAccessSnapshot.enhance;
  const steamAccessDirectWebApiChanged = previousSteamAccessSnapshot.webApiRoute !== currentSteamAccessSnapshot.webApiRoute ||
    previousSteamAccessSnapshot.webApiProtocol !== currentSteamAccessSnapshot.webApiProtocol ||
    previousSteamAccessSnapshot.webApiHost !== currentSteamAccessSnapshot.webApiHost;
  const steamAccessModeChanged = previousSteamAccessSnapshot.mode !== currentSteamAccessSnapshot.mode;
  const steamAccessHostsChanged = previousSteamAccessSnapshot.hosts !== currentSteamAccessSnapshot.hosts ||
    previousSteamAccessSnapshot.hostsUrl !== currentSteamAccessSnapshot.hostsUrl ||
    previousSteamAccessSnapshot.hostsAutoUpdate !== currentSteamAccessSnapshot.hostsAutoUpdate ||
    previousSteamAccessSnapshot.hostsInterval !== currentSteamAccessSnapshot.hostsInterval;
  const steamAccessResolverChanged = previousSteamAccessSnapshot.protocol !== currentSteamAccessSnapshot.protocol ||
    previousSteamAccessSnapshot.dohEndpoint !== currentSteamAccessSnapshot.dohEndpoint ||
    previousSteamAccessSnapshot.dohMode !== currentSteamAccessSnapshot.dohMode ||
    previousSteamAccessSnapshot.dotEndpoint !== currentSteamAccessSnapshot.dotEndpoint ||
    previousSteamAccessSnapshot.dotMode !== currentSteamAccessSnapshot.dotMode ||
    stableStringify(previousSteamAccessSnapshot.selectedDoh) !== stableStringify(currentSteamAccessSnapshot.selectedDoh) ||
    stableStringify(previousSteamAccessSnapshot.customDoh) !== stableStringify(currentSteamAccessSnapshot.customDoh) ||
    stableStringify(previousSteamAccessSnapshot.selectedDot) !== stableStringify(currentSteamAccessSnapshot.selectedDot) ||
    stableStringify(previousSteamAccessSnapshot.customDot) !== stableStringify(currentSteamAccessSnapshot.customDot) ||
    stableStringify(previousSteamAccessSnapshot.experimental) !== stableStringify(currentSteamAccessSnapshot.experimental) ||
    stableStringify(previousSteamAccessSnapshot.hostBlacklist) !== stableStringify(currentSteamAccessSnapshot.hostBlacklist) ||
    previousSteamAccessSnapshot.staticCdnEnhance !== currentSteamAccessSnapshot.staticCdnEnhance ||
    stableStringify(previousSteamAccessSnapshot.staticCdnHosts) !== stableStringify(currentSteamAccessSnapshot.staticCdnHosts) ||
    steamAccessModeChanged || steamAccessHostsChanged;

  const steamApiKeyChanged = has('steamApiKey') && previousSteamApiKey !== next.steamApiKey;

  return {
    settings: next,
    steamAccessEnhanceChanged,
    steamAccessDirectWebApiChanged,
    steamAccessModeChanged,
    steamAccessHostsChanged,
    steamAccessDohChanged: steamAccessResolverChanged,
    steamAccessResolverChanged,
    steamApiKeyChanged,
  };
}

module.exports = {
  DEFAULT_CACHE_SETTINGS,
  DEFAULT_STEAM_ACCESS_STATIC_CDN_HOSTS,
  migrateSteamCdnRouteSettings,
  pruneLegacySteamCdnSettings,
  pruneRemovedSteamAccessSettings,
  normalizeLoadedCacheSettings,
  applyCacheSettingsPatch,
  normalizeSteamAccessExperimental,
  normalizeSteamAccessHostList,
  normalizeSteamAccessStaticCdnHosts,
  normalizeWallhubLogLevel,
  normalizeMpkgTextureProfile,
  normalizeHostsText,
  parseSteamHostsText,
};
