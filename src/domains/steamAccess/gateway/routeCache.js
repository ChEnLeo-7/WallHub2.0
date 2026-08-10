'use strict';

const net = require('net');
const { fixedSniForHost, requestBudgetForHost } = require('../routes');

function createGatewayRouteCache(options = {}) {
  const currentMode = options.currentMode;
  const getResolverProtocol = options.getResolverProtocol;
  const policyFactory = options.policyFactory;
  const routeStore = options.routeStore;
  const isStaticCdnHost = options.isStaticCdnHost;
  const connectionPool = options.connectionPool;
  const routeCache = new Map();
  const routeBuildPromises = new Map();
  let lastRoute = null;

  function cacheKey(hostname, port) {
    return `${currentMode()}:${String(hostname || '').toLowerCase()}:${port || 443}`;
  }

  function clear(modes) {
    const filter = Array.isArray(modes) && modes.length ? new Set(modes) : null;
    for (const key of Array.from(routeCache.keys())) {
      if (!filter) {
        routeCache.delete(key);
        continue;
      }
      for (const mode of filter) {
        if (key.startsWith(`${mode}:`)) routeCache.delete(key);
      }
    }
    for (const key of Array.from(routeBuildPromises.keys())) {
      if (!filter) {
        routeBuildPromises.delete(key);
        continue;
      }
      for (const mode of filter) {
        if (key.startsWith(`${mode}:`)) routeBuildPromises.delete(key);
      }
    }
    lastRoute = null;
    connectionPool.clear();
  }

  function removeCachedIp(hostname, port, ip) {
    const key = cacheKey(hostname, port);
    const entry = routeCache.get(key);
    if (entry) {
      entry.ips = (entry.ips || []).filter(item => item !== ip);
      entry.ip = entry.ips[0] || '';
      if (!entry.ip) routeCache.delete(key);
    }
  }

  function buildRoute(hostname, port, data = {}) {
    const policy = data.policy || policyFactory.forHost(hostname, data.routeOptions || {});
    const primarySni = data.sniStrategy || (policy.sniStrategies && policy.sniStrategies[0]) || fixedSniForHost(hostname);
    const route = {
      hostname: String(hostname || '').toLowerCase(),
      port: port || 443,
      ip: data.ip || '',
      ips: Array.isArray(data.ips) ? data.ips.slice() : (data.ip ? [data.ip] : []),
      source: data.source || '',
      mode: currentMode(),
      resolverProtocol: data.resolverProtocol || getResolverProtocol(),
      resolverEndpoint: data.resolverEndpoint || '',
      resolverEndpoints: Array.isArray(data.resolverEndpoints) ? data.resolverEndpoints.slice() : [],
      dohEndpoint: data.resolverEndpoint || '',
      dohEndpoints: Array.isArray(data.resolverEndpoints) ? data.resolverEndpoints.slice() : [],
      candidates: Number(data.candidates || 0),
      reachable: Number(data.reachable || 0),
      readiness: data.readiness || 'ready',
      updatedAt: Date.now(),
      resolverHealth: Array.isArray(data.resolverHealth) ? data.resolverHealth.slice() : [],
      policy,
      sniStrategies: Array.isArray(policy.sniStrategies) ? policy.sniStrategies.slice() : [],
      sniMode: data.sniMode || primarySni.mode || primarySni.type || 'hidden',
      sniHostname: data.sniHostname || primarySni.hostname || '',
      hiddenSni: Object.prototype.hasOwnProperty.call(data, 'hiddenSni') ? !!data.hiddenSni : (primarySni.mode || primarySni.type) === 'hidden',
    };
    routeCache.set(cacheKey(hostname, port), route);
    lastRoute = route;
    return route;
  }

  function cachedRouteRecordAllowed(record, now, routeOptions = {}) {
    if (!record || !record.ip) return false;
    if (record.cooldownUntil && record.cooldownUntil > now) return false;
    if (routeOptions.requireApplicationProbe) {
      const hasApplicationProbe = String(record.probeLevel || '').toLowerCase() === 'application';
      const hasActualRequest = Number(record.requestOk || 0) > 0 && Number(record.lastRequestOkAt || 0) > 0;
      if (!hasApplicationProbe && !hasActualRequest) return false;
      if (!record.lastOkAt || Number(record.ok || 0) <= 0 || Number(record.consecutiveFail || 0) > 0) return false;
      const maxAgeMs = Math.max(30_000, Number(routeOptions.maxAgeMs || 10 * 60 * 1000));
      if (now - Number(record.lastOkAt || 0) > maxAgeMs) return false;
      if (!hasApplicationProbe && hasActualRequest && now - Number(record.lastRequestOkAt || 0) > maxAgeMs) return false;
    }
    return record.ok > 0 || record.source === 'history';
  }

  function buildCachedRouteFromPool(hostname, port, routeOptions = {}) {
    const host = String(hostname || '').toLowerCase();
    if (!host || currentMode() !== 'resolver') return null;
    const snapshot = routeStore.snapshot(host);
    const policy = policyFactory.forHost(host);
    const now = Date.now();
    const scoreCachedRecord = (record) => {
      const ipv6Bonus = net.isIP(record.ip) === 6 && Number(record.ok || 0) > 0 ? 250 : 0;
      const appProbeBonus = String(record.probeLevel || '').toLowerCase() === 'application' && Number(record.ok || 0) > 0 ? 180 : 0;
      const recentBonus = record.lastOkAt ? Math.max(0, 200 - Math.floor((now - record.lastOkAt) / 60_000)) : 0;
      const requestBonus = Number(record.requestOk || 0) > 0 ? 1200 + Math.min(500, Number(record.requestOk || 0) * 80) : 0;
      const requestRecentBonus = record.lastRequestOkAt ? Math.max(0, 400 - Math.floor((now - record.lastRequestOkAt) / 30_000)) : 0;
      const bestRtt = Number(record.requestRttMs || 0) > 0 ? Number(record.requestRttMs || 0) : Number(record.rttMs || 0);
      const rttPenalty = bestRtt ? Math.min(300, Math.floor(bestRtt / 10)) : 80;
      return Number(record.ok || 0) * 100 + requestBonus + requestRecentBonus + ipv6Bonus + appProbeBonus + recentBonus - Number(record.consecutiveFail || 0) * 150 - rttPenalty;
    };
    const records = (snapshot.ips || [])
      .filter(item => cachedRouteRecordAllowed(item, now, routeOptions))
      .sort((a, b) => scoreCachedRecord(b) - scoreCachedRecord(a));
    if (!records.length) return null;
    const budget = requestBudgetForHost(host, isStaticCdnHost);
    const ips = records
      .map(item => String(item.ip || '').trim())
      .filter(Boolean)
      .slice(0, Math.max(budget.maxIps * 3, budget.minPoolSize || 4));
    if (!ips.length) return null;
    return buildRoute(host, port || 443, {
      ip: ips[0],
      ips,
      source: routeOptions.requireApplicationProbe ? 'ip-pool-application-cache' : 'ip-pool-cache',
      resolverProtocol: getResolverProtocol(),
      candidates: records.length,
      reachable: records.length,
      readiness: 'ready',
      resolverHealth: [],
      policy,
    });
  }

  return {
    cacheKey,
    clear,
    removeCachedIp,
    buildRoute,
    buildCachedRouteFromPool,
    get: key => routeCache.get(key),
    values: () => Array.from(routeCache.values()),
    getLastRoute: () => lastRoute,
    getBuildPromise: key => routeBuildPromises.get(key),
    hasBuildPromise: key => routeBuildPromises.has(key),
    setBuildPromise: (key, promise) => routeBuildPromises.set(key, promise),
    deleteBuildPromise: key => routeBuildPromises.delete(key),
  };
}

module.exports = { createGatewayRouteCache };
