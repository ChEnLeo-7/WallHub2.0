'use strict';

const net = require('net');

function failureReason(error) {
  const message = String(error && error.message || error || 'request-failed');
  const code = String(error && error.code || '').toUpperCase();
  if (code === 'ECONNRESET' || /ECONNRESET|socket hang up|read ECONNRESET/i.test(message)) return 'reset';
  if (code === 'ETIMEDOUT' || /timeout|ETIMEDOUT/i.test(message)) return 'timeout';
  return 'request-failed';
}

function createConnectionMetadata(options = {}) {
  const entries = new Map();
  const routeKey = options.routeKey;
  const destroyAgentForKey = options.destroyAgentForKey;
  const onConnectionFailure = options.onConnectionFailure;

  function ensureMeta(key, route, ip, strategy = {}, protocol = 'h1') {
    let meta = entries.get(key);
    if (!meta) {
      meta = {
        key,
        host: String(route && route.hostname || '').toLowerCase(),
        ip,
        family: net.isIP(ip) || 4,
        protocol,
        sniMode: strategy.type || strategy.mode || 'hidden',
        sniHostname: strategy.hostname || '',
        createdAt: Date.now(),
        lastUsedAt: 0,
        lastOkAt: 0,
        requestCount: 0,
        reusedCount: 0,
        lastLocalPort: 0,
        lastError: '',
        lastResetAt: 0,
        cooldownUntil: 0,
        inFlight: 0,
        state: 'warming',
        route,
        strategy,
      };
      entries.set(key, meta);
    } else {
      meta.route = route || meta.route;
      meta.strategy = strategy || meta.strategy;
    }
    return meta;
  }

  function markFailure(route, ip, strategy = {}, protocol = 'h1', error, failureOptions = {}) {
    const key = routeKey(route, ip, strategy, protocol);
    const meta = ensureMeta(key, route, ip, strategy, protocol);
    const reason = failureReason(error);
    meta.lastError = reason;
    meta.state = reason === 'reset' || reason === 'timeout' ? 'cooling' : 'degraded';
    if (reason === 'reset') meta.lastResetAt = Date.now();
    if (reason === 'reset' || reason === 'timeout') {
      meta.cooldownUntil = Date.now() + 360000;
      destroyAgentForKey(key);
    }
    if (failureOptions.notify) {
      onConnectionFailure(route && route.hostname, ip, error || reason, {
        stage: reason,
        protocol,
        sniStrategy: strategy.type || strategy.mode || 'hidden',
      });
    }
  }

  function recordResponseMeta(key, request, response) {
    const meta = entries.get(key);
    if (!meta) return;
    meta.inFlight = Math.max(0, Number(meta.inFlight || 0) - 1);
    meta.lastUsedAt = Date.now();
    meta.lastOkAt = Date.now();
    meta.requestCount += 1;
    if (request.reusedSocket) meta.reusedCount += 1;
    meta.lastLocalPort = Number(request.socket && request.socket.localPort || response.socket && response.socket.localPort || meta.lastLocalPort || 0);
    meta.state = request.reusedSocket ? 'active' : 'idle';
    response.steamAccess = {
      key,
      reusedSocket: !!request.reusedSocket,
      localPort: meta.lastLocalPort,
      connectionAgeMs: Date.now() - meta.createdAt,
      requestCount: meta.requestCount,
      reusedCount: meta.reusedCount,
    };
  }

  function prioritizeIps(route, ips = [], strategy = {}, protocol = 'h1') {
    const currentTime = Date.now();
    return ips.slice().sort((a, b) => {
      const am = entries.get(routeKey(route, a, strategy, protocol));
      const bm = entries.get(routeKey(route, b, strategy, protocol));
      const score = (meta) => {
        if (!meta || meta.cooldownUntil > currentTime) return 0;
        return (meta.state === 'active' || meta.state === 'idle' ? 10000 : 0)
          + Number(meta.reusedCount || 0) * 100
          + Number(meta.requestCount || 0)
          + Number(meta.lastOkAt || 0) / 1000000000000;
      };
      return score(bm) - score(am);
    });
  }

  return {
    ensureMeta,
    markFailure,
    recordResponseMeta,
    prioritizeIps,
    get: key => entries.get(key),
    delete: key => entries.delete(key),
    values: () => entries.values(),
    clear: () => entries.clear(),
  };
}

module.exports = { createConnectionMetadata };
