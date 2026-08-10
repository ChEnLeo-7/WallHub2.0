'use strict';

const https = require('https');
const tls = require('tls');
const net = require('net');

function createHttp1Pool(options = {}) {
  const agents = new Map();
  const logger = options.logger;
  const metadata = options.metadata;
  const routeKey = options.routeKey;
  const servernameForStrategy = options.servernameForStrategy;
  const isWebApiHost = options.isWebApiHost;
  const connectionReuseEnabled = options.connectionReuseEnabled;
  const ensureHeartbeatTimer = options.ensureHeartbeatTimer;
  const markFailure = options.markFailure;

  function destroyAgentForKey(key) {
    const agent = agents.get(key);
    if (agent) {
      try { agent.destroy(); } catch (error) { logger.warn?.('[SteamAccess] agent destroy failed:', error.message); }
    }
    agents.delete(key);
    const meta = metadata.get(key);
    if (meta) meta.state = 'dead';
  }

  function getAgent(route, ip, strategy = {}) {
    const key = routeKey(route, ip, strategy, 'h1');
    let agent = agents.get(key);
    metadata.ensureMeta(key, route, ip, strategy, 'h1');
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
        freeSocketTimeout: 30000,
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

  function request(route, opts, ip, strategy, timeoutMs, signal) {
    return new Promise((resolve, reject) => {
      const key = routeKey(route, ip, strategy, 'h1');
      const meta = metadata.ensureMeta(key, route, ip, strategy, 'h1');
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
      }, (response) => {
        metadata.recordResponseMeta(key, req, response);
        resolve(response);
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
    for (const agent of agents.values()) {
      try { agent.destroy(); } catch (error) { logger.warn?.('[SteamAccess] agent destroy failed:', error.message); }
    }
    agents.clear();
  }

  return {
    getAgent,
    request,
    destroyAgentForKey,
    getStoredAgent: key => agents.get(key),
    hasAgent: key => agents.has(key),
    size: () => agents.size,
    clear,
  };
}

module.exports = { createHttp1Pool };
