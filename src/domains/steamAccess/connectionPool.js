'use strict';

const net = require('net');
const { createConnectionMetadata } = require('./connectionPool/metadata');
const { createHttp1Pool } = require('./connectionPool/http1');
const { createHttp2Pool } = require('./connectionPool/http2');
const { createHeartbeatManager } = require('./connectionPool/heartbeat');
const { createConnectionPoolSnapshot } = require('./connectionPool/snapshot');

const WEBAPI_HOSTS = new Set(['api.steampowered.com', 'community.steam-api.com']);

function isWebApiHost(hostname) {
  return WEBAPI_HOSTS.has(String(hostname || '').trim().toLowerCase());
}

function routeKey(route, ip, sniStrategy = {}, protocol = 'h1') {
  return [
    String(route && route.hostname || '').toLowerCase(),
    ip || route && route.ip || '',
    net.isIP(ip || route && route.ip || '') || 4,
    sniStrategy.type || sniStrategy.mode || 'hidden',
    protocol || 'h1',
  ].join('|');
}

function servernameForStrategy(strategy, hostname) {
  if (!strategy || strategy.mode === 'hidden' || strategy.type === 'hidden') return '';
  if (strategy.mode === 'custom' || strategy.type === 'fake') return strategy.hostname || '';
  return String(hostname || '');
}

function originForIp(ip, port) {
  return net.isIP(ip) === 6 ? `https://[${ip}]:${port || 443}` : `https://${ip}:${port || 443}`;
}

function createSteamAccessConnectionPool(options = {}) {
  const logger = options.logger || console;
  const onConnectionFailure = typeof options.onConnectionFailure === 'function' ? options.onConnectionFailure : () => {};
  const heartbeatIntervalMs = Math.max(15000, Math.min(30000, Number(options.heartbeatIntervalMs || 20000)));
  const requestTimeoutMs = Math.max(1000, Number(options.requestTimeoutMs || 8000));
  const connectionReuseEnabled = route => !(route && route.policy && route.policy.connectionReuseEnabled === false);
  let http1;
  let heartbeat;

  const metadata = createConnectionMetadata({
    routeKey,
    onConnectionFailure,
    destroyAgentForKey: key => http1.destroyAgentForKey(key),
  });
  const markFailure = (...args) => metadata.markFailure(...args);
  http1 = createHttp1Pool({
    logger,
    metadata,
    routeKey,
    servernameForStrategy,
    isWebApiHost,
    connectionReuseEnabled,
    ensureHeartbeatTimer: () => heartbeat.ensureTimer(),
    markFailure,
  });
  const http2 = createHttp2Pool({
    logger,
    metadata,
    routeKey,
    servernameForStrategy,
    originForIp,
  });
  heartbeat = createHeartbeatManager({
    logger,
    metadata,
    http1,
    http2,
    routeKey,
    servernameForStrategy,
    isWebApiHost,
    connectionReuseEnabled,
    markFailure,
    heartbeatIntervalMs,
    requestTimeoutMs,
  });
  const snapshot = createConnectionPoolSnapshot({ metadata, http1, http2, connectionReuseEnabled });

  function request(route, opts, ip, strategy, timeoutMs, signal, protocol = 'h1') {
    if (protocol === 'h2') return http2.request(route, opts, ip, strategy, timeoutMs);
    return http1.request(route, opts, ip, strategy, timeoutMs, signal);
  }

  function clear() {
    heartbeat.clear();
    http1.clear();
    http2.clear();
    metadata.clear();
  }

  return {
    getAgent: http1.getAgent,
    getHttp2Session: http2.getHttp2Session,
    request,
    prewarm: heartbeat.prewarm,
    markFailure,
    prioritizeIps: metadata.prioritizeIps,
    clear,
    snapshot,
  };
}

module.exports = { createSteamAccessConnectionPool, routeKey, servernameForStrategy, originForIp };
