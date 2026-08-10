'use strict';

const https = require('https');
const net = require('net');
const { WEBAPI_BUSINESS_PROBE_PATH } = require('../routes');

function createHeartbeatManager(options = {}) {
  const metadata = options.metadata;
  const http1 = options.http1;
  const http2 = options.http2;
  const routeKey = options.routeKey;
  const servernameForStrategy = options.servernameForStrategy;
  const isWebApiHost = options.isWebApiHost;
  const connectionReuseEnabled = options.connectionReuseEnabled;
  const markFailure = options.markFailure;
  const logger = options.logger;
  const heartbeatIntervalMs = options.heartbeatIntervalMs;
  const requestTimeoutMs = options.requestTimeoutMs;
  let heartbeatTimer = null;

  function heartbeatPath(route) {
    return isWebApiHost(route && route.hostname) ? WEBAPI_BUSINESS_PROBE_PATH : '/';
  }

  function prewarm(route, ip, strategy = {}) {
    if (!route || !ip) return false;
    if (!connectionReuseEnabled(route)) return false;
    if ((strategy.type || strategy.mode) !== 'hidden') return false;
    const protocols = route.policy && Array.isArray(route.policy.protocols) ? route.policy.protocols : ['h1'];
    try {
      if (protocols.includes('h2')) {
        const session = http2.getHttp2Session(route, ip, strategy);
        if (!session.closed && !session.destroyed) {
          session.ping(Buffer.from('wallhub01'), (error) => {
            http2.recordH2Result(route, ip, strategy, !error);
          });
        }
      }
      const agent = http1.getAgent(route, ip, strategy);
      const key = routeKey(route, ip, strategy, 'h1');
      const req = https.request({
        protocol: 'https:',
        hostname: ip,
        servername: servernameForStrategy(strategy, route.hostname),
        port: route.port || 443,
        family: net.isIP(ip) || 4,
        path: heartbeatPath(route),
        method: 'GET',
        headers: { Host: route.hostname, 'User-Agent': 'WallHub', Accept: 'application/json', 'Accept-Encoding': 'identity' },
        timeout: requestTimeoutMs,
        rejectUnauthorized: false,
        agent,
      }, (response) => {
        metadata.recordResponseMeta(key, req, response);
        if (response.statusCode && (response.statusCode < 200 || response.statusCode >= 400)) {
          markFailure(route, ip, strategy, 'h1', new Error(`prewarm HTTP ${response.statusCode}`), { notify: true });
        }
        response.resume();
      });
      req.on('timeout', () => req.destroy(new Error('Steam access prewarm timeout')));
      req.on('error', error => markFailure(route, ip, strategy, 'h1', error, { notify: true }));
      req.end();
      logger.network?.(`[SteamAccess:net] pool prewarm host=${route.hostname} ip=${ip} protocol=h1`);
      return true;
    } catch (error) {
      logger.warn?.(`[SteamAccess] prewarm failed ${route.hostname} ${ip}: ${error.message}`);
      return false;
    }
  }

  function runHeartbeats() {
    const currentTime = Date.now();
    for (const meta of metadata.values()) {
      if (meta.protocol !== 'h1' || !isWebApiHost(meta.host) || meta.inFlight > 0) continue;
      if (!http1.hasAgent(meta.key) || meta.cooldownUntil > currentTime) continue;
      const lastActiveAt = Math.max(meta.lastUsedAt || 0, meta.lastOkAt || 0, meta.createdAt || 0);
      if (currentTime - lastActiveAt < heartbeatIntervalMs) continue;
      meta.state = 'probing';
      const route = meta.route;
      const strategy = meta.strategy || { type: meta.sniMode, mode: meta.sniMode, hostname: meta.sniHostname };
      const agent = http1.getStoredAgent(meta.key);
      const req = https.request({
        protocol: 'https:',
        hostname: meta.ip,
        servername: servernameForStrategy(strategy, meta.host),
        port: route && route.port || 443,
        family: meta.family,
        path: WEBAPI_BUSINESS_PROBE_PATH,
        method: 'GET',
        headers: { Host: meta.host, 'User-Agent': 'WallHub', Accept: 'application/json', 'Accept-Encoding': 'identity' },
        timeout: requestTimeoutMs,
        rejectUnauthorized: false,
        agent,
      }, (response) => {
        let size = 0;
        const chunks = [];
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          const ok = response.statusCode === 200 && /^\s*\{/.test(Buffer.concat(chunks).toString('utf8'));
          if (ok) {
            meta.lastOkAt = Date.now();
            meta.lastUsedAt = Date.now();
            meta.requestCount += 1;
            if (req.reusedSocket) meta.reusedCount += 1;
            meta.lastLocalPort = Number(req.socket && req.socket.localPort || meta.lastLocalPort || 0);
            meta.state = 'active';
            logger.network?.(`[SteamAccess:net] heartbeat ok host=${meta.host} ip=${meta.ip} reused=${!!req.reusedSocket} localPort=${meta.lastLocalPort}`);
          } else {
            markFailure(route, meta.ip, strategy, 'h1', new Error(`heartbeat HTTP ${response.statusCode || 0}`), { notify: true });
          }
        };
        response.on('data', (chunk) => {
          if (size < 4096) chunks.push(Buffer.from(chunk));
          size += chunk.length;
          if (size > 4096) {
            finish();
            response.destroy();
          }
        });
        response.on('end', finish);
        response.on('close', finish);
      });
      req.on('timeout', () => req.destroy(new Error('Steam access heartbeat timeout')));
      req.on('error', error => markFailure(route, meta.ip, strategy, 'h1', error, { notify: true }));
      req.end();
    }
  }

  function ensureTimer() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(runHeartbeats, 5000);
    heartbeatTimer.unref?.();
  }

  function clear() {
    if (!heartbeatTimer) return;
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }

  return { prewarm, ensureTimer, clear };
}

module.exports = { createHeartbeatManager };
