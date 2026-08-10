'use strict';

const net = require('net');

const STEAM_DEPOT_RESOLVER_HOSTS = new Set([
  'api.steampowered.com',
  'community.steam-api.com',
]);
const STEAM_DEPOT_CDN_SUFFIXES = [
  '.steamcontent.com',
  '.eccdnx.com',
  '.pphimalayanrt.com',
];
const MAX_BROKER_BODY_BYTES = 4 * 1024 * 1024;
const HOP_BY_HOP_HEADERS = new Set([
  'host',
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'content-length',
  'x-wallhub-resolver-token',
  'x-wallhub-target-host',
  'x-wallhub-target-port',
  'x-wallhub-target-path',
]);

function normalizeHost(hostname) {
  return String(hostname || '')
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/\/.*$/, '')
    .replace(/^\.+/, '')
    .replace(/\.+$/, '');
}

function isLoopbackAddress(address) {
  const value = String(address || '').trim().toLowerCase();
  if (!value) return false;
  if (value === 'localhost' || value === '::1' || value === '0:0:0:0:0:0:0:1') return true;
  if (value.startsWith('::ffff:')) return isLoopbackAddress(value.slice('::ffff:'.length));
  if (net.isIP(value) === 4) return value.startsWith('127.');
  return false;
}

function steamHostAllowedForDepotResolver(hostname) {
  const host = normalizeHost(hostname);
  if (!host || net.isIP(host)) return false;
  if (/[^a-z0-9.-]/i.test(host)) return false;
  if (STEAM_DEPOT_RESOLVER_HOSTS.has(host)) return true;
  if (STEAM_DEPOT_CDN_SUFFIXES.some(suffix => host.endsWith(suffix))) return true;
  return /^[a-z0-9-]+\.steam\.[a-z0-9-]+\.com$/i.test(host);
}

function steamWebApiHost(hostname) {
  return STEAM_DEPOT_RESOLVER_HOSTS.has(normalizeHost(hostname));
}

function tokenFromRequest(req) {
  const headers = req && req.headers || {};
  return String(headers['x-wallhub-resolver-token'] || headers['X-WallHub-Resolver-Token'] || '').trim();
}

function remoteAddressFromRequest(req) {
  return String(req && req.socket && req.socket.remoteAddress || req && req.connection && req.connection.remoteAddress || '').trim();
}

function uniqueIps(values) {
  const out = [];
  const seen = new Set();
  for (const value of values || []) {
    const ip = String(value || '').trim();
    if (!ip || seen.has(ip) || !net.isIP(ip)) continue;
    seen.add(ip);
    out.push(ip);
  }
  return out;
}

function routeLeaseFor(route, source) {
  const routeSource = String(source || route && route.source || '').toLowerCase();
  return {
    type: 'wallhub-steam-webapi-route-lease',
    mode: 'broker-preferred',
    quality: routeSource.includes('application') || routeSource.includes('request') ? 'prime' : 'probed',
    requireApplicationProbe: true,
    ttlMs: 30 * 1000,
    issuedAt: Date.now(),
  };
}

function createInternalSteamResolverHandler(options = {}) {
  const token = String(options.token || '').trim();
  const resolveHost = options.resolveHost;
  const resolveSystemHost = options.resolveSystemHost || resolveHost;
  const chooseRoute = options.chooseRoute;
  const enabled = typeof options.enabled === 'function' ? options.enabled : () => true;
  const jsonRes = options.jsonRes;
  const logger = options.logger || console;
  if (typeof resolveHost !== 'function') throw new Error('resolveHost is required');
  if (typeof jsonRes !== 'function') throw new Error('jsonRes is required');

  return async function handleInternalSteamResolve(req, res) {
    if (!isLoopbackAddress(remoteAddressFromRequest(req))) {
      return jsonRes(res, 403, { error: 'Forbidden' });
    }
    if (!token || tokenFromRequest(req) !== token) {
      return jsonRes(res, 403, { error: 'Forbidden' });
    }
    if (req.method && req.method !== 'GET') {
      return jsonRes(res, 405, { error: 'Method Not Allowed' });
    }

    let host = '';
    let port = 443;
    let useRoute = false;
    try {
      const query = new URL(req.url, 'http://127.0.0.1').searchParams;
      host = normalizeHost(query.get('host'));
      const parsedPort = parseInt(String(query.get('port') || '').trim(), 10);
      if (Number.isFinite(parsedPort) && parsedPort > 0 && parsedPort <= 65535) port = parsedPort;
      useRoute = query.get('route') === '1';
    } catch {
      host = '';
    }
    if (!steamHostAllowedForDepotResolver(host)) {
      return jsonRes(res, 400, { error: 'Host is not allowed' });
    }

    try {
      if (!enabled(host)) {
        const systemResult = await resolveSystemHost(host);
        return jsonRes(res, 200, {
          success: true,
          host,
          port,
          route: false,
          ips: uniqueIps(systemResult && systemResult.ips),
          source: 'system',
          protocol: 'system',
          endpoints: [],
        });
      }
      logger.log?.(`[SteamAccess] internal depot resolver start host=${host}`);
      if (useRoute && steamWebApiHost(host) && typeof chooseRoute === 'function') {
        const route = await chooseRoute(host, port, {
          forceRefresh: false,
          cacheOnly: true,
          requireApplicationProbe: true,
          backgroundRefresh: false,
          maxAgeMs: 10 * 60 * 1000,
        });
        const ips = uniqueIps([route && route.ip].concat(route && route.ips || []));
        if (ips.length) {
          const source = String(route && route.source || 'route');
          return jsonRes(res, 200, {
            success: true,
            host,
            port,
            route: true,
            ips,
            source,
            protocol: String(route && (route.protocol || route.resolverProtocol) || ''),
            endpoints: Array.isArray(route && route.endpoints)
              ? route.endpoints
              : (Array.isArray(route && route.resolverEndpoints) ? route.resolverEndpoints : []),
            lease: routeLeaseFor(route, source),
          });
        }
        return jsonRes(res, 503, {
          success: false,
          code: 'STEAM_WEBAPI_ROUTE_NOT_READY',
          error: 'Steam WebAPI control-plane route is not ready',
          host,
          port,
          route: true,
          ips: [],
        });
      }
      const result = await resolveHost(host);
      logger.log?.(`[SteamAccess] internal depot resolver done host=${host} ips=${Array.isArray(result && result.ips) ? result.ips.length : 0}`);
      return jsonRes(res, 200, {
        success: true,
        host,
        port,
        route: false,
        ips: uniqueIps(result && result.ips),
        source: String(result && result.source || ''),
        protocol: String(result && (result.protocol || result.resolverProtocol) || ''),
        endpoints: Array.isArray(result && result.endpoints)
          ? result.endpoints
          : (Array.isArray(result && result.resolverEndpoints) ? result.resolverEndpoints : []),
      });
    } catch (error) {
      logger.warn('[SteamAccess] internal depot resolver failed:', error.message);
      return jsonRes(res, 502, { error: error.message || 'Resolve failed' });
    }
  };
}

function sanitizeBrokerHeaders(headers = {}) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    const lower = String(key || '').toLowerCase();
    if (!lower || HOP_BY_HOP_HEADERS.has(lower)) continue;
    if (lower.startsWith('x-wallhub-')) continue;
    if (Array.isArray(value)) out[key] = value.join(', ');
    else if (value !== undefined && value !== null) out[key] = String(value);
  }
  if (!out['User-Agent'] && !out['user-agent']) out['User-Agent'] = 'WallHub SteamKit Broker';
  if (!out.Accept && !out.accept) out.Accept = 'application/json,*/*;q=0.8';
  if (!out['Accept-Encoding'] && !out['accept-encoding']) out['Accept-Encoding'] = 'identity';
  return out;
}

function parseBrokerTarget(req) {
  const query = new URL(req.url, 'http://127.0.0.1').searchParams;
  const headers = req && req.headers || {};
  const host = normalizeHost(query.get('host') || headers['x-wallhub-target-host']);
  let port = parseInt(String(query.get('port') || headers['x-wallhub-target-port'] || '443').trim(), 10);
  if (!Number.isFinite(port) || port <= 0 || port > 65535) port = 443;
  let path = String(query.get('path') || headers['x-wallhub-target-path'] || '/').trim();
  if (!path.startsWith('/')) path = `/${path}`;
  if (/^\/\//.test(path) || /[\r\n]/.test(path)) path = '/';
  return { host, port, path };
}

function collectBrokerBody(req, maxBytes = MAX_BROKER_BODY_BYTES) {
  if (!req || req.method === 'GET' || req.method === 'HEAD') return Promise.resolve(Buffer.alloc(0));
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      const buf = Buffer.from(chunk);
      size += buf.length;
      if (size > maxBytes) {
        reject(Object.assign(new Error('Broker request body is too large'), { statusCode: 413 }));
        try { req.destroy(); } catch {}
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function writeBrokerResponse(res, body, method) {
  const buffer = Buffer.isBuffer(body) ? body : Buffer.from(body || '');
  const text = buffer.slice(0, 128).toString('utf8');
  const contentType = /^\s*[\[{]/.test(text) ? 'application/json; charset=utf-8' : 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': String(buffer.length),
    'Cache-Control': 'no-store',
    'X-WallHub-Steam-WebAPI-Broker': '1',
  });
  if (method === 'HEAD') res.end();
  else res.end(buffer);
}

function createInternalSteamWebApiBrokerHandler(options = {}) {
  const token = String(options.token || '').trim();
  const requestSteam = options.requestSteam || options.request;
  const requestDirect = options.requestDirect || requestSteam;
  const enabled = typeof options.enabled === 'function' ? options.enabled : () => true;
  const jsonRes = options.jsonRes;
  const logger = options.logger || console;
  const timeoutMs = Math.max(3000, Number(options.timeoutMs || 10000));
  if (typeof requestSteam !== 'function') throw new Error('requestSteam is required');
  if (typeof jsonRes !== 'function') throw new Error('jsonRes is required');

  return async function handleInternalSteamWebApiBroker(req, res) {
    if (!isLoopbackAddress(remoteAddressFromRequest(req))) {
      return jsonRes(res, 403, { error: 'Forbidden' });
    }
    if (!token || tokenFromRequest(req) !== token) {
      return jsonRes(res, 403, { error: 'Forbidden' });
    }
    if (!['GET', 'POST', 'HEAD'].includes(req.method || 'GET')) {
      return jsonRes(res, 405, { error: 'Method Not Allowed' });
    }

    let target;
    try {
      target = parseBrokerTarget(req);
    } catch {
      return jsonRes(res, 400, { error: 'Invalid target' });
    }
    if (!steamHostAllowedForDepotResolver(target.host)) {
      return jsonRes(res, 400, { error: 'Host is not allowed' });
    }

    try {
      const body = await collectBrokerBody(req);
      const useSteamAccess = enabled(target.host);
      const requestTarget = useSteamAccess ? requestSteam : requestDirect;
      const requestOptions = {
        protocol: 'https:',
        hostname: target.host,
        port: target.port,
        path: target.path,
        method: req.method || 'GET',
        headers: sanitizeBrokerHeaders(req.headers),
        timeout: timeoutMs,
      };
      if (useSteamAccess) requestOptions.routeOptions = {
        requireApplicationProbe: true,
        backgroundRefresh: false,
        maxAgeMs: 10 * 60 * 1000,
      };
      else requestOptions.disableSteamAccessGateway = true;
      const responseBody = await requestTarget(requestOptions, body.length ? body : undefined, timeoutMs);
      return writeBrokerResponse(res, responseBody, req.method || 'GET');
    } catch (error) {
      const statusCode = Number(error && error.statusCode || 502);
      logger.warn('[SteamAccess] internal Steam WebAPI broker failed:', error.message);
      return jsonRes(res, statusCode >= 400 && statusCode <= 599 ? statusCode : 502, {
        error: error.message || 'Steam WebAPI broker failed',
        code: error.code || '',
      });
    }
  };
}

module.exports = {
  createInternalSteamResolverHandler,
  createInternalSteamWebApiBrokerHandler,
  isLoopbackAddress,
  normalizeHost,
  steamHostAllowedForDepotResolver,
};
