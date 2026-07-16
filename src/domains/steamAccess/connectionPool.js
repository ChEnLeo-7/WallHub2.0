'use strict';

const https = require('https');
const http2 = require('http2');
const tls = require('tls');
const net = require('net');
const { WEBAPI_BUSINESS_PROBE_PATH } = require('./routes');

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
  const agents = new Map();
  const sessions = new Map();
  const sessionFailures = new Map();
  const metadata = new Map();
  const logger = options.logger || console;
  const heartbeatIntervalMs = Math.max(15000, Math.min(30000, Number(options.heartbeatIntervalMs || 20000)));
  const requestTimeoutMs = Math.max(1000, Number(options.requestTimeoutMs || 8000));
  const onConnectionFailure = typeof options.onConnectionFailure === 'function' ? options.onConnectionFailure : () => {};
  let heartbeatTimer = null;

  function connectionReuseEnabled(route) {
    return !(route && route.policy && route.policy.connectionReuseEnabled === false);
  }

  function ensureMeta(key, route, ip, strategy = {}, protocol = 'h1') {
    let meta = metadata.get(key);
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
      metadata.set(key, meta);
    } else {
      meta.route = route || meta.route;
      meta.strategy = strategy || meta.strategy;
    }
    return meta;
  }

  function destroyAgentForKey(key) {
    const agent = agents.get(key);
    if (agent) {
      try { agent.destroy(); } catch (error) { logger.warn?.('[SteamAccess] agent destroy failed:', error.message); }
    }
    agents.delete(key);
    const meta = metadata.get(key);
    if (meta) meta.state = 'dead';
  }

  function failureReason(error) {
    const message = String(error && error.message || error || 'request-failed');
    const code = String(error && error.code || '').toUpperCase();
    if (code === 'ECONNRESET' || /ECONNRESET|socket hang up|read ECONNRESET/i.test(message)) return 'reset';
    if (code === 'ETIMEDOUT' || /timeout|ETIMEDOUT/i.test(message)) return 'timeout';
    return 'request-failed';
  }

  function markFailure(route, ip, strategy = {}, protocol = 'h1', error, optionsForFailure = {}) {
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
    if (optionsForFailure.notify) onConnectionFailure(route && route.hostname, ip, error || reason, { stage: reason, protocol, sniStrategy: strategy.type || strategy.mode || 'hidden' });
  }

  function recordResponseMeta(key, request, response) {
    const meta = metadata.get(key);
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

  function ensureHeartbeatTimer() {
    if (heartbeatTimer) return;
    heartbeatTimer = setInterval(runHeartbeats, 5000);
    heartbeatTimer.unref?.();
  }

  function getAgent(route, ip, strategy = {}) {
    const key = routeKey(route, ip, strategy, 'h1');
    let agent = agents.get(key);
    ensureMeta(key, route, ip, strategy, 'h1');
    if (agent) logger.network?.(`[SteamAccess:net] pool h1 reused host=${route.hostname} ip=${ip} key=${key}`);
    if (!agent) {
      const servername = servernameForStrategy(strategy, route.hostname);
      const webapi = isWebApiHost(route.hostname);
      agent = new https.Agent({
        keepAlive: true,
        maxSockets: webapi ? 1 : 3,
        maxFreeSockets: webapi ? 1 : 2,
        keepAliveMsecs: 10000,
        timeout: 30000,
        freeSocketTimeout: webapi ? 30000 : 30000,
        rejectUnauthorized: false,
        createConnection: (connectOptions, cb) => {
          let settled = false;
          const done = (err, socket) => {
            if (settled) return;
            settled = true;
            cb(err, socket);
          };
          const socket = tls.connect(Object.assign({}, connectOptions, {
            host: ip,
            family: net.isIP(ip) || 4,
            servername,
            rejectUnauthorized: false,
          }), () => done(null, socket));
          socket.on('error', err => done(err));
          return socket;
        },
      });
      agents.set(key, agent);
      if (webapi) ensureHeartbeatTimer();
      logger.network?.(`[SteamAccess:net] pool h1 created host=${route.hostname} ip=${ip} key=${key}`);
    }
    return agent;
  }

  function getHttp2Session(route, ip, strategy = {}) {
    const key = routeKey(route, ip, strategy, 'h2');
    ensureMeta(key, route, ip, strategy, 'h2');
    const existing = sessions.get(key);
    if (existing && !existing.closed && !existing.destroyed) {
      logger.network?.(`[SteamAccess:net] pool h2 reused host=${route.hostname} ip=${ip} key=${key}`);
      return existing;
    }
    const servername = servernameForStrategy(strategy, route.hostname);
    const session = http2.connect(originForIp(ip, route.port || 443), {
      servername,
      rejectUnauthorized: false,
      createConnection: () => tls.connect({
        host: ip,
        port: route.port || 443,
        family: net.isIP(ip) || 4,
        servername,
        rejectUnauthorized: false,
        ALPNProtocols: ['h2', 'http/1.1'],
      }),
    });
    const cleanup = () => {
      sessions.delete(key);
      sessionFailures.delete(key);
    };
    session.once('goaway', cleanup);
    session.once('close', cleanup);
    session.once('error', cleanup);
    sessions.set(key, session);
    logger.network?.(`[SteamAccess:net] pool h2 created host=${route.hostname} ip=${ip} key=${key}`);
    return session;
  }

  function recordH2Result(route, ip, strategy, ok) {
    const key = routeKey(route, ip, strategy, 'h2');
    if (ok) {
      sessionFailures.delete(key);
      return;
    }
    const failures = Number(sessionFailures.get(key) || 0) + 1;
    sessionFailures.set(key, failures);
    if (failures >= 3) {
      const session = sessions.get(key);
      if (session) {
        try { session.destroy(); } catch {}
      }
      sessions.delete(key);
      metadata.delete(key);
      sessionFailures.delete(key);
    }
  }

  function requestH2(route, opts, ip, strategy, timeoutMs) {
    return new Promise((resolve, reject) => {
      const session = getHttp2Session(route, ip, strategy);
      let settled = false;
      const done = (err, response) => {
        if (settled) return;
        settled = true;
        if (err) reject(err);
        else resolve(response);
      };
      const headers = Object.assign({}, opts.headers || {});
      delete headers.Host;
      delete headers.host;
      const req = session.request(Object.assign(headers, {
        ':method': opts.method || 'GET',
        ':path': opts.path || '/',
        ':scheme': 'https',
        ':authority': opts.hostname || route.hostname,
      }));
      const timer = setTimeout(() => {
        req.close(http2.constants.NGHTTP2_CANCEL);
        recordH2Result(route, ip, strategy, false);
        done(new Error('Steam access h2 timeout'));
      }, Math.max(500, timeoutMs || 5000));
      timer.unref?.();
      req.once('response', (headersForResponse) => {
        req.statusCode = Number(headersForResponse[':status'] || 0);
        req.headers = Object.fromEntries(Object.entries(headersForResponse).filter(([key]) => !key.startsWith(':')));
        clearTimeout(timer);
        recordH2Result(route, ip, strategy, true);
        done(null, req);
      });
      req.once('error', (error) => {
        clearTimeout(timer);
        if (settled) return;
        recordH2Result(route, ip, strategy, false);
        done(error);
      });
      req.once('close', () => {
        clearTimeout(timer);
        if (settled) return;
        recordH2Result(route, ip, strategy, false);
        done(new Error('Steam access h2 closed before response'));
      });
      if (opts.body) req.write(opts.body);
      req.end();
    });
  }

  function request(route, opts, ip, strategy, timeoutMs, signal, protocol = 'h1') {
    if (protocol === 'h2') return requestH2(route, opts, ip, strategy, timeoutMs);
    return new Promise((resolve, reject) => {
      const key = routeKey(route, ip, strategy, 'h1');
      const meta = ensureMeta(key, route, ip, strategy, 'h1');
      meta.inFlight += 1;
      meta.lastUsedAt = Date.now();
      meta.state = 'active';
      const reuseConnection = connectionReuseEnabled(route);
      const req = https.request({
        protocol: 'https:',
        hostname: ip,
        servername: servernameForStrategy(strategy, route.hostname),
        port: route.port || opts.port || 443,
        family: net.isIP(ip) || 4,
        path: opts.path,
        method: opts.method || 'GET',
        headers: Object.assign({}, opts.headers || {}, { Host: opts.hostname || route.hostname }),
        timeout: timeoutMs,
        rejectUnauthorized: false,
        agent: reuseConnection ? getAgent(route, ip, strategy) : false,
        signal,
      }, (rs) => {
        recordResponseMeta(key, req, rs);
        resolve(rs);
      });
      req.on('timeout', () => req.destroy(new Error('Steam access timeout')));
      req.on('error', (error) => {
        meta.inFlight = Math.max(0, Number(meta.inFlight || 0) - 1);
        markFailure(route, ip, strategy, 'h1', error);
        reject(error);
      });
      if (opts.body) req.write(opts.body);
      req.end();
    });
  }

  function clear() {
    if (heartbeatTimer) {
      clearInterval(heartbeatTimer);
      heartbeatTimer = null;
    }
    for (const agent of agents.values()) {
      try { agent.destroy(); } catch (error) { logger.warn?.('[SteamAccess] agent destroy failed:', error.message); }
    }
    agents.clear();
    for (const session of sessions.values()) {
      try { session.close(); } catch { try { session.destroy(); } catch {} }
    }
    sessions.clear();
    sessionFailures.clear();
    metadata.clear();
  }

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
        const session = getHttp2Session(route, ip, strategy);
        if (!session.closed && !session.destroyed) {
          session.ping(Buffer.from('wallhub01'), (error) => {
            if (error) recordH2Result(route, ip, strategy, false);
            else recordH2Result(route, ip, strategy, true);
          });
        }
      }
      const agent = getAgent(route, ip, strategy);
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
        recordResponseMeta(key, req, response);
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
      if (!agents.has(meta.key) || meta.cooldownUntil > currentTime) continue;
      const lastActiveAt = Math.max(meta.lastUsedAt || 0, meta.lastOkAt || 0, meta.createdAt || 0);
      if (currentTime - lastActiveAt < heartbeatIntervalMs) continue;
      meta.state = 'probing';
      const route = meta.route;
      const strategy = meta.strategy || { type: meta.sniMode, mode: meta.sniMode, hostname: meta.sniHostname };
      const agent = agents.get(meta.key);
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

  function prioritizeIps(route, ips = [], strategy = {}, protocol = 'h1') {
    const currentTime = Date.now();
    return ips.slice().sort((a, b) => {
      const am = metadata.get(routeKey(route, a, strategy, protocol));
      const bm = metadata.get(routeKey(route, b, strategy, protocol));
      const score = (meta) => {
        if (!meta || meta.cooldownUntil > currentTime) return 0;
        return (meta.state === 'active' || meta.state === 'idle' ? 10000 : 0) + Number(meta.reusedCount || 0) * 100 + Number(meta.requestCount || 0) + Number(meta.lastOkAt || 0) / 1000000000000;
      };
      return score(bm) - score(am);
    });
  }

  function snapshot() {
    const connections = Array.from(metadata.values()).map(meta => ({
      host: meta.host,
      ip: meta.ip,
      family: meta.family,
      protocol: meta.protocol,
      sniMode: meta.sniMode,
      sniHostname: meta.sniHostname,
      state: meta.state,
      connectionReuseEnabled: !(meta.route && meta.route.policy && meta.route.policy.connectionReuseEnabled === false),
      createdAt: meta.createdAt,
      lastUsedAt: meta.lastUsedAt,
      lastOkAt: meta.lastOkAt,
      requestCount: meta.requestCount,
      reusedCount: meta.reusedCount,
      lastLocalPort: meta.lastLocalPort,
      connectionAgeMs: Date.now() - meta.createdAt,
      lastError: meta.lastError,
      lastResetAt: meta.lastResetAt,
      cooldownUntil: meta.cooldownUntil,
    }));
    return { h1Agents: agents.size, h2Sessions: sessions.size, enabledProtocols: sessions.size ? ['h2', 'h1'] : ['h1'], connections };
  }

  return { getAgent, getHttp2Session, request, prewarm, markFailure, prioritizeIps, clear, snapshot };
}

module.exports = { createSteamAccessConnectionPool, routeKey, servernameForStrategy, originForIp };
