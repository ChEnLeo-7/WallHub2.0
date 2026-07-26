'use strict';

const {
  normalizeSteamAccessEndpointList: defaultNormalizeSteamAccessEndpointList,
  normalizeSteamAccessResolverProtocol: defaultNormalizeSteamAccessResolverProtocol,
  normalizeSteamAccessResolverMode: defaultNormalizeSteamAccessResolverMode,
} = require('../../config/normalizers');

function createRuntimeSettings(options = {}) {
  const {
    cacheSettingsStore,
    getSettings,
    setSettings,
    env = process.env,
    normalizeMaxConcurrentDownloads,
    normalizeDepotStreamCacheMaxMb,
    normalizeSteamContentCellId,
    normalizeSteamKitMaxDownloads,
    normalizeSteamCdnRouteStrategy,
    normalizeSteamAccessEndpointList = defaultNormalizeSteamAccessEndpointList,
    normalizeSteamAccessResolverProtocol = defaultNormalizeSteamAccessResolverProtocol,
    normalizeSteamAccessResolverMode = defaultNormalizeSteamAccessResolverMode,
    getDefaultSteamKitMaxDownloads,
    applySteamHttpProxyEnvFromUrl,
    buildSteamContentEnvForStrategy,
    applyDownloadDir,
    getCurrentDownloadDir,
    getNsfwEnabled = () => false,
  } = options;

  function settings() {
    return getSettings ? getSettings() : cacheSettingsStore.state;
  }

  function updateSettings(next) {
    if (setSettings) setSettings(next);
    return next;
  }

  function load() {
    const loaded = cacheSettingsStore.load({
      getMaxConcurrentDownloads: (state) => normalizeMaxConcurrentDownloads(state.maxConcurrentDownloads || env.WALLHUB_MAX_CONCURRENT_DOWNLOADS || 1),
      applyDownloadDir: (dir) => applyDownloadDir(dir, { persist: false }),
      getCurrentDownloadDir,
    });
    return updateSettings(loaded);
  }

  function save() {
    cacheSettingsStore.save(settings());
    return updateSettings(cacheSettingsStore.state);
  }

  function getMaxConcurrentDownloads() {
    return normalizeMaxConcurrentDownloads(settings().maxConcurrentDownloads || env.WALLHUB_MAX_CONCURRENT_DOWNLOADS || 1);
  }

  function getDepotStreamCacheMaxMb() {
    const envBytes = parseInt(String(env.WALLHUB_DEPOT_STREAM_CACHE_MAX_BYTES || '').trim(), 10);
    if (Number.isFinite(envBytes) && envBytes > 0) {
      return normalizeDepotStreamCacheMaxMb(Math.ceil(envBytes / 1024 / 1024));
    }
    const envMb = parseInt(String(env.WALLHUB_DEPOT_STREAM_CACHE_MAX_MB || '').trim(), 10);
    if (Number.isFinite(envMb) && envMb > 0) return normalizeDepotStreamCacheMaxMb(envMb);
    return normalizeDepotStreamCacheMaxMb(settings().depotStreamCacheMaxMb);
  }

  function getDepotStreamCacheMaxBytes() {
    return getDepotStreamCacheMaxMb() * 1024 * 1024;
  }

  function getSteamContentCellId() {
    return normalizeSteamContentCellId(env.WALLHUB_STEAM_CONTENT_CELLID || env.DEPOTDOWNLOADER_CELLID || '');
  }

  function getSteamKitMaxDownloads() {
    const envValue = normalizeSteamKitMaxDownloads(env.DEPOTDOWNLOADER_MAX_DOWNLOADS || '');
    if (envValue) return envValue;
    const configured = normalizeSteamKitMaxDownloads(settings().steamKitMaxDownloads);
    return configured || getDefaultSteamKitMaxDownloads();
  }

  function getSteamKitStreamMaxDownloads() {
    const envValue = normalizeSteamKitMaxDownloads(env.WALLHUB_DEPOT_STREAM_MAX_DOWNLOADS || '');
    if (envValue) return envValue;
    return getSteamKitMaxDownloads();
  }

  function getSteamKitLoginMaxDownloads() {
    return 1;
  }

  function getSteamAccessMode() {
    return String(settings().wallhubSteamAccessMode || 'resolver').trim();
  }

  function getSteamAccessHosts() {
    return String(settings().wallhubSteamAccessHosts || '');
  }

  function steamAccessHostsEnabled() {
    return getSteamAccessMode() === 'hosts';
  }

  function steamAccessGatewayEnabled() {
    return !!settings().wallhubSteamAccessEnhance || steamAccessStaticCdnEnhanceEnabled() || env.WALLHUB_STEAM_ACCESS_ENHANCE === '1';
  }

  function steamAccessDirectWebApiEnabled() {
    return getSteamWebApiRoute() === 'direct';
  }

  function getSteamAccessExperimental() {
    const configured = settings().wallhubSteamAccessExperimental || {};
    const logLevel = String(settings().wallhubLogLevel || env.WALLHUB_LOG_LEVEL || 'info').trim().toLowerCase() === 'debug' ? 'debug' : 'info';
    const verboseNetworkLogs = logLevel === 'debug' || !!configured.verboseNetworkLogs || env.WALLHUB_STEAM_ACCESS_VERBOSE_LOGS === '1';
    return {
      hiddenSniForAll: !!configured.hiddenSniForAll || env.WALLHUB_STEAM_ACCESS_HIDDEN_SNI_ALL === '1',
      fakeSniFallback: !!configured.fakeSniFallback || env.WALLHUB_STEAM_ACCESS_FAKE_SNI === '1',
      compressedProxy: !!configured.compressedProxy || env.WALLHUB_URL_PROXY_COMPRESSED_UPSTREAM === '1',
      http2Enabled: !!configured.http2Enabled || env.WALLHUB_STEAM_ACCESS_HTTP2 === '1',
      disableNormalFallback: !!configured.disableNormalFallback || env.WALLHUB_STEAM_ACCESS_FALLBACK_NORMAL === '0',
      verboseNetworkLogs,
      logLevel,
    };
  }

  function getSteamAccessHostBlacklist() {
    const configured = Array.isArray(settings().wallhubSteamAccessHostBlacklist) ? settings().wallhubSteamAccessHostBlacklist : [];
    const envList = String(env.WALLHUB_STEAM_ACCESS_HOST_BLACKLIST || '').split(/[\s,]+/).filter(Boolean);
    return Array.from(new Set(configured.concat(envList).map(item => String(item || '').trim().toLowerCase()).filter(Boolean)));
  }

  function staticCdnHostControlKey(hostname) {
    const host = String(hostname || '').trim().toLowerCase();
    if (host === 'images.steamusercontent.com' || host === 'steamuserimages-a.akamaihd.net') return 'imagesSteamusercontent';
    if (host === 'shared.akamai.steamstatic.com') return 'sharedAkamaiSteamstatic';
    return '';
  }

  function getSteamAccessStaticCdnHosts() {
    const raw = settings().wallhubSteamAccessStaticCdnHosts || {};
    return {
      imagesSteamusercontent: Object.assign({ enhance: false, reuseConnection: true }, raw.imagesSteamusercontent || {}),
      sharedAkamaiSteamstatic: Object.assign({ enhance: false, reuseConnection: true }, raw.sharedAkamaiSteamstatic || {}),
    };
  }

  function steamAccessStaticCdnEnhanceEnabled() {
    const controls = getSteamAccessStaticCdnHosts();
    return !!settings().wallhubSteamAccessStaticCdnEnhance ||
      !!controls.imagesSteamusercontent.enhance ||
      !!controls.sharedAkamaiSteamstatic.enhance ||
      env.WALLHUB_STEAM_ACCESS_STATIC_CDN === '1';
  }

  function steamAccessStaticCdnHostEnhanceEnabled(hostname) {
    if (env.WALLHUB_STEAM_ACCESS_STATIC_CDN === '1') return true;
    const key = staticCdnHostControlKey(hostname);
    if (key) return !!getSteamAccessStaticCdnHosts()[key]?.enhance;
    return !!settings().wallhubSteamAccessStaticCdnEnhance;
  }

  function steamAccessStaticCdnHostConnectionReuseEnabled(hostname) {
    const key = staticCdnHostControlKey(hostname);
    return key ? getSteamAccessStaticCdnHosts()[key]?.reuseConnection !== false : true;
  }

  function getSteamWebApiRoute() {
    const envRoute = String(env.WALLHUB_STEAM_WEBAPI_ROUTE || '').trim().toLowerCase();
    if (env.WALLHUB_STEAM_ACCESS_DIRECT_WEBAPI === '1') return 'direct';
    if (envRoute === 'direct' || envRoute === 'follow') return envRoute;
    const configured = String(settings().wallhubSteamWebApiRoute || '').trim().toLowerCase();
    if (configured === 'direct' || configured === 'follow') return configured;
    return settings().wallhubSteamAccessDirectWebApi ? 'direct' : 'follow';
  }

  function getSteamWebApiProtocol() {
    const value = String(env.WALLHUB_STEAM_WEBAPI_PROTOCOL || settings().wallhubSteamWebApiProtocol || 'https').trim().toLowerCase().replace(/:$/, '');
    return value === 'http' ? 'http' : 'https';
  }

  function getSteamWebApiHost() {
    const value = String(env.WALLHUB_STEAM_WEBAPI_HOST || settings().wallhubSteamWebApiHost || 'api.steampowered.com').trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    return value === 'community.steam-api.com' ? value : 'api.steampowered.com';
  }

  function getSteamWebApiBaseUrl() {
    return `${getSteamWebApiProtocol()}://${getSteamWebApiHost()}`;
  }

  function envValue(name) {
    return String(env[name] || '').trim();
  }

  function isOffValue(value) {
    return /^(?:0|off|false|disabled|none)$/i.test(String(value || '').trim());
  }

  function dedupeList(values) {
    const seen = new Set();
    const out = [];
    for (const value of values || []) {
      const item = String(value || '').trim();
      if (!item || seen.has(item)) continue;
      seen.add(item);
      out.push(item);
    }
    return out;
  }

  function configuredDepotResolverEndpoints(protocol) {
    const normalizedProtocol = normalizeSteamAccessResolverProtocol(protocol);
    const state = settings();
    const selectedKey = normalizedProtocol === 'dot' ? 'wallhubSteamAccessSelectedDotEndpoints' : 'wallhubSteamAccessSelectedDohEndpoints';
    const customKey = normalizedProtocol === 'dot' ? 'wallhubSteamAccessCustomDotEndpoints' : 'wallhubSteamAccessCustomDohEndpoints';
    const currentKey = normalizedProtocol === 'dot' ? 'wallhubSteamAccessDotEndpoint' : 'wallhubSteamAccessDohEndpoint';
    const selected = normalizeSteamAccessEndpointList(state[selectedKey] || [], normalizedProtocol);
    const custom = normalizeSteamAccessEndpointList(state[customKey] || [], normalizedProtocol, { limit: 32 });
    const current = normalizeSteamAccessEndpointList([state[currentKey]], normalizedProtocol);
    const combined = dedupeList(selected.concat(custom));
    return combined.length ? combined : current;
  }

  function buildDepotResolverEnv(baseEnv = env) {
    const nextEnv = Object.assign({}, baseEnv);
    delete nextEnv.WALLHUB_DEPOT_CM_RESOLVER;
    delete nextEnv.WALLHUB_DEPOT_DOH_CM;
    delete nextEnv.WALLHUB_DEPOT_RESOLVER_PROTOCOL;
    delete nextEnv.WALLHUB_DEPOT_RESOLVER_MODE;
    delete nextEnv.WALLHUB_DEPOT_DOH_ENDPOINTS;
    delete nextEnv.WALLHUB_DEPOT_DOT_ENDPOINTS;
    const bridgeUrl = envValue('WALLHUB_DEPOT_RESOLVER_URL');
    const bridgeToken = envValue('WALLHUB_DEPOT_RESOLVER_TOKEN');
    const brokerUrl = envValue('WALLHUB_DEPOT_WEBAPI_BROKER_URL');
    const brokerToken = envValue('WALLHUB_DEPOT_WEBAPI_BROKER_TOKEN') || bridgeToken;
    if (steamAccessGatewayEnabled() && bridgeUrl && bridgeToken) {
      nextEnv.WALLHUB_DEPOT_RESOLVER_URL = bridgeUrl;
      nextEnv.WALLHUB_DEPOT_RESOLVER_TOKEN = bridgeToken;
    } else {
      delete nextEnv.WALLHUB_DEPOT_RESOLVER_URL;
      delete nextEnv.WALLHUB_DEPOT_RESOLVER_TOKEN;
    }
    if (steamAccessGatewayEnabled() && brokerUrl && brokerToken) {
      nextEnv.WALLHUB_DEPOT_WEBAPI_BROKER_URL = brokerUrl;
      nextEnv.WALLHUB_DEPOT_WEBAPI_BROKER_TOKEN = brokerToken;
    } else {
      delete nextEnv.WALLHUB_DEPOT_WEBAPI_BROKER_URL;
      delete nextEnv.WALLHUB_DEPOT_WEBAPI_BROKER_TOKEN;
    }
    return nextEnv;
  }

  function getSteamCdnRouteStrategy() {
    if (env.WALLHUB_STEAM_CDN_ROUTE_STRATEGY) {
      return normalizeSteamCdnRouteStrategy(env.WALLHUB_STEAM_CDN_ROUTE_STRATEGY);
    }
    if (env.WALLHUB_STEAM_CONTENT_DIRECT === '1') return 'nearest';
    const state = settings();
    if (state.steamCdnRouteStrategy === 'proxy' && !String(state.steamHttpProxyUrl || '').trim()) {
      return 'nearest';
    }
    return normalizeSteamCdnRouteStrategy(state.steamCdnRouteStrategy);
  }

  function applySteamHttpProxyEnv(baseEnv = env) {
    return applySteamHttpProxyEnvFromUrl(baseEnv, settings().steamHttpProxyUrl || '');
  }

  function buildSteamContentEnv(baseEnv = env) {
    const nextEnv = buildDepotResolverEnv(buildSteamContentEnvForStrategy(baseEnv, {
      strategy: getSteamCdnRouteStrategy(),
      proxyUrl: settings().steamHttpProxyUrl || '',
    }));
    const configuredSteam3Protocol = String(env.WALLHUB_DEPOT_STEAM3_PROTOCOL || env.WALLHUB_STEAM3_PROTOCOL || '').trim().toLowerCase();
    if (configuredSteam3Protocol) nextEnv.WALLHUB_DEPOT_STEAM3_PROTOCOL = configuredSteam3Protocol;
    else delete nextEnv.WALLHUB_DEPOT_STEAM3_PROTOCOL;
    return nextEnv;
  }

  function describeSteamCdnRouteStrategy() {
    const strategy = getSteamCdnRouteStrategy();
    if (strategy === 'proxy') {
      const proxyUrl = String(settings().steamHttpProxyUrl || '').trim();
      return proxyUrl ? 'proxy (custom proxy)' : 'default Steam CDN route (proxy not configured)';
    }
    return 'default Steam CDN route';
  }

  function snapshot(extra = {}) {
    return cacheSettingsStore.snapshot(extra, {
      downloadDir: getCurrentDownloadDir,
      maxConcurrentDownloads: getMaxConcurrentDownloads,
      steamCdnRouteStrategy: getSteamCdnRouteStrategy,
      steamKitMaxDownloads: () => normalizeSteamKitMaxDownloads(settings().steamKitMaxDownloads),
      effectiveSteamKitMaxDownloads: getSteamKitMaxDownloads,
      depotStreamCacheMaxMb: getDepotStreamCacheMaxMb,
      nsfwEnabled: getNsfwEnabled,
      steamWebApiRoute: getSteamWebApiRoute,
      steamWebApiProtocol: getSteamWebApiProtocol,
      steamWebApiHost: getSteamWebApiHost,
      steamAccessExperimental: getSteamAccessExperimental,
      steamAccessHostBlacklist: getSteamAccessHostBlacklist,
      steamAccessStaticCdnEnhance: steamAccessStaticCdnEnhanceEnabled,
      steamAccessStaticCdnHosts: getSteamAccessStaticCdnHosts,
    });
  }

  function applyPatch(data, patchOptions = {}) {
    cacheSettingsStore.setState(settings());
    const patchResult = cacheSettingsStore.applyPatch(data, Object.assign({}, patchOptions, {
      applyDownloadDir: (raw) => applyDownloadDir(raw, { persist: false }),
      normalizeMaxConcurrentDownloads,
    }));
    updateSettings(patchResult.settings);
    return patchResult;
  }

  return {
    getState: settings,
    setState: updateSettings,
    load,
    save,
    snapshot,
    applyPatch,
    getMaxConcurrentDownloads,
    getDepotStreamCacheMaxMb,
    getDepotStreamCacheMaxBytes,
    getSteamContentCellId,
    getSteamKitMaxDownloads,
    getSteamKitStreamMaxDownloads,
    getSteamKitLoginMaxDownloads,
    applySteamHttpProxyEnv,
    getSteamCdnRouteStrategy,
    getSteamWebApiRoute,
    getSteamWebApiProtocol,
    getSteamWebApiBaseUrl,
    buildDepotResolverEnv,
    buildSteamContentEnv,
    describeSteamCdnRouteStrategy,
    steamAccessGatewayEnabled,
    steamAccessDirectWebApiEnabled,
    getSteamAccessExperimental,
    getSteamAccessHostBlacklist,
    getSteamAccessStaticCdnHosts,
    steamAccessStaticCdnEnhanceEnabled,
    steamAccessStaticCdnHostEnhanceEnabled,
    steamAccessStaticCdnHostConnectionReuseEnabled,
    steamAccessHostsEnabled,
    getSteamAccessMode,
    getSteamAccessHosts,
  };
}

module.exports = {
  createRuntimeSettings,
};
