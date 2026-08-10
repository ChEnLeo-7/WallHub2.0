'use strict';

const { parseHostsText } = require('../hostsCompat');

function createGatewaySnapshots(options = {}) {
  const currentMode = options.currentMode;
  const getResolverProtocol = options.getResolverProtocol;
  const getDohEndpoint = options.getDohEndpoint;
  const getDotEndpoint = options.getDotEndpoint;
  const getHostsText = options.getHostsText;
  const getHostsLastUpdatedAt = options.getHostsLastUpdatedAt;
  const getHostsLastError = options.getHostsLastError;
  const getHostsNextUpdateAt = options.getHostsNextUpdateAt;
  const directWebApi = options.directWebApi;
  const enabled = options.enabled;
  const endpointSelectors = options.endpointSelectors;
  const resolver = options.resolver;
  const routeCache = options.routeCache;
  const routeStore = options.routeStore;
  const metrics = options.metrics;
  const connectionPool = options.connectionPool;
  const probeQueue = options.probeQueue;
  const debugLogger = options.debugLogger;
  const cdnIpDatabase = options.cdnIpDatabase;
  const getEchSnapshot = options.getEchSnapshot;
  let runtimeHostsText = null;
  let runtimeHostsEntryCount = 0;

  function cachedRuntimeHostsEntryCount() {
    const hostsText = getHostsText();
    if (hostsText !== runtimeHostsText) {
      runtimeHostsText = hostsText;
      runtimeHostsEntryCount = parseHostsText(hostsText).size;
    }
    return runtimeHostsEntryCount;
  }

  function compactRoute(route) {
    return route ? {
      hostname: route.hostname,
      port: route.port,
      ip: route.ip,
      source: route.source,
      resolverProtocol: route.resolverProtocol,
      resolverEndpoint: route.resolverEndpoint,
      updatedAt: route.updatedAt,
      sniMode: route.sniMode,
    } : null;
  }

  function detailedRoute(route) {
    return route ? {
      hostname: route.hostname,
      port: route.port,
      ip: route.ip,
      ips: route.ips,
      source: route.source,
      resolverProtocol: route.resolverProtocol,
      resolverEndpoint: route.resolverEndpoint,
      resolverEndpoints: route.resolverEndpoints,
      candidates: route.candidates,
      reachable: route.reachable,
      updatedAt: route.updatedAt,
      sniMode: route.sniMode,
      sniHostname: route.sniHostname,
      sniStrategies: route.sniStrategies,
      policy: route.policy,
    } : null;
  }

  function hostsSnapshot(mode, cached) {
    return {
      entries: mode === 'hosts' ? (cached ? cachedRuntimeHostsEntryCount() : parseHostsText(getHostsText()).size) : 0,
      lastUpdatedAt: getHostsLastUpdatedAt(),
      lastError: getHostsLastError(),
      nextUpdateAt: getHostsNextUpdateAt(),
    };
  }

  function webapiPoolSnapshot() {
    const pool = routeStore.snapshot('api.steampowered.com');
    return {
      host: pool.host,
      active: pool.active,
      cooling: pool.cooling,
      fastest: pool.fastest,
      rttMs: pool.rttMs,
      lastRefreshAt: pool.lastRefreshAt,
      nextRefreshAt: pool.nextRefreshAt,
      lastError: pool.lastError,
      direct: !!directWebApi(),
    };
  }

  function runtimeSnapshot() {
    const mode = currentMode();
    const protocol = mode === 'hosts' ? 'hosts' : getResolverProtocol();
    const current = compactRoute(routeCache.getLastRoute());
    const hosts = hostsSnapshot(mode, true);
    const webapi = webapiPoolSnapshot();
    return {
      enabled: enabled(),
      mode,
      resolverProtocol: protocol,
      resolverEndpoint: protocol === 'dot' ? getDotEndpoint() : protocol === 'hosts' ? '' : getDohEndpoint(),
      hosts,
      webapiPool: webapi,
      current,
      updatedAt: Math.max(
        Number(current && current.updatedAt || 0),
        Number(webapi.lastRefreshAt || 0),
        Number(hosts.lastUpdatedAt || 0),
      ),
    };
  }

  function statusSnapshot() {
    const mode = currentMode();
    const protocol = mode === 'hosts' ? 'hosts' : getResolverProtocol();
    const endpoints = resolver.resolveSelectedEndpoints(getResolverProtocol(), endpointSelectors());
    const routes = routeCache.values().slice(-8).map(detailedRoute);
    const current = detailedRoute(routeCache.getLastRoute());
    const pool = routeStore.snapshot('api.steampowered.com');
    const routeHosts = Array.from(new Set(routes.map(route => route.hostname).filter(Boolean).concat(current ? [current.hostname] : [])));
    const cdnSnapshot = cdnIpDatabase.snapshot();
    const connections = connectionPool.snapshot();
    return {
      enabled: enabled(),
      mode,
      resolverProtocol: protocol,
      resolverEndpoint: protocol === 'dot' ? getDotEndpoint() : protocol === 'hosts' ? '' : getDohEndpoint(),
      resolverEndpoints: endpoints,
      resolverHealth: routeCache.getLastRoute() && Array.isArray(routeCache.getLastRoute().resolverHealth) ? routeCache.getLastRoute().resolverHealth : [],
      policy: routeCache.getLastRoute() && routeCache.getLastRoute().policy ? routeCache.getLastRoute().policy : null,
      metrics: metrics.snapshot(),
      connectionPool: connections,
      probeQueue: probeQueue.snapshot(),
      debugLog: debugLogger.snapshot(),
      hosts: {
        entries: parseHostsText(getHostsText()).size,
        lastUpdatedAt: getHostsLastUpdatedAt(),
        lastError: getHostsLastError(),
        nextUpdateAt: getHostsNextUpdateAt(),
      },
      webapiPool: {
        host: pool.host,
        active: pool.active,
        cooling: pool.cooling,
        fastest: pool.fastest,
        rttMs: pool.rttMs,
        lastRefreshAt: pool.lastRefreshAt,
        nextRefreshAt: pool.nextRefreshAt,
        lastError: pool.lastError,
        akamaiCidrMatched: 0,
        suspectDnsAnswers: pool.ips.filter(item => item.suspect).length,
        direct: !!directWebApi(),
        cdnDatabaseUpdatedAt: cdnSnapshot.updatedAt || 0,
        cdnDatabaseSource: cdnSnapshot.source || '',
        connections: (connectionPool.snapshot().connections || []).filter(item => item.host === 'api.steampowered.com' || item.host === 'community.steam-api.com'),
        ech: getEchSnapshot(),
      },
      candidatePools: routeHosts.map(host => routeStore.snapshot(host)),
      current,
      routes,
    };
  }

  function diagnosticSnapshot() {
    const status = statusSnapshot();
    const hosts = Array.from(new Set([
      'steamcommunity.com',
      'api.steampowered.com',
      'community.steam-api.com',
      ...(status.routes || []).map(route => route.hostname).filter(Boolean),
    ]));
    return {
      generatedAt: Date.now(),
      enabled: status.enabled,
      mode: status.mode,
      resolverProtocol: status.resolverProtocol,
      resolverEndpoints: status.resolverEndpoints,
      resolverHealth: status.resolverHealth,
      webapiPool: status.webapiPool,
      metrics: status.metrics,
      connectionPool: status.connectionPool,
      probeQueue: status.probeQueue,
      debugLog: status.debugLog,
      current: status.current,
      routes: status.routes,
      hosts: hosts.map(host => routeStore.snapshot(host)),
      policy: status.policy,
      notes: [
        'cookies, API keys and request bodies are not included',
        'host/ip/SNI/protocol data is included for troubleshooting',
      ],
    };
  }

  return { runtimeSnapshot, statusSnapshot, diagnosticSnapshot };
}

module.exports = { createGatewaySnapshots };
