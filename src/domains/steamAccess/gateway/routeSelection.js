'use strict';

const net = require('net');
const {
  fixedSniForHost,
  isCoreHost,
  shouldHttpProbeHost,
} = require('../routes');

function createGatewayRouteSelection(options = {}) {
  const currentMode = options.currentMode;
  const getHostsText = options.getHostsText;
  const getResolverProtocol = options.getResolverProtocol;
  const getExperimental = options.getExperimental;
  const endpointSelectors = options.endpointSelectors;
  const isStaticCdnHost = options.isStaticCdnHost;
  const resolveHostsText = options.resolveHostsText;
  const resolver = options.resolver;
  const probe = options.probe;
  const routeStore = options.routeStore;
  const policyFactory = options.policyFactory;
  const metrics = options.metrics;
  const probeQueue = options.probeQueue;
  const cdnIpDatabase = options.cdnIpDatabase;
  const routeCache = options.routeCache;
  const debugLogger = options.debugLogger;
  let cdnRefreshPromise = null;
  let echSnapshot = { host: 'api.steampowered.com', echSupported: false, checkedAt: 0, answers: [] };

  function isSteamWebApiHost(hostname) {
    const host = String(hostname || '').trim().toLowerCase();
    return host === 'api.steampowered.com' || host === 'community.steam-api.com';
  }

  function refreshCdnDatabaseSoon() {
    if (cdnRefreshPromise) return cdnRefreshPromise;
    const snapshot = cdnIpDatabase.snapshot();
    const stale = !snapshot.updatedAt || Date.now() - snapshot.updatedAt > 24 * 60 * 60 * 1000;
    if (!stale && snapshot.cidrs && snapshot.cidrs.length) return Promise.resolve(snapshot);
    cdnRefreshPromise = cdnIpDatabase.refresh().catch((error) => {
      debugLogger.warn('[SteamAccess] CDN database refresh failed:', error.message);
      return cdnIpDatabase.snapshot();
    }).finally(() => { cdnRefreshPromise = null; });
    return cdnRefreshPromise;
  }

  async function resolveForHost(hostname, resolveOptions = {}) {
    const host = String(hostname || '').toLowerCase();
    const startedAt = Date.now();
    if (currentMode() === 'hosts' && resolveOptions.forceResolver !== true) {
      const result = resolveHostsText(getHostsText(), host);
      metrics.recordResolve(host, result, Date.now() - startedAt);
      return result;
    }
    const protocol = getResolverProtocol();
    const policy = policyFactory.forHost(host);
    const targets = [host].concat(policy.edgeAliases || []);
    const merged = { ips: [], answers: [], endpoints: [], protocol, source: policy.edgeAliases.length ? 'resolver-multi-source' : 'resolver', resolverHealth: [] };
    const seen = new Set();
    const results = await Promise.all(targets.map(target => resolver.resolveHost(target, Object.assign({
      protocol,
      includeIpv6: policy.preferredFamilies.includes(6),
      minIps: policy.requestBudget.minPoolSize || 8,
    }, endpointSelectors())).then(result => ({ target, result }))));
    for (const { target, result } of results) {
      for (const ip of result.ips || []) {
        if (seen.has(ip)) continue;
        seen.add(ip);
        merged.ips.push(ip);
      }
      for (const answer of result.answers || []) merged.answers.push(Object.assign({ resolvedHost: target }, answer));
      for (const endpoint of result.endpoints || []) if (!merged.endpoints.includes(endpoint)) merged.endpoints.push(endpoint);
      if (!merged.resolverHealth.length) merged.resolverHealth = result.resolverHealth || [];
    }
    metrics.recordResolve(host, merged, Date.now() - startedAt);
    if (getExperimental().verboseNetworkLogs) {
      const ipv4 = merged.ips.filter(ip => net.isIP(ip) === 4).length;
      const ipv6 = merged.ips.filter(ip => net.isIP(ip) === 6).length;
      debugLogger.log(`[SteamAccess:net] resolve merged host=${host} targets=${targets.join(',')} ips=${merged.ips.length} ipv6=${ipv6} ipv4=${ipv4} endpoints=${merged.endpoints.join(',')}`);
    }
    return Object.assign(merged, { resolverHost: targets.join(','), policy });
  }

  function refreshEchDiagnostics(host) {
    if (!host || currentMode() !== 'resolver' || getResolverProtocol() !== 'doh') return;
    if (typeof resolver.resolveEch !== 'function') {
      echSnapshot = { host, echSupported: false, checkedAt: Date.now(), answers: [], error: 'ech-diagnostics-unavailable' };
      return;
    }
    resolver.resolveEch(host, Object.assign({ protocol: 'doh' }, endpointSelectors())).then((result) => {
      echSnapshot = {
        host,
        echSupported: !!(result && result.echSupported),
        checkedAt: Date.now(),
        answers: Array.isArray(result && result.answers) ? result.answers.slice(0, 3) : [],
      };
    }).catch((error) => {
      echSnapshot = { host, echSupported: false, checkedAt: Date.now(), answers: [], error: error.message };
    });
  }

  function mergeCandidates(hostname, resolved) {
    const host = String(hostname || '').toLowerCase();
    const resolvedIps = Array.isArray(resolved && resolved.ips) ? resolved.ips : [];
    routeStore.mergeResolved(host, resolvedIps, 'resolver');
    const candidates = routeStore.prioritized(host, resolvedIps).map((record) => {
      const cidr = isSteamWebApiHost(host) ? cdnIpDatabase.matchIp(record.ip) : { matched: undefined, suspect: false };
      return Object.assign({}, record, {
        suspect: !!(cidr && cidr.suspect),
        akamaiCidrMatched: cidr && typeof cidr.matched === 'boolean' ? cidr.matched : undefined,
      });
    });
    const active = routeStore.candidates(host, resolvedIps);
    return { candidates, active };
  }

  async function probeAndRank(hostname, port, candidates) {
    const host = String(hostname || '').toLowerCase();
    const policy = policyFactory.forHost(host);
    const budget = policy.requestBudget;
    const sni = policy.sniStrategies[0] || fixedSniForHost(host);
    const requireHttp = shouldHttpProbeHost(host, isStaticCdnHost);
    const sniLabel = (sni.type === 'fake' || sni.mode === 'custom') ? (sni.hostname || 'fake') : (sni.type || sni.mode || 'hidden');
    if (getExperimental().verboseNetworkLogs) debugLogger.log(`[SteamAccess:net] probe start host=${host} candidates=${candidates.length} sni=${sniLabel} level=${requireHttp ? 'application' : 'tls'}`);
    const ranked = await probe.rankIps(host, candidates.map(item => item.ip), port || 443, sni, {
      limit: Math.max(budget.maxIps * 3, budget.minPoolSize || 4),
      timeoutMs: budget.perIpTimeoutMs,
      requireHttp,
      probeLevel: requireHttp ? 'application' : 'tls',
    });
    const rankedMap = new Map(ranked.map(item => [item.ip, item]));
    for (const candidate of candidates) {
      const result = rankedMap.get(candidate.ip);
      if (!result) continue;
      if (result.ok) {
        routeStore.feedbackSuccess(host, candidate.ip, {
          source: candidate.source,
          rttMs: result.rttMs,
          probeLevel: requireHttp ? 'application' : 'tls',
          suspect: !!candidate.suspect,
          akamaiCidrMatched: candidate.akamaiCidrMatched,
        });
      } else {
        routeStore.feedbackFailure(host, candidate.ip, `${requireHttp ? 'http' : 'tls'}-probe-failed`, { stage: requireHttp ? 'http' : 'tls', probeLevel: requireHttp ? 'application' : 'tls' });
      }
    }
    metrics.recordProbe(host, candidates.length, ranked.filter(item => item.ok).length, requireHttp ? 'application' : 'tls');
    if (getExperimental().verboseNetworkLogs) debugLogger.log(`[SteamAccess:net] probe done host=${host} ok=${ranked.filter(item => item.ok).length}/${ranked.length} level=${requireHttp ? 'application' : 'tls'}`);
    for (const item of ranked.filter(candidate => candidate.ok).slice(0, 2)) {
      probeQueue.enqueue({ host, ip: item.ip, port: port || 443, sni, timeoutMs: budget.perIpTimeoutMs, application: requireHttp });
    }
    return ranked;
  }

  async function buildFreshRoute(host, targetPort, routeOptions = {}) {
    if (!policyFactory.forHost(host, routeOptions).enhanceEnabled) return null;
    if (isSteamWebApiHost(host)) refreshCdnDatabaseSoon().catch(() => {});
    const resolved = await resolveForHost(host);
    if (isSteamWebApiHost(host)) refreshEchDiagnostics(host);
    const policy = policyFactory.forHost(host);
    if (!policyFactory.forHost(host, routeOptions).enhanceEnabled) return null;
    const budget = policy.requestBudget;
    if (currentMode() === 'hosts') {
      if (!resolved.ips.length) return null;
      return routeCache.buildRoute(host, targetPort, {
        ip: resolved.ips[0],
        ips: resolved.ips,
        source: resolved.source,
        resolverProtocol: 'hosts',
        resolverEndpoint: resolved.endpoints[0] || '',
        resolverEndpoints: resolved.endpoints || [],
        candidates: resolved.ips.length,
        reachable: resolved.ips.length,
        readiness: 'ready',
        policy,
      });
    }
    const merged = mergeCandidates(host, resolved);
    const ranked = await probeAndRank(host, targetPort, merged.active);
    const okIps = ranked.filter(item => item.ok).map(item => item.ip);
    const rankedOk = ranked.filter(item => item.ok).sort((a, b) => {
      const familyDelta = (net.isIP(b.ip) === 6 ? 1 : 0) - (net.isIP(a.ip) === 6 ? 1 : 0);
      return familyDelta || (a.rttMs || 999999) - (b.rttMs || 999999);
    }).map(item => item.ip);
    const ordered = rankedOk.concat(merged.active.map(item => item.ip).filter(ip => !okIps.includes(ip))).slice(0, Math.max(budget.maxIps * 3, budget.minPoolSize || 4));
    if (!ordered.length) return null;
    routeStore.updateRefreshMeta(host, {
      lastRefreshAt: Date.now(),
      nextRefreshAt: Date.now() + (budget.refreshIntervalMs || 10 * 60 * 1000),
      lastError: okIps.length ? '' : 'no reachable ip',
      targetMin: budget.minPoolSize || (isCoreHost(host) ? 10 : 4),
    });
    return routeCache.buildRoute(host, targetPort, {
      ip: ordered[0],
      ips: ordered,
      source: resolved.source,
      resolverProtocol: resolved.protocol || getResolverProtocol(),
      resolverEndpoint: resolved.endpoints && resolved.endpoints[0] || '',
      resolverEndpoints: resolved.endpoints || [],
      candidates: merged.active.length,
      reachable: okIps.length,
      readiness: okIps.length ? 'ready' : 'degraded',
      resolverHealth: resolved.resolverHealth || [],
      policy,
    });
  }

  function withPolicy(route, policy) {
    const primarySni = policy.sniStrategies && policy.sniStrategies[0] || {};
    return Object.assign({}, route, {
      policy,
      sniStrategies: policy.sniStrategies,
      sniMode: primarySni.mode || primarySni.type || route.sniMode,
      sniHostname: primarySni.hostname || '',
      hiddenSni: (primarySni.mode || primarySni.type || route.sniMode) === 'hidden',
    });
  }

  async function chooseRoute(hostname, port, routeOptions = {}) {
    const host = String(hostname || '').toLowerCase();
    const targetPort = port || 443;
    const policy = policyFactory.forHost(host, routeOptions);
    if (!policy.enhanceEnabled) return null;
    const key = routeCache.cacheKey(host, targetPort);
    const cached = !routeOptions.forceRefresh ? routeCache.get(key) : null;
    const preferPool = !!routeOptions.requireApplicationProbe;
    if (!routeOptions.forceRefresh && preferPool) {
      const pooled = routeCache.buildCachedRouteFromPool(host, targetPort, routeOptions);
      if (pooled && pooled.ip) {
        if (routeOptions.backgroundRefresh !== false) {
          buildFreshRoute(host, targetPort, routeOptions).catch(error => debugLogger.warn(`[SteamAccess] background route refresh failed ${host}: ${error.message}`));
        }
        return withPolicy(pooled, policy);
      }
      if (routeOptions.cacheOnly) return null;
    }
    if (cached && cached.ip) return withPolicy(cached, policy);
    if (!routeOptions.forceRefresh) {
      const pooled = preferPool ? null : routeCache.buildCachedRouteFromPool(host, targetPort, routeOptions);
      if (pooled && pooled.ip) {
        if (routeOptions.backgroundRefresh !== false) {
          buildFreshRoute(host, targetPort, routeOptions).catch(error => debugLogger.warn(`[SteamAccess] background route refresh failed ${host}: ${error.message}`));
        }
        return withPolicy(pooled, policy);
      }
      if (routeOptions.cacheOnly) return null;
    }
    if (!routeOptions.forceRefresh && routeCache.hasBuildPromise(key)) return routeCache.getBuildPromise(key);
    const promise = buildFreshRoute(host, targetPort, routeOptions).finally(() => routeCache.deleteBuildPromise(key));
    routeCache.setBuildPromise(key, promise);
    return promise;
  }

  return {
    resolveForHost,
    chooseRoute,
    getEchSnapshot: () => echSnapshot,
  };
}

module.exports = { createGatewayRouteSelection };
