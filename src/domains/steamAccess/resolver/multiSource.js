'use strict';

const net = require('net');
const {
  normalizeSteamAccessResolverProtocol,
  normalizeSteamAccessDohEndpoint,
  normalizeSteamAccessDotEndpoint,
  normalizeSteamAccessEndpointList,
  normalizeSteamAccessResolverMode,
} = require('../../../config/normalizers');
const { queryDohEndpoint } = require('./doh');
const { queryDotEndpoint } = require('./dot');

function createResolver(options = {}) {
  const userAgent = options.userAgent || 'WallHub';
  const timeoutMs = options.timeoutMs || 2500;
  const logger = options.logger || console;
  const debugLogger = options.debugLogger || logger;
  const verboseNetworkLogs = typeof options.verboseNetworkLogs === 'function' ? options.verboseNetworkLogs : () => !!options.verboseNetworkLogs;
  const endpointHealth = new Map();

  function networkLog(message) {
    if (verboseNetworkLogs()) logger.log(`[SteamAccess:net] ${message}`);
    else debugLogger.network?.(`[SteamAccess:net] ${message}`);
  }

  function healthKey(protocol, endpoint) {
    return `${protocol}:${endpoint}`;
  }

  function recordEndpoint(protocol, endpoint, ok, elapsedMs) {
    const key = healthKey(protocol, endpoint);
    const current = endpointHealth.get(key) || { ok: 0, fail: 0, avgMs: 0, cooldownUntil: 0, lastOkAt: 0, lastFailAt: 0 };
    const now = Date.now();
    if (ok) {
      current.ok += 1;
      current.fail = 0;
      current.lastOkAt = now;
      current.cooldownUntil = 0;
      current.avgMs = current.avgMs ? Math.round(current.avgMs * 0.7 + Math.max(1, elapsedMs) * 0.3) : Math.max(1, elapsedMs);
    } else {
      current.fail += 1;
      current.lastFailAt = now;
      current.cooldownUntil = now + Math.max(30_000, Math.min(10 * 60_000, current.fail * 60_000));
    }
    endpointHealth.set(key, current);
  }

  function endpointScore(protocol, endpoint) {
    const current = endpointHealth.get(healthKey(protocol, endpoint));
    if (!current) return 1000;
    if (current.cooldownUntil > Date.now()) return 100000 + current.fail * 1000;
    return (current.avgMs || 1000) - Math.min(current.ok, 10) * 20 + current.fail * 100;
  }

  function resolveSelectedEndpoints(protocol, selectors = {}) {
    const normalizedProtocol = normalizeSteamAccessResolverProtocol(protocol);
    const mode = normalizeSteamAccessResolverMode(normalizedProtocol === 'dot'
      ? (selectors.dotMode || selectors.mode)
      : (selectors.dohMode || selectors.mode));
    const current = normalizedProtocol === 'dot'
      ? normalizeSteamAccessEndpointList([selectors.dotEndpoint], normalizedProtocol)
      : normalizeSteamAccessEndpointList([selectors.dohEndpoint], normalizedProtocol);
    const builtin = normalizeSteamAccessEndpointList(normalizedProtocol === 'dot' ? (options.dotEndpoints || []) : (options.dohEndpoints || []), normalizedProtocol);
    const selected = normalizeSteamAccessEndpointList(normalizedProtocol === 'dot'
      ? (selectors.selectedDotEndpoints || [])
      : (selectors.selectedDohEndpoints || []), normalizedProtocol);
    const custom = normalizeSteamAccessEndpointList(normalizedProtocol === 'dot'
      ? (selectors.customDotEndpoints || [])
      : (selectors.customDohEndpoints || []), normalizedProtocol, { limit: 32 });
    const ordered = [];
    const push = (value) => {
      if (!value || ordered.includes(value)) return;
      ordered.push(value);
    };
    if (mode === 'fixed') {
      current.forEach(push);
      return ordered;
    }
    selected.forEach(push);
    if (!ordered.length) current.forEach(push);
    if (!ordered.length) custom.forEach(push);
    if (!ordered.length) builtin.forEach(push);
    return ordered.sort((a, b) => endpointScore(normalizedProtocol, a) - endpointScore(normalizedProtocol, b));
  }

  async function queryEndpoint(endpoint, hostname, protocol, qtype) {
    const normalizedProtocol = normalizeSteamAccessResolverProtocol(protocol);
    const startedAt = Date.now();
    try {
      const answers = normalizedProtocol === 'dot'
        ? await queryDotEndpoint(endpoint, hostname, qtype, timeoutMs)
        : await queryDohEndpoint(endpoint, hostname, qtype, userAgent, timeoutMs);
      const elapsedMs = Date.now() - startedAt;
      recordEndpoint(normalizedProtocol, endpoint, true, elapsedMs);
      networkLog(`${normalizedProtocol.toUpperCase()} ${qtype} ok ${endpoint} ${hostname} answers=${(answers || []).length} elapsed=${elapsedMs}ms`);
      return (answers || []).map(item => ({
        data: item && item.data,
        ip: item && item.data,
        endpoint,
        resolver: endpoint,
        protocol: normalizedProtocol,
        type: item && item.type || qtype,
        recordType: item && item.type || qtype,
        source: normalizedProtocol,
        elapsedMs,
        confidence: 0.8,
      }));
    } catch (error) {
      recordEndpoint(normalizedProtocol, endpoint, false, Date.now() - startedAt);
      logger.warn(`[SteamAccess] ${normalizedProtocol.toUpperCase()} ${qtype} failed ${endpoint} ${hostname}: ${error.message}`);
      networkLog(`${normalizedProtocol.toUpperCase()} ${qtype} failed ${endpoint} ${hostname} elapsed=${Date.now() - startedAt}ms error=${error.message}`);
      return [];
    }
  }

  async function resolveHost(hostname, optionsForResolve = {}) {
    const protocol = normalizeSteamAccessResolverProtocol(optionsForResolve.protocol || 'doh');
    const includeIpv6 = !!optionsForResolve.includeIpv6;
    const endpoints = resolveSelectedEndpoints(protocol, optionsForResolve);
    const qtypes = includeIpv6 ? ['A', 'AAAA'] : ['A'];
    networkLog(`resolve ${hostname} protocol=${protocol} endpoints=${endpoints.join(',')} qtypes=${qtypes.join(',')}`);
    const seen = new Set();
    const ips = [];
    const answers = [];
    const usedEndpoints = [];
    const tasks = [];
    for (const endpoint of endpoints) {
      for (const qtype of qtypes) tasks.push(queryEndpoint(endpoint, hostname, protocol, qtype));
    }
    const results = await Promise.all(tasks);
    for (const result of results) {
      for (const answer of result) {
        const ip = String(answer.data || '').trim();
        const family = net.isIP(ip);
        if (!family || seen.has(ip)) continue;
        seen.add(ip);
        ips.push(ip);
        answers.push(Object.assign({ ip, family, resolvedHost: hostname }, answer));
        if (!usedEndpoints.includes(answer.endpoint)) usedEndpoints.push(answer.endpoint);
      }
      if (ips.length >= (optionsForResolve.minIps || 8)) break;
    }
    return {
      ips,
      answers,
      endpoints: usedEndpoints,
      protocol,
      source: 'resolver',
      resolverHealth: endpoints.slice(0, 8).map(endpoint => {
        const current = endpointHealth.get(healthKey(protocol, endpoint)) || {};
        return { endpoint, protocol, ok: (current.fail || 0) === 0, failures: current.fail || 0, avgMs: current.avgMs || 0, cooldownUntil: current.cooldownUntil || 0 };
      }),
    };
  }

  return { resolveHost, resolveSelectedEndpoints, endpointHealthSnapshot: () => Array.from(endpointHealth.entries()) };
}

module.exports = { createResolver };
