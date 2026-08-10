'use strict';

const {
  DEFAULT_STEAM_ACCESS_DOH_ENDPOINT,
  DEFAULT_STEAM_ACCESS_DOT_ENDPOINT,
  STEAM_ACCESS_DOH_ENDPOINTS,
  STEAM_ACCESS_DOT_ENDPOINTS,
  normalizeSteamAccessDohEndpoint,
  normalizeSteamAccessDotEndpoint,
  normalizeSteamAccessMode,
  normalizeSteamAccessResolverProtocol,
  normalizeSteamAccessResolverMode,
  normalizeSteamAccessEndpointList,
} = require('../../config/normalizers');
const { resolveHostsText } = require('./resolver/hosts');
const {
  DEFAULT_WARMUP_HOSTS,
  DEFAULT_CDN_WARMUP_HOSTS,
  shouldProbeSteamAccessIpv6,
} = require('./routes');
const { createResolver } = require('./resolver/index');
const { createProbe } = require('./probe');
const { createIpPool } = require('./ipPool');
const { createCdnIpDatabase } = require('./cdnIpDatabase');
const { createSteamAccessPolicyFactory } = require('./policy');
const { createSteamAccessMetrics } = require('./metrics');
const { createSteamAccessConnectionPool } = require('./connectionPool');
const { createSteamAccessForwarder } = require('./forwarder');
const { createRouteStore } = require('./routeStore');
const { createProbeQueue } = require('./probeQueue');
const { createSteamAccessDebugLogger } = require('./debugLogger');
const { createGatewayRouteCache } = require('./gateway/routeCache');
const { createGatewayRouteSelection } = require('./gateway/routeSelection');
const { createGatewayWarmup } = require('./gateway/warmup');
const { createGatewaySnapshots } = require('./gateway/snapshots');
const { createGatewayRequests } = require('./gateway/requests');

function createSteamAccessGateway(options = {}) {
  const logger = options.logger || console;
  const ua = options.userAgent || 'WallHub';
  const enabled = typeof options.enabled === 'function' ? options.enabled : () => false;
  const directWebApi = typeof options.directWebApi === 'function' ? options.directWebApi : () => !!options.directWebApi;
  const isGatewayHost = typeof options.isGatewayHost === 'function' ? options.isGatewayHost : () => false;
  const isStaticCdnHost = typeof options.isStaticCdnHost === 'function' ? options.isStaticCdnHost : () => false;
  const configDir = options.configDir || process.cwd();
  const warmupHosts = Array.isArray(options.warmupHosts) && options.warmupHosts.length ? options.warmupHosts : DEFAULT_WARMUP_HOSTS;
  const cdnWarmupHosts = Array.isArray(options.cdnWarmupHosts) && options.cdnWarmupHosts.length ? options.cdnWarmupHosts : DEFAULT_CDN_WARMUP_HOSTS;
  const getAccessMode = typeof options.getAccessMode === 'function'
    ? () => normalizeSteamAccessMode(options.getAccessMode())
    : () => 'resolver';
  const getHostsText = typeof options.getHostsText === 'function'
    ? () => String(options.getHostsText() || '')
    : () => '';
  const getResolverProtocol = typeof options.getResolverProtocol === 'function'
    ? () => normalizeSteamAccessResolverProtocol(options.getResolverProtocol())
    : () => 'doh';
  const getDohEndpoint = typeof options.getDohEndpoint === 'function'
    ? () => normalizeSteamAccessDohEndpoint(options.getDohEndpoint())
    : () => normalizeSteamAccessDohEndpoint(options.dohEndpoint || DEFAULT_STEAM_ACCESS_DOH_ENDPOINT);
  const getDotEndpoint = typeof options.getDotEndpoint === 'function'
    ? () => normalizeSteamAccessDotEndpoint(options.getDotEndpoint())
    : () => normalizeSteamAccessDotEndpoint(options.dotEndpoint || DEFAULT_STEAM_ACCESS_DOT_ENDPOINT);
  const getDohMode = typeof options.getDohMode === 'function'
    ? () => normalizeSteamAccessResolverMode(options.getDohMode())
    : () => 'fastest';
  const getDotMode = typeof options.getDotMode === 'function'
    ? () => normalizeSteamAccessResolverMode(options.getDotMode())
    : () => 'fastest';
  const getSelectedDohEndpoints = typeof options.getSelectedDohEndpoints === 'function'
    ? () => normalizeSteamAccessEndpointList(options.getSelectedDohEndpoints(), 'doh')
    : () => normalizeSteamAccessEndpointList(options.selectedDohEndpoints, 'doh');
  const getCustomDohEndpoints = typeof options.getCustomDohEndpoints === 'function'
    ? () => normalizeSteamAccessEndpointList(options.getCustomDohEndpoints(), 'doh', { limit: 32 })
    : () => normalizeSteamAccessEndpointList(options.customDohEndpoints, 'doh', { limit: 32 });
  const getSelectedDotEndpoints = typeof options.getSelectedDotEndpoints === 'function'
    ? () => normalizeSteamAccessEndpointList(options.getSelectedDotEndpoints(), 'dot')
    : () => normalizeSteamAccessEndpointList(options.selectedDotEndpoints, 'dot');
  const getCustomDotEndpoints = typeof options.getCustomDotEndpoints === 'function'
    ? () => normalizeSteamAccessEndpointList(options.getCustomDotEndpoints(), 'dot', { limit: 32 })
    : () => normalizeSteamAccessEndpointList(options.customDotEndpoints, 'dot', { limit: 32 });
  const getHostsLastUpdatedAt = typeof options.getHostsLastUpdatedAt === 'function'
    ? () => Number(options.getHostsLastUpdatedAt() || 0)
    : () => Number(options.hostsLastUpdatedAt || 0);
  const getHostsLastError = typeof options.getHostsLastError === 'function'
    ? () => String(options.getHostsLastError() || '')
    : () => String(options.hostsLastError || '');
  const getHostsNextUpdateAt = typeof options.getHostsNextUpdateAt === 'function'
    ? () => Number(options.getHostsNextUpdateAt() || 0)
    : () => Number(options.hostsNextUpdateAt || 0);
  const getExperimental = typeof options.getExperimental === 'function'
    ? () => options.getExperimental() || {}
    : () => options.experimental || {};

  function currentMode() {
    return normalizeSteamAccessMode(getAccessMode());
  }

  function endpointSelectors() {
    return {
      dohEndpoint: getDohEndpoint(),
      dohMode: getDohMode(),
      selectedDohEndpoints: getSelectedDohEndpoints(),
      customDohEndpoints: getCustomDohEndpoints(),
      dotEndpoint: getDotEndpoint(),
      dotMode: getDotMode(),
      selectedDotEndpoints: getSelectedDotEndpoints(),
      customDotEndpoints: getCustomDotEndpoints(),
    };
  }

  const debugLogger = createSteamAccessDebugLogger({
    logger,
    configDir,
    filePath: options.debugLogFile,
    enabled: () => !!getExperimental().verboseNetworkLogs || process.env.WALLHUB_STEAM_ACCESS_DEBUG_LOG === '1',
  });
  const policyFactory = createSteamAccessPolicyFactory({
    enabled,
    directWebApi,
    isGatewayHost,
    isStaticCdnHost,
    reuseConnectionForHost: options.reuseConnectionForHost,
    getMode: getAccessMode,
    getResolverProtocol,
    getExperimental,
  });
  const resolver = createResolver({
    userAgent: ua,
    timeoutMs: options.testTimeoutMs || 2500,
    dohEndpoints: options.dohEndpoints || STEAM_ACCESS_DOH_ENDPOINTS,
    dotEndpoints: options.dotEndpoints || STEAM_ACCESS_DOT_ENDPOINTS,
    verboseNetworkLogs: () => !!getExperimental().verboseNetworkLogs,
    debugLogger,
    logger: debugLogger,
  });
  const probe = createProbe({ userAgent: ua, logger: debugLogger });
  const ipPool = createIpPool({
    configDir,
    logger: debugLogger,
    persistenceEnabled: options.persistentState !== false,
  });
  ipPool.load();
  const routeStore = createRouteStore({ ipPool });
  const metrics = createSteamAccessMetrics();
  const connectionPool = createSteamAccessConnectionPool({
    logger: debugLogger,
    onConnectionFailure: (host, ip, error, meta) => {
      if (!host || !ip) return;
      routeStore.feedbackFailure(host, ip, error, meta);
    },
  });
  const probeQueue = createProbeQueue({ probe, routeStore, logger: debugLogger });
  const cdnIpDatabase = createCdnIpDatabase({
    configDir,
    logger: debugLogger,
    acceleratorMode: options.githubAcceleratorMode || options.acceleratorMode,
  });
  cdnIpDatabase.load();
  const routeCache = createGatewayRouteCache({
    currentMode,
    getResolverProtocol,
    policyFactory,
    routeStore,
    isStaticCdnHost,
    connectionPool,
  });
  const routeSelection = createGatewayRouteSelection({
    currentMode,
    getHostsText,
    getResolverProtocol,
    getExperimental,
    endpointSelectors,
    isStaticCdnHost,
    resolver,
    resolveHostsText,
    probe,
    routeStore,
    policyFactory,
    metrics,
    probeQueue,
    cdnIpDatabase,
    routeCache,
    debugLogger,
  });
  const forwarder = createSteamAccessForwarder({
    chooseRoute: routeSelection.chooseRoute,
    connectionPool,
    metrics,
    logger: debugLogger,
    debugLogger,
    verboseNetworkLogs: () => !!getExperimental().verboseNetworkLogs,
    markSuccess: (host, ip, meta) => routeStore.feedbackSuccess(host, ip, meta),
    markFailure: (host, ip, error, meta) => {
      routeStore.feedbackFailure(host, ip, error, meta);
      routeCache.removeCachedIp(host, 443, ip);
    },
  });
  const requests = createGatewayRequests({ forwarder });
  const warmup = createGatewayWarmup({
    enabled,
    currentMode,
    warmupHosts,
    cdnWarmupHosts,
    routeCache,
    chooseRoute: routeSelection.chooseRoute,
    connectionPool,
    debugLogger,
  });
  const snapshots = createGatewaySnapshots({
    currentMode,
    getResolverProtocol,
    getDohEndpoint,
    getDotEndpoint,
    getHostsText,
    getHostsLastUpdatedAt,
    getHostsLastError,
    getHostsNextUpdateAt,
    directWebApi,
    enabled,
    endpointSelectors,
    resolver,
    routeCache,
    routeStore,
    metrics,
    connectionPool,
    probeQueue,
    debugLogger,
    cdnIpDatabase,
    getEchSnapshot: routeSelection.getEchSnapshot,
  });

  return {
    getDohEndpoint,
    getDotEndpoint,
    getResolverProtocol,
    getDohMode,
    getDotMode,
    getSelectedDohEndpoints,
    getSelectedDotEndpoints,
    resolveHost: routeSelection.resolveForHost,
    chooseRoute: routeSelection.chooseRoute,
    removeCachedIp: routeCache.removeCachedIp,
    clear: routeCache.clear,
    runtimeSnapshot: snapshots.runtimeSnapshot,
    statusSnapshot: snapshots.statusSnapshot,
    diagnosticSnapshot: snapshots.diagnosticSnapshot,
    policyForHost: policyFactory.forHost,
    warmup: warmup.warmup,
    warmupCore: warmup.warmupCore,
    warmupControlPlane: warmup.warmupControlPlane,
    warmupCdnBackground: warmup.warmupCdnBackground,
    ensureReady: warmup.ensureReady,
    isWarmingUp: warmup.isWarmingUp,
    logResolvedRoutes: warmup.logResolvedRoutes,
    shouldUse: policyFactory.shouldUse,
    request: requests.request,
    requestStream: requests.requestStream,
    cdnIpDatabase,
    ipPool,
    routeStore,
    logger: debugLogger,
  };
}

module.exports = {
  DEFAULT_STEAM_ACCESS_DOH_ENDPOINT,
  DEFAULT_STEAM_ACCESS_DOT_ENDPOINT,
  STEAM_ACCESS_DOH_ENDPOINTS,
  STEAM_ACCESS_DOT_ENDPOINTS,
  shouldProbeSteamAccessIpv6,
  normalizeSteamAccessDohEndpoint,
  normalizeSteamAccessDotEndpoint,
  createSteamAccessGateway,
};
