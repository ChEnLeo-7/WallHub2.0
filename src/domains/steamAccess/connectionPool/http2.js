'use strict';

const http2 = require('http2');
const tls = require('tls');
const net = require('net');

function createHttp2Pool(options = {}) {
  const sessions = new Map();
  const sessionFailures = new Map();
  const logger = options.logger;
  const metadata = options.metadata;
  const routeKey = options.routeKey;
  const servernameForStrategy = options.servernameForStrategy;
  const originForIp = options.originForIp;

  function getHttp2Session(route, ip, strategy = {}) {
    const key = routeKey(route, ip, strategy, 'h2');
    metadata.ensureMeta(key, route, ip, strategy, 'h2');
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

  function request(route, opts, ip, strategy, timeoutMs) {
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
      req.once('response', (responseHeaders) => {
        req.statusCode = Number(responseHeaders[':status'] || 0);
        req.headers = Object.fromEntries(Object.entries(responseHeaders).filter(([key]) => !key.startsWith(':')));
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

  function clear() {
    for (const session of sessions.values()) {
      try { session.close(); } catch { try { session.destroy(); } catch {} }
    }
    sessions.clear();
    sessionFailures.clear();
  }

  return { getHttp2Session, recordH2Result, request, size: () => sessions.size, clear };
}

module.exports = { createHttp2Pool };
