'use strict';

const https = require('https');
const net = require('net');
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
const { parseHostsText, selectHostsRoute } = require('./hostsCompat');
const { resolveHostsText } = require('./resolver/hosts');
const {
  DEFAULT_WARMUP_HOSTS,
  DEFAULT_CDN_WARMUP_HOSTS,
  fixedSniForHost,
  servernameForSni,
  sniCachePart,
  edgeAliasForHost,
  hostProfile,
  isCoreHost,
  builtinIpsForHost,
  requestBudgetForHost,
  shouldHttpProbeHost,
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
  const debugLogger = createSteamAccessDebugLogger({
    logger,
    configDir,
    filePath: options.debugLogFile,
    enabled: () => !!getExperimental().verboseNetworkLogs || process.env.WALLHUB_STEAM_ACCESS_DEBUG_LOG === '1',
  });
  const githubAcceleratorMode = options.githubAcceleratorMode || options.acceleratorMode;
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
  const ipPool = createIpPool({ configDir, logger: debugLogger });
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
    acceleratorMode: githubAcceleratorMode,
  });
  cdnIpDatabase.load();

  const routeCache = new Map();
  const routeBuildPromises = new Map();
  let lastRoute = null;
  let runtimeHostsText = null;
  let runtimeHostsEntryCount = 0;
  let warmupPromise = null;
  let coreWarmupPromise = null;
  let cdnWarmupPromise = null;
  let cdnRefreshPromise = null;
  let echSnapshot = { host: 'api.steampowered.com', echSupported: false, checkedAt: 0, answers: [] };
  const forwarder = createSteamAccessForwarder({
    chooseRoute,
    connectionPool,
    metrics,
    logger: debugLogger,
    debugLogger,
    verboseNetworkLogs: () => !!getExperimental().verboseNetworkLogs,
    markSuccess: (host, ip, meta) => routeStore.feedbackSuccess(host, ip, meta),
    markFailure: (host, ip, error, meta) => {
      routeStore.feedbackFailure(host, ip, error, meta);
      removeCachedIp(host, 443, ip);
    },
  });

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

  function cacheKey(hostname, port) {
    return `${currentMode()}:${String(hostname || '').toLowerCase()}:${port || 443}`;
  }

  function isSteamWebApiHost(hostname) {
    const host = String(hostname || '').trim().toLowerCase();
    return host === 'api.steampowered.com' || host === 'community.steam-api.com';
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

  function refreshCdnDatabaseSoon() {
    if (cdnRefreshPromise) return cdnRefreshPromise;
    const snapshot = cdnIpDatabase.snapshot();
    const stale = !snapshot.updatedAt || (Date.now() - snapshot.updatedAt > 24 * 60 * 60 * 1000);
    if (!stale && snapshot.cidrs && snapshot.cidrs.length) return Promise.resolve(snapshot);
    cdnRefreshPromise = cdnIpDatabase.refresh().catch((error) => {
      debugLogger.warn('[SteamAccess] CDN database refresh failed:', error.message);
      return cdnIpDatabase.snapshot();
    }).finally(() => { cdnRefreshPromise = null; });
    return cdnRefreshPromise;
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

  function cachedRouteRecordAllowed(record, now, options = {}) {
    if (!record || !record.ip) return false;
    if (record.cooldownUntil && record.cooldownUntil > now) return false;
    if (options.requireApplicationProbe) {
      const hasApplicationProbe = String(record.probeLevel || '').toLowerCase() === 'application';
      const hasActualRequest = Number(record.requestOk || 0) > 0 && Number(record.lastRequestOkAt || 0) > 0;
      if (!hasApplicationProbe && !hasActualRequest) return false;
      if (!record.lastOkAt || Number(record.ok || 0) <= 0 || Number(record.consecutiveFail || 0) > 0) return false;
      const maxAgeMs = Math.max(30_000, Number(options.maxAgeMs || 10 * 60 * 1000));
      if (now - Number(record.lastOkAt || 0) > maxAgeMs) return false;
      if (!hasApplicationProbe && hasActualRequest && now - Number(record.lastRequestOkAt || 0) > maxAgeMs) return false;
    }
    return (record.ok > 0 || record.source === 'history');
  }

  function buildCachedRouteFromPool(hostname, port, options = {}) {
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
      .filter(item => cachedRouteRecordAllowed(item, now, options))
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
      source: options.requireApplicationProbe ? 'ip-pool-application-cache' : 'ip-pool-cache',
      resolverProtocol: getResolverProtocol(),
      candidates: records.length,
      reachable: records.length,
      readiness: 'ready',
      resolverHealth: [],
      policy,
    });
  }

  async function resolveForHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    const startedAt = Date.now();
    if (currentMode() === 'hosts') {
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

  async function buildFreshRoute(host, targetPort) {
    if (isSteamWebApiHost(host)) refreshCdnDatabaseSoon().catch(() => {});
    const resolved = await resolveForHost(host);
    if (isSteamWebApiHost(host)) refreshEchDiagnostics(host);
    const policy = policyFactory.forHost(host);
    const budget = policy.requestBudget;
    if (currentMode() === 'hosts') {
      if (!resolved.ips.length) return null;
      return buildRoute(host, targetPort, {
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
    return buildRoute(host, targetPort, {
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

  async function chooseRoute(hostname, port, routeOptions = {}) {
    const host = String(hostname || '').toLowerCase();
    const targetPort = port || 443;
    const policy = policyFactory.forHost(host, routeOptions);
    const key = cacheKey(host, targetPort);
    const cached = !routeOptions.forceRefresh ? routeCache.get(key) : null;
    const preferPool = !!routeOptions.requireApplicationProbe;
    if (!routeOptions.forceRefresh && preferPool) {
      const pooled = buildCachedRouteFromPool(host, targetPort, routeOptions);
      if (pooled && pooled.ip) {
        const primarySni = policy.sniStrategies && policy.sniStrategies[0] || {};
        if (routeOptions.backgroundRefresh !== false) {
          buildFreshRoute(host, targetPort).catch(error => debugLogger.warn(`[SteamAccess] background route refresh failed ${host}: ${error.message}`));
        }
        return Object.assign({}, pooled, {
          policy,
          sniStrategies: policy.sniStrategies,
          sniMode: primarySni.mode || primarySni.type || pooled.sniMode,
          sniHostname: primarySni.hostname || '',
          hiddenSni: (primarySni.mode || primarySni.type || pooled.sniMode) === 'hidden',
        });
      }
      if (routeOptions.cacheOnly) return null;
    }
    if (cached && cached.ip) {
      const primarySni = policy.sniStrategies && policy.sniStrategies[0] || {};
      return Object.assign({}, cached, {
        policy,
        sniStrategies: policy.sniStrategies,
        sniMode: primarySni.mode || primarySni.type || cached.sniMode,
        sniHostname: primarySni.hostname || '',
        hiddenSni: (primarySni.mode || primarySni.type || cached.sniMode) === 'hidden',
      });
    }
    if (!routeOptions.forceRefresh) {
      const pooled = preferPool ? null : buildCachedRouteFromPool(host, targetPort, routeOptions);
      if (pooled && pooled.ip) {
        const primarySni = policy.sniStrategies && policy.sniStrategies[0] || {};
        if (routeOptions.backgroundRefresh !== false) {
          buildFreshRoute(host, targetPort).catch(error => debugLogger.warn(`[SteamAccess] background route refresh failed ${host}: ${error.message}`));
        }
        return Object.assign({}, pooled, {
          policy,
          sniStrategies: policy.sniStrategies,
          sniMode: primarySni.mode || primarySni.type || pooled.sniMode,
          sniHostname: primarySni.hostname || '',
          hiddenSni: (primarySni.mode || primarySni.type || pooled.sniMode) === 'hidden',
        });
      }
      if (routeOptions.cacheOnly) return null;
    }
    if (!routeOptions.forceRefresh && routeBuildPromises.has(key)) return routeBuildPromises.get(key);
    const promise = buildFreshRoute(host, targetPort).finally(() => routeBuildPromises.delete(key));
    routeBuildPromises.set(key, promise);
    return promise;
  }

  function requestOne(opts, ip, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      const sni = fixedSniForHost(opts.hostname);
      const req = https.request({
        protocol: 'https:',
        hostname: ip,
        servername: servernameForSni(sni, opts.hostname),
        port: opts.port || 443,
        family: net.isIP(ip) || 4,
        path: opts.path,
        method: opts.method || 'GET',
        headers: Object.assign({}, opts.headers || {}, { Host: opts.hostname }),
        timeout: timeoutMs,
        rejectUnauthorized: false,
        agent: false,
        signal,
      }, (rs) => {
        if (rs.statusCode >= 300 && rs.statusCode < 400 && rs.headers.location) {
          rs.resume();
          return reject(Object.assign(new Error(`Steam access redirect ${rs.statusCode}`), { redirectLocation: rs.headers.location }));
        }
        if (rs.statusCode < 200 || rs.statusCode >= 300) {
          rs.resume();
          return reject(new Error(`HTTP ${rs.statusCode}`));
        }
        const chunks = [];
        rs.on('data', chunk => chunks.push(Buffer.from(chunk)));
        rs.on('end', () => resolve(Buffer.concat(chunks)));
        rs.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('Steam access timeout')));
      req.on('error', reject);
      if (opts.signal) {
        if (opts.signal.aborted) {
          req.destroy(Object.assign(new Error('Request aborted'), { code: 'ABORT_ERR' }));
          return;
        }
        opts.signal.addEventListener('abort', () => req.destroy(Object.assign(new Error('Request aborted'), { code: 'ABORT_ERR' })), { once: true });
      }
      if (opts.body) req.write(opts.body);
      req.end();
    });
  }

  async function request(opts, body, timeout) {
    return forwarder.request(opts, body, timeout);
  }

  async function requestStream(target, method, headers, body, timeout) {
    return forwarder.stream({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port ? parseInt(target.port, 10) : undefined,
      path: `${target.pathname || '/'}${target.search || ''}`,
      method: method || 'GET',
      headers: headers || {},
      timeout,
    }, body, timeout);
  }

  async function runWarmup(reason, list, optionsForRun = {}) {
    if (!enabled()) return { ok: 0, total: 0, routes: [] };
    const targets = Array.isArray(list) && list.length ? list : warmupHosts;
    const forceRefresh = optionsForRun.forceRefresh !== false;
    const routes = [];
    let ok = 0;
    for (const host of targets) {
      try {
        const cached = !forceRefresh ? buildCachedRouteFromPool(host, 443) : null;
        const route = cached || await chooseRoute(host, 443, { forceRefresh });
        if (route && route.ip) {
          routes.push(route);
          for (const ip of (route.ips || []).slice(0, 2)) connectionPool.prewarm(route, ip, (route.sniStrategies || [])[0] || { type: 'hidden', mode: 'hidden' });
          if (route.readiness === 'ready') ok += 1;
        }
      } catch (error) {
        debugLogger.warn(`[SteamAccess] warmup failed ${host}: ${error.message}`);
      }
    }
    debugLogger.log(`[SteamAccess] warmup finished (${reason || 'manual'}): ${ok}/${targets.length}`);
    return { ok, total: targets.length, routes };
  }

  function warmup(reason, list) {
    if (!warmupPromise) {
      warmupPromise = runWarmup(reason, list).finally(() => { warmupPromise = null; });
    }
    return warmupPromise;
  }

  function warmupCore(reason, optionsForRun = {}) {
    if (!coreWarmupPromise) {
      coreWarmupPromise = runWarmup(reason || 'core', warmupHosts, optionsForRun).finally(() => { coreWarmupPromise = null; });
    }
    return coreWarmupPromise;
  }

  function warmupControlPlane(reason, optionsForRun = {}) {
    return runWarmup(reason || 'control-plane', ['api.steampowered.com', 'community.steam-api.com'], Object.assign({ forceRefresh: true }, optionsForRun));
  }

  function warmupCdnBackground(reason) {
    if (!cdnWarmupPromise) {
      cdnWarmupPromise = runWarmup(reason || 'cdn', cdnWarmupHosts).finally(() => { cdnWarmupPromise = null; });
    }
    return cdnWarmupPromise;
  }

  function ensureReady(reason, timeoutMs = 15000) {
    const mode = currentMode();
    const coreRoutes = warmupHosts
      .map(host => routeCache.get(`${mode}:${String(host || '').toLowerCase()}:443`))
      .filter(route => route && route.ip);
    if (coreRoutes.length) {
      return Promise.resolve({ ready: true, ok: coreRoutes.length, total: warmupHosts.length, routes: coreRoutes, cached: true });
    }
    return Promise.race([
      warmupCore(reason || 'ready', { forceRefresh: false }).then(result => Object.assign({ ready: !!(result && result.ok > 0) }, result || {})),
      new Promise(resolve => setTimeout(() => resolve({ ready: false, ok: 0, total: 0, routes: [], timeout: true }), Math.max(500, timeoutMs))),
    ]);
  }

  function isWarmingUp() {
    return !!(warmupPromise || coreWarmupPromise || cdnWarmupPromise);
  }

  async function logResolvedRoutes(reason) {
    const result = await runWarmup(reason || 'log', warmupHosts);
    for (const route of result.routes || []) {
      debugLogger.log(`[SteamAccess] ${reason || 'route'} ${route.hostname} -> ${route.ip}`);
    }
    return result.routes || [];
  }

  function shouldUse(opts, proxy) {
    return policyFactory.shouldUse(opts, proxy);
  }

  function cachedRuntimeHostsEntryCount() {
    const hostsText = getHostsText();
    if (hostsText !== runtimeHostsText) {
      runtimeHostsText = hostsText;
      runtimeHostsEntryCount = parseHostsText(hostsText).size;
    }
    return runtimeHostsEntryCount;
  }

  function runtimeSnapshot() {
    const mode = currentMode();
    const protocol = mode === 'hosts' ? 'hosts' : getResolverProtocol();
    const webapiPool = routeStore.snapshot('api.steampowered.com');
    const current = lastRoute ? {
      hostname: lastRoute.hostname,
      port: lastRoute.port,
      ip: lastRoute.ip,
      source: lastRoute.source,
      resolverProtocol: lastRoute.resolverProtocol,
      resolverEndpoint: lastRoute.resolverEndpoint,
      updatedAt: lastRoute.updatedAt,
      sniMode: lastRoute.sniMode,
    } : null;
    const hosts = {
      entries: mode === 'hosts' ? cachedRuntimeHostsEntryCount() : 0,
      lastUpdatedAt: getHostsLastUpdatedAt(),
      lastError: getHostsLastError(),
      nextUpdateAt: getHostsNextUpdateAt(),
    };
    const webapi = {
      host: webapiPool.host,
      active: webapiPool.active,
      cooling: webapiPool.cooling,
      fastest: webapiPool.fastest,
      rttMs: webapiPool.rttMs,
      lastRefreshAt: webapiPool.lastRefreshAt,
      nextRefreshAt: webapiPool.nextRefreshAt,
      lastError: webapiPool.lastError,
      direct: !!directWebApi(),
    };
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
    const routes = Array.from(routeCache.values()).slice(-8).map(route => ({
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
      }));
    const current = lastRoute ? {
      hostname: lastRoute.hostname,
      port: lastRoute.port,
      ip: lastRoute.ip,
      ips: lastRoute.ips,
      source: lastRoute.source,
      resolverProtocol: lastRoute.resolverProtocol,
      resolverEndpoint: lastRoute.resolverEndpoint,
      resolverEndpoints: lastRoute.resolverEndpoints,
      candidates: lastRoute.candidates,
      reachable: lastRoute.reachable,
      updatedAt: lastRoute.updatedAt,
      sniMode: lastRoute.sniMode,
      sniHostname: lastRoute.sniHostname,
      sniStrategies: lastRoute.sniStrategies,
      policy: lastRoute.policy,
    } : null;
    const webapiPoolSnapshot = routeStore.snapshot('api.steampowered.com');
    const routeHosts = Array.from(new Set(routes.map(route => route.hostname).filter(Boolean).concat(current ? [current.hostname] : [])));
    const cdnSnapshot = cdnIpDatabase.snapshot();
    return {
      enabled: enabled(),
      mode,
      resolverProtocol: protocol,
      resolverEndpoint: protocol === 'dot' ? getDotEndpoint() : protocol === 'hosts' ? '' : getDohEndpoint(),
      resolverEndpoints: endpoints,
      resolverHealth: lastRoute && Array.isArray(lastRoute.resolverHealth) ? lastRoute.resolverHealth : [],
      policy: lastRoute && lastRoute.policy ? lastRoute.policy : null,
      metrics: metrics.snapshot(),
      connectionPool: connectionPool.snapshot(),
      probeQueue: probeQueue.snapshot(),
      debugLog: debugLogger.snapshot(),
      hosts: {
        entries: parseHostsText(getHostsText()).size,
        lastUpdatedAt: getHostsLastUpdatedAt(),
        lastError: getHostsLastError(),
        nextUpdateAt: getHostsNextUpdateAt(),
      },
      webapiPool: {
        host: webapiPoolSnapshot.host,
        active: webapiPoolSnapshot.active,
        cooling: webapiPoolSnapshot.cooling,
        fastest: webapiPoolSnapshot.fastest,
        rttMs: webapiPoolSnapshot.rttMs,
        lastRefreshAt: webapiPoolSnapshot.lastRefreshAt,
        nextRefreshAt: webapiPoolSnapshot.nextRefreshAt,
        lastError: webapiPoolSnapshot.lastError,
        akamaiCidrMatched: 0,
        suspectDnsAnswers: webapiPoolSnapshot.ips.filter(item => item.suspect).length,
        direct: !!directWebApi(),
        cdnDatabaseUpdatedAt: cdnSnapshot.updatedAt || 0,
        cdnDatabaseSource: cdnSnapshot.source || '',
        connections: (connectionPool.snapshot().connections || []).filter(item => item.host === 'api.steampowered.com' || item.host === 'community.steam-api.com'),
        ech: echSnapshot,
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

  return {
    getDohEndpoint,
    getDotEndpoint,
    getResolverProtocol,
    getDohMode,
    getDotMode,
    getSelectedDohEndpoints,
    getSelectedDotEndpoints,
    resolveHost: resolveForHost,
    chooseRoute,
    removeCachedIp,
    clear,
    runtimeSnapshot,
    statusSnapshot,
    diagnosticSnapshot,
    policyForHost: policyFactory.forHost,
    warmup,
    warmupCore,
    warmupControlPlane,
    warmupCdnBackground,
    ensureReady,
    isWarmingUp,
    logResolvedRoutes,
    shouldUse,
    request,
    requestStream,
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
