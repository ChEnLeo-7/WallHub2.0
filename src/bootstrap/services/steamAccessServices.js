'use strict';

const dns = require('node:dns');

function assembleSteamAccessServices(scope) {
  const {
    createSteamAccessGateway,
  } = scope.require('./src/domains/steamAccess/gateway');
  const {
    createInternalSteamResolverHandler,
    createInternalSteamWebApiBrokerHandler,
  } = scope.require('./src/domains/steamAccess/internalResolver');
  const { createHostsUpdater } = scope.require('./src/domains/steamAccess/hostsUpdater');
  const { createSteamProxyHandlers } = scope.require('./src/app/handlers/steamProxy');
  const { jsonRes, readBodyBuffer } = scope.require('./src/app/http');
  const { contentTypeFromUrl } = scope.require('./src/shared/mime');
  const { stripProxyEnv } = scope.require('./src/infrastructure/steam/contentEnv');
  const { isSteamCdnHost } = scope.require('./src/infrastructure/steam/networkPolicy');
  const { isAndroidHostLikeEnv } = scope.require('./src/config/platform');
  const {
    isSteamHost,
    isSteamStaticCdnHost,
    isSteamAccessGatewayHost,
    isSteamBroadcastResource,
    isSteamCommunityHost,
  } = scope.require('./src/domains/steam/hosts');

  const settings = () => scope.state.videoCacheSettings;
  scope.UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  scope.STEAM_PREF_COOKIE = [
    'birthtime=946684801',
    'lastagecheckage=1-January-2000',
    'mature_content=1',
    'wants_mature_content=1',
    'wants_mature_content_violence=1',
    'wants_mature_content_sex=1',
    'wants_adult_content=1',
    'wants_adult_content_violence=1',
    'wants_adult_content_sex=1',
    'wants_community_generated_adult_content=1',
    process.env.STEAM_COUNTRY ? `steamCountry=${process.env.STEAM_COUNTRY}` : '',
    `Steam_Language=${process.env.STEAM_LANG || 'schinese'}`,
    'timezoneOffset=28800,0',
  ].filter(Boolean).join('; ');

  scope.steamAccessGatewayEnabled = () => scope.getRuntimeSettings().steamAccessGatewayEnabled();
  scope.steamAccessDirectWebApiEnabled = () => scope.getRuntimeSettings().steamAccessDirectWebApiEnabled();
  scope.getSteamWebApiBaseUrl = () => scope.getRuntimeSettings().getSteamWebApiBaseUrl();
  scope.getSteamApiKey = () => String(settings().steamApiKey || '').trim() || String(process.env.STEAM_API_KEY || '').trim();
  scope.getSteamDataSource = () => {
    const source = String(settings().steamDataSource || '').trim().toLowerCase();
    return ['community', 'webapi', 'cm'].includes(source) ? source : 'community';
  };
  scope.hostMatchesSteamAccessBlacklist = hostname => {
    const host = String(hostname || '').trim().toLowerCase();
    return scope.getRuntimeSettings().getSteamAccessHostBlacklist().some(item => host === item || host.endsWith(`.${item}`));
  };
  scope.steamAccessGatewayHostEnabledForHost = hostname => {
    const host = String(hostname || '').trim().toLowerCase();
    if (!host || scope.hostMatchesSteamAccessBlacklist(host)) return false;
    if (isSteamCdnHost(host)) return false;
    if (isSteamAccessGatewayHost(host)) return !!settings().wallhubSteamAccessEnhance;
    return scope.getRuntimeSettings().steamAccessStaticCdnHostEnhanceEnabled(host) && isSteamStaticCdnHost(host);
  };

  let hostsUpdater = null;
  const gateway = createSteamAccessGateway({
    userAgent: 'WallHub',
    logger: console,
    configDir: scope.STEAMKIT_CONFIG_DIR,
    enabled: scope.steamAccessGatewayEnabled,
    getAccessMode: () => settings().wallhubSteamAccessMode,
    getHostsText: () => settings().wallhubSteamAccessHosts,
    getResolverProtocol: () => settings().wallhubSteamAccessResolverProtocol,
    getDohEndpoint: () => settings().wallhubSteamAccessDohEndpoint,
    getDohMode: () => settings().wallhubSteamAccessDohMode,
    getDotEndpoint: () => settings().wallhubSteamAccessDotEndpoint,
    getDotMode: () => settings().wallhubSteamAccessDotMode,
    getSelectedDohEndpoints: () => settings().wallhubSteamAccessSelectedDohEndpoints,
    getCustomDohEndpoints: () => settings().wallhubSteamAccessCustomDohEndpoints,
    getSelectedDotEndpoints: () => settings().wallhubSteamAccessSelectedDotEndpoints,
    getCustomDotEndpoints: () => settings().wallhubSteamAccessCustomDotEndpoints,
    getHostsLastUpdatedAt: () => settings().wallhubSteamAccessHostsLastUpdatedAt,
    getHostsLastError: () => settings().wallhubSteamAccessHostsLastError,
    getHostsNextUpdateAt: () => hostsUpdater ? hostsUpdater.nextUpdateAt() : 0,
    getExperimental: () => scope.getRuntimeSettings().getSteamAccessExperimental(),
    githubAcceleratorMode: scope.GITHUB_ACCELERATOR_MODE,
    directWebApi: scope.steamAccessDirectWebApiEnabled,
    isGatewayHost: scope.steamAccessGatewayHostEnabledForHost,
    reuseConnectionForHost: host => scope.getRuntimeSettings().steamAccessStaticCdnHostConnectionReuseEnabled(host),
    isStaticCdnHost: isSteamStaticCdnHost,
    isAndroidHostLikeEnv,
  });
  hostsUpdater = createHostsUpdater({
    userAgent: 'WallHub',
    getSettings: settings,
    applyPatch: patch => {
      scope.getRuntimeSettings().setState(settings());
      const result = scope.getRuntimeSettings().applyPatch(patch);
      scope.state.videoCacheSettings = result.settings;
      return result;
    },
    saveSettings: scope.saveCacheSettingsChecked,
    restoreSettings: value => {
      scope.state.videoCacheSettings = value;
      scope.getRuntimeSettings().setState(value);
      scope.CACHE_SETTINGS_STORE.setState(value);
    },
    clearGateway: () => gateway.clear(),
    logger: gateway.logger || console,
  });
  scope.STEAM_ACCESS_GATEWAY = gateway;
  scope.STEAM_ACCESS_HOSTS_UPDATER = hostsUpdater;
  scope.handleInternalSteamResolve = createInternalSteamResolverHandler({
    token: scope.resolverToken,
    enabled: host => gateway.policyForHost(host).enhanceEnabled,
    resolveHost: host => gateway.resolveHost(host, { forceResolver: true }),
    resolveSystemHost: async host => ({
      ips: Array.from(new Set((await dns.promises.lookup(host, { all: true })).map(item => item.address))),
    }),
    chooseRoute: (host, port, options) => gateway.chooseRoute(host, port, options),
    jsonRes,
    logger: console,
  });
  scope.handleInternalSteamWebApi = createInternalSteamWebApiBrokerHandler({
    token: scope.resolverToken,
    enabled: host => gateway.policyForHost(host).enhanceEnabled,
    requestSteam: (opts, body, timeout) => gateway.request(opts, body, timeout),
    requestDirect: (opts, body, timeout) => scope.doRequest(Object.assign({}, opts, {
      disableSteamAccessGateway: true,
      timeout,
    }), body),
    jsonRes,
    logger: console,
  });

  scope.removeSteamAccessCachedIp = gateway.removeCachedIp.bind(gateway);
  scope.chooseSteamAccessRoute = gateway.chooseRoute.bind(gateway);
  scope.steamAccessDiagnosticSnapshot = gateway.diagnosticSnapshot.bind(gateway);
  scope.steamAccessRuntimeSnapshot = gateway.runtimeSnapshot.bind(gateway);
  scope.steamAccessPolicyForHost = gateway.policyForHost.bind(gateway);
  scope.warmupSteamAccessGatewayCore = gateway.warmupCore.bind(gateway);
  scope.warmupSteamAccessGatewayControlPlane = gateway.warmupControlPlane.bind(gateway);
  scope.warmupSteamAccessGatewayCdnBackground = gateway.warmupCdnBackground.bind(gateway);
  scope.ensureSteamAccessGatewayReady = gateway.ensureReady.bind(gateway);
  scope.logSteamAccessResolvedRoutes = gateway.logResolvedRoutes.bind(gateway);
  scope.isSteamAccessGatewayWarmingUp = gateway.isWarmingUp.bind(gateway);
  scope.shouldUseSteamAccessGateway = gateway.shouldUse.bind(gateway);

  scope.WALLHUB_PROXY_VIRTUAL_HOST_PARAM = '__whp_host';
  const cacheTuning = scope.RUNTIME_TUNING.URL_PROXY_CACHE;
  scope.STEAM_PROXY_HANDLERS = createSteamProxyHandlers({
    userAgent: scope.UA,
    steamPrefCookie: scope.STEAM_PREF_COOKIE,
    virtualHostParam: scope.WALLHUB_PROXY_VIRTUAL_HOST_PARAM,
    cache: {
      dir: process.env.WALLHUB_URL_PROXY_CACHE_DIR || scope.path.join(scope.STEAMKIT_CONFIG_DIR, 'url-proxy-cache'),
      version: cacheTuning.version,
      maxBytes: cacheTuning.maxBytes,
      entryMaxBytes: cacheTuning.entryMaxBytes,
      ttlMs: cacheTuning.ttlMs,
    },
    env: process.env,
    platform: process.platform,
    logger: console,
    jsonRes,
    readBodyBuffer,
    stripProxyEnv,
    contentTypeFromUrl,
    isAndroidHostLikeEnv,
    isSteamHost,
    isSteamCdnHost,
    isSteamStaticCdnHost,
    isSteamBroadcastResource,
    isSteamCommunityHost,
    isSteamAccessGatewayHost: scope.steamAccessGatewayHostEnabledForHost,
    getSettings: settings,
    getSteamCdnRouteStrategy: scope.getSteamCdnRouteStrategy,
    steamAccessDirectWebApiEnabled: scope.steamAccessDirectWebApiEnabled,
    steamAccessGatewayEnabled: scope.steamAccessGatewayEnabled,
    shouldUseSteamAccessGateway: scope.shouldUseSteamAccessGateway,
    requestBySteamAccessGateway: gateway.request.bind(gateway),
    requestStreamBySteamAccessGateway: gateway.requestStream.bind(gateway),
    chooseSteamAccessRoute: scope.chooseSteamAccessRoute,
    removeSteamAccessCachedIp: scope.removeSteamAccessCachedIp,
    steamAccessPolicyForHost: scope.steamAccessPolicyForHost,
  });
  scope.GET = scope.STEAM_PROXY_HANDLERS.get;
  scope.POST = scope.STEAM_PROXY_HANDLERS.post;
  scope.doRequest = scope.STEAM_PROXY_HANDLERS.doRequest;
  scope.getProxyCandidates = scope.STEAM_PROXY_HANDLERS.getProxyCandidates;
  scope.wallhubProxyUpstreamCookie = scope.STEAM_PROXY_HANDLERS.upstreamCookie;
  scope.isWallhubProxyVirtualSteamPath = scope.STEAM_PROXY_HANDLERS.isWallhubProxyVirtualSteamPath;
}

module.exports = { assembleSteamAccessServices };
