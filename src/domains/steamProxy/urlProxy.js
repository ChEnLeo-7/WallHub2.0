'use strict';

const steamProxyHttp = require('./http');
const { createSteamProxyHeaderProfile } = require('./headerProfile');

function wallhubProxyPort(target) {
  return target.port ? parseInt(target.port, 10) : (target.protocol === 'http:' ? 80 : 443);
}

function isExtensionlessBroadcastMediaManifest(text, target) {
  return !!target && /\/broadcast\//i.test(String(target.pathname || '')) &&
    /^\s*(?:<\?xml[^>]*>\s*)?<MPD\b/i.test(String(text || ''));
}

function createWallhubUrlProxyTools(options = {}) {
  const userAgent = options.userAgent || 'WallHub';
  const steamPrefCookie = options.steamPrefCookie || '';
  const virtualHostParam = options.virtualHostParam || '__whp_host';
  const logger = options.logger || console;
  const isSteamHost = options.isSteamHost || (() => false);
  const isSteamAccessGatewayHost = options.isSteamAccessGatewayHost || (() => false);
  const isSteamStaticCdnHost = options.isSteamStaticCdnHost || (() => false);
  const isSteamBroadcastResource = options.isSteamBroadcastResource || (() => false);
  const isSteamAccessStaticBypassHost = options.isSteamAccessStaticBypassHost || (() => false);
  const isAuthApiTarget = options.isAuthApiTarget || (() => false);
  const isWebApiServiceTarget = options.isWebApiServiceTarget || (() => false);
  const isProxyHtmlType = options.isProxyHtmlType || (() => false);
  const isProxyStaticAsset = options.isProxyStaticAsset || (() => false);
  const headerValue = options.headerValue || (() => '');
  const upstreamCookie = options.upstreamCookie || (() => '');
  const upstreamCookieValue = options.upstreamCookieValue || (() => '');
  const transformSetCookie = options.transformSetCookie || (() => []);
  const urlProxyPath = options.urlProxyPath || ((location) => location);
  const parseProxyTarget = options.parseProxyTarget || (() => null);
  const parseVirtualProxyTarget = options.parseVirtualProxyTarget || (() => null);
  const virtualProxyPath = options.virtualProxyPath || (() => '');
  const isVirtualLoginPath = options.isVirtualLoginPath || (() => false);
  const inferContentType = options.inferContentType || (() => 'application/octet-stream');
  const jsonRes = options.jsonRes || (() => {});
  const readBodyBuffer = options.readBodyBuffer || (() => Promise.resolve(Buffer.alloc(0)));
  const decodeBody = options.decodeBody || ((body) => Buffer.isBuffer(body) ? body : Buffer.from(body || ''));
  const rewrite = options.rewrite || {};
  const cache = options.cache || {};
  const requestOnceImpl = options.requestOnce || (() => Promise.reject(new Error('Wallhub URL proxy requester missing')));
  const requestStreamImpl = options.requestStream || ((target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions) =>
    requestOnceImpl(target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions));
  const bufferResponseImpl = options.bufferResponse || ((response) => new Promise((resolve, reject) => {
    const buffers = [];
    response.on('data', (d) => buffers.push(Buffer.from(d)));
    response.on('end', () => resolve({
      statusCode: response.statusCode || 502,
      statusMessage: response.statusMessage || '',
      headers: response.headers || {},
      body: Buffer.concat(buffers),
    }));
    response.on('error', reject);
  }));
  const gatewayEnabled = options.gatewayEnabled || (() => false);
  const requestByGatewayStream = options.requestByGatewayStream || null;
  const getProxyCandidates = options.getProxyCandidates || (() => [null]);
  const shouldRetryWithNextProxy = options.shouldRetryWithNextProxy || (() => false);
  const getSteamAccessPolicy = options.getSteamAccessPolicy || (() => null);
  const headerProfile = createSteamProxyHeaderProfile({
    userAgent,
    getExperimental: () => {
      const policy = getSteamAccessPolicy('steamcommunity.com') || {};
      return policy.experimental || {};
    },
  });
  const prefetching = new Set();

  function shouldCacheTarget(target, method, reqHeaders = {}, contentType = '') {
    if (String(method || 'GET').toUpperCase() !== 'GET') return false;
    if (headerValue(reqHeaders, 'range')) return false;
    if (!isSteamHost(target.hostname)) return false;
    if (isAuthApiTarget(target)) return false;
    if (isProxyHtmlType(contentType, target)) return false;
    const pathname = String(target && target.pathname || '').toLowerCase();
    if (/\.(?:mp4|webm|m4v|mov|m4s|ts)(?:$|[?#])/i.test(pathname)) return false;
    if (/^(?:video|audio)\//i.test(String(contentType || ''))) return false;
    return isProxyStaticAsset(target, contentType);
  }

  function cachePaths(target) {
    return cache.pathsFor(target);
  }

  async function readCache(target, method, reqHeaders = {}) {
    return cache.read(target, method, reqHeaders);
  }

  async function writeCache(target, response) {
    return cache.write(target, response);
  }

  function cleanupCacheSoon() {
    return cache.cleanupSoon();
  }

  async function cleanupCache() {
    return cache.cleanup();
  }

  function referer(value, target) {
    const fallback = `${target.protocol}//${target.host}/`;
    if (!value) return fallback;
    try {
      const local = new URL(String(value), 'http://x');
      const raw = local.searchParams.get('url');
      if (raw) {
        const upstream = new URL(raw);
        if (/^https?:$/i.test(upstream.protocol) && isSteamHost(upstream.hostname)) {
          upstream.searchParams.delete(virtualHostParam);
          return upstream.toString();
        }
      }
      const host = String(local.searchParams.get(virtualHostParam) || '').trim().toLowerCase();
      if (host && isSteamHost(host)) {
        local.searchParams.delete(virtualHostParam);
        return `https://${host}${local.pathname}${local.search}${local.hash || ''}`;
      }
    } catch {}
    return fallback;
  }

  function origin(value, target) {
    if (!value && isAuthApiTarget(target)) return 'https://steamcommunity.com';
    const fallback = `${target.protocol}//${target.host}`;
    const ref = referer(value, target);
    try {
      const upstream = new URL(ref);
      if (/^https?:$/i.test(upstream.protocol) && isSteamHost(upstream.hostname)) {
        return `${upstream.protocol}//${upstream.host}`;
      }
    } catch {}
    return fallback;
  }

  function isLoopbackOrPrivateOrigin(value) {
    try {
      const parsed = new URL(String(value || ''));
      if (!/^https?:$/i.test(parsed.protocol)) return false;
      const host = String(parsed.hostname || '').toLowerCase().replace(/^\[|\]$/g, '');
      if (host === 'localhost' || host === '::1' || /^127\./.test(host)) return true;
      if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
      if (/^172\.(?:1[6-9]|2\d|3[01])\./.test(host)) return true;
      return /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(host);
    } catch {
      return false;
    }
  }

  function normalizeSteamApiOrigin(target, refererValue) {
    if (!target || !isWebApiServiceTarget(target)) return;
    const current = String(target.searchParams.get('origin') || '').trim();
    if (current && !isLoopbackOrPrivateOrigin(current)) return;
    const nextOrigin = origin(refererValue, target);
    if (/^https?:\/\/[^/]+/i.test(nextOrigin) && isSteamHost(new URL(nextOrigin).hostname)) {
      target.searchParams.set('origin', nextOrigin);
    }
  }

  function isDocumentNavigationRequest(req, method = 'GET') {
    if (!['GET', 'HEAD'].includes(String(method || 'GET').toUpperCase())) return false;
    const accept = String(req.headers.accept || '');
    const fetchDest = String(req.headers['sec-fetch-dest'] || '');
    const fetchMode = String(req.headers['sec-fetch-mode'] || '');
    return fetchDest === 'document' || fetchMode === 'navigate' || /text\/html/i.test(accept);
  }

  function buildProxyRedirectHeaders(target, upstreamHeaders, location) {
    const headers = {
      'Location': urlProxyPath(location, target.toString()),
      'Cache-Control': 'no-store',
    };
    const setCookie = transformSetCookie(upstreamHeaders && upstreamHeaders['set-cookie'], target.hostname);
    if (setCookie.length) headers['Set-Cookie'] = setCookie;
    return headers;
  }

  function collectUpstreamSetCookies(setCookie, hostname, jar) {
    const values = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean);
    const host = String(hostname || '').toLowerCase();
    for (const value of values) {
      const parts = String(value || '').split(';');
      const first = parts.shift() || '';
      const idx = first.indexOf('=');
      if (idx <= 0) continue;
      let domain = host;
      for (const rawAttr of parts) {
        const attr = rawAttr.trim();
        if (!/^domain=/i.test(attr)) continue;
        const candidate = attr.slice(attr.indexOf('=') + 1).trim().replace(/^\./, '').toLowerCase();
        if (candidate && (host === candidate || host.endsWith(`.${candidate}`)) && isSteamHost(candidate)) domain = candidate;
      }
      const name = first.slice(0, idx).trim();
      if (!name) continue;
      const key = `${domain}\n${name}`;
      jar.set(key, { domain, name, value: first.slice(idx + 1) });
    }
  }

  function redirectJarCookieHeader(jar, hostname) {
    const host = String(hostname || '').toLowerCase();
    const items = [];
    for (const cookie of jar.values()) {
      if (!cookie || !cookie.domain || !cookie.name) continue;
      if (host === cookie.domain || host.endsWith(`.${cookie.domain}`)) items.push(`${cookie.name}=${cookie.value}`);
    }
    return items.join('; ');
  }

  function buildRequestHeaders(req, target, body, method = 'GET', extraCookie = '') {
    const upstreamReferer = referer(req.headers.referer, target);
    const cookie = upstreamCookie(req.headers.cookie, target.hostname);
    const headers = headerProfile.build(req, target, {
      method,
      body,
      referer: upstreamReferer,
      origin: (req.headers.origin || !['GET', 'HEAD'].includes(String(method || 'GET').toUpperCase())) ? origin(req.headers.referer, target) : '',
      contentType: req.__wallhubProxyContentType || req.headers['content-type'] || '',
      cookie: [steamPrefCookie, cookie, extraCookie].filter(Boolean).join('; '),
    });
    if (isWebApiServiceTarget(target)) {
      for (const [name, value] of Object.entries(req.headers || {})) {
        const lower = String(name || '').toLowerCase();
        if (!lower.startsWith('x-')) continue;
        if (['x-forwarded-for', 'x-forwarded-host', 'x-forwarded-proto'].includes(lower)) continue;
        if (value) headers[name] = value;
      }
    }
    return headers;
  }

  function isSteamLoginFinalizeTarget(target) {
    return String(target && target.hostname || '').toLowerCase() === 'login.steampowered.com' &&
      /^\/jwt\/finalizelogin\/?$/i.test(String(target && target.pathname || ''));
  }

  function localProxyValueToSteamUrl(value, refererValue, target) {
    const raw = String(value || '').trim();
    if (!raw) return value;
    let parsed = null;
    try { parsed = new URL(raw, 'http://localhost'); } catch { return value; }
    const host = String(parsed.hostname || '').toLowerCase();
    const isLocal = host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1';
    const isProxyPath = /^\/(?:url\/proxy|login|app)(?:\/|\?|$)/i.test(raw);
    const hasProxyMarker = parsed.searchParams.has('url') || parsed.searchParams.has(virtualHostParam);
    // Only rewrite explicit local-proxy references. Opaque tokens (e.g. the
    // finalizelogin nonce JWT, sessionid) must be preserved verbatim — the
    // previous fallback rewritten anything new URL() could parse into an
    // absolute steam URL, corrupting the nonce and breaking jwt lookup.
    if (!isLocal && !isProxyPath && !hasProxyMarker) return value;
    const proxiedRaw = parsed.searchParams.get('url');
    if (proxiedRaw) {
      try {
        const upstream = new URL(proxiedRaw);
        if (/^https?:$/i.test(upstream.protocol) && isSteamHost(upstream.hostname)) return upstream.toString();
      } catch {}
    }
    const virtualHost = String(parsed.searchParams.get(virtualHostParam) || '').trim().toLowerCase();
    if (virtualHost && isSteamHost(virtualHost)) {
      parsed.searchParams.delete(virtualHostParam);
      return `https://${virtualHost}${parsed.pathname}${parsed.search}${parsed.hash || ''}`;
    }
    // No explicit proxy indicator (url= / __whp_host=) present — leave intact.
    return value;
  }

  function normalizedLoginParamsFromText(bodyText, refererValue, target) {
    const params = new URLSearchParams(String(bodyText || ''));
    let changed = false;
    for (const [key, value] of Array.from(params.entries())) {
      const next = localProxyValueToSteamUrl(value, refererValue, target);
      if (next !== value) {
        params.set(key, next);
        changed = true;
      }
    }
    return { params, changed };
  }

  function normalizeLoginTextBodyValues(bodyText, refererValue, target) {
    const result = normalizedLoginParamsFromText(bodyText, refererValue, target);
    return result.changed ? Buffer.from(result.params.toString(), 'utf8') : null;
  }

  function loginParamsFromMultipartBody(body, contentType, refererValue, target) {
    const match = String(contentType || '').match(/\bboundary=(?:"([^"]+)"|([^;]+))/i);
    const boundary = match && (match[1] || match[2]);
    if (!boundary) return null;
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
    const marker = `--${boundary}`;
    if (!text.includes(marker)) return null;
    const params = new URLSearchParams();
    for (const part of text.split(marker)) {
      if (!part || part === '--' || part === '--\r\n') continue;
      const sep = part.indexOf('\r\n\r\n');
      if (sep < 0) continue;
      const header = part.slice(0, sep);
      if (!/content-disposition:\s*form-data/i.test(header) || /filename=/i.test(header)) continue;
      const nameMatch = header.match(/\bname="([^"]+)"/i);
      if (!nameMatch) continue;
      const tail = part.slice(sep + 4);
      const value = tail.endsWith('\r\n') ? tail.slice(0, -2) : tail;
      params.append(nameMatch[1], localProxyValueToSteamUrl(value, refererValue, target));
    }
    return params;
  }

  function normalizeLoginMultipartBody(body, contentType, refererValue, target) {
    const match = String(contentType || '').match(/\bboundary=(?:"([^"]+)"|([^;]+))/i);
    const boundary = match && (match[1] || match[2]);
    if (!boundary) return null;
    const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
    const marker = `--${boundary}`;
    if (!text.includes(marker)) return null;
    let changed = false;
    const parts = text.split(marker).map((part) => {
      if (!part || part === '--' || part === '--\r\n') return part;
      const sep = part.indexOf('\r\n\r\n');
      if (sep < 0) return part;
      const header = part.slice(0, sep);
      const lowerHeader = header.toLowerCase();
      if (!/content-disposition:\s*form-data/i.test(header) || /filename=/i.test(header)) return part;
      const tail = part.slice(sep + 4);
      const ending = tail.endsWith('\r\n') ? '\r\n' : '';
      const value = ending ? tail.slice(0, -2) : tail;
      const next = localProxyValueToSteamUrl(value, refererValue, target);
      if (next !== value) {
        changed = true;
        return `${header}\r\n\r\n${next}${ending}`;
      }
      return part;
    });
    return changed ? Buffer.from(parts.join(marker), 'utf8') : null;
  }

  function looksLikeSteamSessionId(value) {
    return /^[0-9a-f]{16,40}$/i.test(String(value || '').trim());
  }

  function steamLoginSessionHostCandidates(target, refererValue) {
    const hosts = [];
    const add = (host) => {
      const value = String(host || '').trim().toLowerCase();
      if (value && isSteamHost(value) && !hosts.includes(value)) hosts.push(value);
    };
    add(target && target.hostname);
    try { add(new URL(refererValue).hostname); } catch {}
    add('steamcommunity.com');
    add('store.steampowered.com');
    add('login.steampowered.com');
    return hosts;
  }

  function sessionIdFromProxyCookies(cookieHeader, target, refererValue) {
    for (const host of steamLoginSessionHostCandidates(target, refererValue)) {
      const value = upstreamCookieValue(cookieHeader, host, 'sessionid');
      if (looksLikeSteamSessionId(value)) return value;
    }
    return '';
  }

  function normalizeSteamLoginSessionId(params, cookieHeader, refererValue, target) {
    if (!params || !isSteamLoginFinalizeTarget(target)) return false;
    // The proxy namespaces Steam cookies (whp_<host>_<name>), so the browser-
    // side JS cannot read the real `sessionid` cookie and the value it puts in
    // the finalizelogin body is unreliable. The sessionid recorded in our proxy
    // cookie store is authoritative — always prefer it.
    const cookieSessionId = sessionIdFromProxyCookies(cookieHeader, target, refererValue);
    if (!cookieSessionId) return false;
    const current = String(params.get('sessionid') || '').trim();
    if (current === cookieSessionId) return false;
    params.set('sessionid', cookieSessionId);
    if (process.env.WALLHUB_PROXY_AUTH_DEBUG === '1') {
      logger.log(`[UrlProxy] Steam finalizelogin sessionid corrected ${current.length || 0}->${cookieSessionId.length}`);
    }
    return true;
  }

  function normalizeSteamLoginPostBody(body, contentType, refererValue, target, cookieHeader = '') {
    if (!body || !body.length || !isSteamLoginFinalizeTarget(target)) return { body, contentType };
    if (/multipart\/form-data/i.test(String(contentType || ''))) {
      const params = loginParamsFromMultipartBody(body, contentType, refererValue, target);
      if (params && Array.from(params.keys()).length) {
        normalizeSteamLoginSessionId(params, cookieHeader, refererValue, target);
        return {
          body: Buffer.from(params.toString(), 'utf8'),
          contentType: 'application/x-www-form-urlencoded; charset=UTF-8',
        };
      }
      return { body: normalizeLoginMultipartBody(body, contentType, refererValue, target) || body, contentType };
    }
    if (/application\/x-www-form-urlencoded/i.test(String(contentType || ''))) {
      const result = normalizedLoginParamsFromText(body.toString('utf8'), refererValue, target);
      const sessionChanged = normalizeSteamLoginSessionId(result.params, cookieHeader, refererValue, target);
      return { body: (result.changed || sessionChanged) ? Buffer.from(result.params.toString(), 'utf8') : body, contentType };
    }
    return { body, contentType };
  }

  function logSteamLoginPostDebug(body, contentType, target) {
    if (process.env.WALLHUB_PROXY_AUTH_DEBUG !== '1' || !isSteamLoginFinalizeTarget(target)) return;
    const ct = String(contentType || '');
    const labels = [];
    if (/multipart\/form-data/i.test(ct)) {
      const match = ct.match(/\bboundary=(?:"([^"]+)"|([^;]+))/i);
      const boundary = match && (match[1] || match[2]);
      const text = Buffer.isBuffer(body) ? body.toString('utf8') : String(body || '');
      if (boundary) {
        for (const part of text.split(`--${boundary}`)) {
          const name = part.match(/\bname="([^"]+)"/i);
          if (!name) continue;
          const sep = part.indexOf('\r\n\r\n');
          const value = sep >= 0 ? part.slice(sep + 4).replace(/\r\n$/, '') : '';
          labels.push(`${name[1]}:${value.length}`);
        }
      }
    } else if (/application\/x-www-form-urlencoded/i.test(ct)) {
      const params = new URLSearchParams(Buffer.isBuffer(body) ? body.toString('utf8') : String(body || ''));
      for (const [key, value] of params.entries()) labels.push(`${key}:${String(value || '').length}`);
    }
    logger.log(`[UrlProxy] Steam finalizelogin request contentType=${ct || 'unknown'} fields=${labels.join(',') || 'none'}`);
  }

  function requestOnce(target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions = {}) {
    return requestOnceImpl(target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions);
  }

  function isTransientProxyNetworkError(error) {
    return /client network socket disconnected|secure tls connection|socket hang up|ecconnreset|econnreset|etimedout|timed? out|failed to connect|connection.*(?:reset|closed|refused)|tls|ssl/i
      .test(String(error && error.message ? error.message : error || ''));
  }

  async function requestUrl(target, method, headers, body) {
    const timeout = 45000;
    const port = wallhubProxyPort(target);
    const cached = await readCache(target, method, headers);
    if (cached) return { statusCode: cached.statusCode, headers: cached.headers, body: cached.body, stream: null };

    const fetchStream = (proxy, gatewayIp, gatewayOptions = {}) =>
      requestStreamImpl(target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions);

    const useSteamAccessRoute = gatewayEnabled() &&
      target.protocol === 'https:' &&
      !isSteamAccessStaticBypassHost(target.hostname) &&
      (isSteamAccessGatewayHost(target.hostname) || isSteamBroadcastResource(target.hostname, target.pathname));
    if (useSteamAccessRoute) {
      if (typeof requestByGatewayStream !== 'function') {
        logger.warn(`[SteamAccess] ${target.hostname} gateway forwarder missing, fallback to normal proxy path`);
      } else {
      try {
        const s = await requestByGatewayStream(target, method, headers, body, timeout);
        return { statusCode: s.statusCode || 200, headers: s.headers || {}, body: null, stream: s };
      } catch (e) {
        logger.warn(`[SteamAccess] ${target.hostname} gateway forwarder failed, fallback to normal proxy path: ${e.message}`);
      }
      }
    }

    const proxies = getProxyCandidates(target.protocol, target.hostname);
    let lastErr = null;
    for (const proxy of proxies) {
      try {
        const s = await fetchStream(proxy, '');
        return { statusCode: s.statusCode || 200, headers: s.headers || {}, body: null, stream: s };
      } catch (e) {
        lastErr = e;
        if (!shouldRetryWithNextProxy(e) && !isTransientProxyNetworkError(e)) break;
      }
    }
    if (lastErr && isTransientProxyNetworkError(lastErr)) {
      throw Object.assign(new Error(`Wallhub URL proxy failed: ${target.hostname} is unreachable or the TLS connection was interrupted`), { cause: lastErr });
    }
    throw lastErr || new Error('Wallhub URL proxy request failed');
  }

  function responseHeaders(target, upstreamHeaders, contentType, bodyLength, rewriteText, isHead) {
    return steamProxyHttp.createWallhubProxyResponseHeaders(target, upstreamHeaders, contentType, bodyLength, rewriteText, isHead, {
      isAuthApiTarget,
      isWebApiServiceTarget,
      urlProxyPath,
      transformSetCookie,
    });
  }

  function prefetchTargets(targets, reqHeaders) {
    for (const target of targets || []) {
      const key = target.toString();
      if (prefetching.has(key)) continue;
      prefetching.add(key);
      const headers = {
        'User-Agent': userAgent,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',
        'Host': target.host,
        'Referer': reqHeaders && reqHeaders.referer ? reqHeaders.referer : 'https://steamcommunity.com/',
        'Cookie': steamPrefCookie,
      };
      requestUrl(target, 'GET', headers, null)
        .then(async (upstream) => {
          if (!upstream || !upstream.stream) return;
          const ct = String((upstream.headers || {})['content-type'] || '');
          if (shouldCacheTarget(target, 'GET', headers, ct)) {
            const buffered = await bufferResponseImpl(upstream.stream);
            writeCache(target, buffered).catch(() => {});
          } else {
            upstream.stream.destroy();
          }
        })
        .catch(() => {})
        .finally(() => prefetching.delete(key));
    }
  }

  function steamPublicBaseFromReferer(req, rel = '') {
    const relative = String(rel || '').replace(/^\/+/, '');
    if (/^(?:javascript|css)\/applications\/community\//i.test(relative)) {
      return 'https://community.fastly.steamstatic.com/public/';
    }
    if (/^(?:javascript|css)\/applications\/store\//i.test(relative)) {
      return 'https://store.fastly.steamstatic.com/public/';
    }
    try {
      const current = new URL(req.url, 'http://x');
      const host = String(current.searchParams.get(virtualHostParam) || '').trim().toLowerCase();
      if (host && options.isSteamCommunityHost && options.isSteamCommunityHost(host)) {
        return 'https://community.fastly.steamstatic.com/public/';
      }
    } catch {}
    const ref = String(req.headers.referer || req.headers.referrer || '');
    try {
      const local = new URL(ref, 'http://x');
      const raw = local.searchParams.get('url') || '';
      const upstream = raw ? new URL(raw) : null;
      if (upstream && options.isSteamCommunityHost && options.isSteamCommunityHost(upstream.hostname)) {
        return 'https://community.fastly.steamstatic.com/public/';
      }
      const host = String(local.searchParams.get(virtualHostParam) || '').trim().toLowerCase();
      if (host && options.isSteamCommunityHost && options.isSteamCommunityHost(host)) {
        return 'https://community.fastly.steamstatic.com/public/';
      }
    } catch {}
    return 'https://store.fastly.steamstatic.com/public/';
  }

  function steamAppRelativeProxyTarget(req) {
    let parsed;
    try { parsed = new URL(req.url, 'http://x'); } catch { return null; }
    const rawRel = String(parsed.pathname || '').replace(/^\/+/, '');
    const match = rawRel.match(/(?:^|\/)((?:javascript|css)\/applications\/.+|shared\/.+)$/i);
    const rel = match ? match[1] : '';
    if (!rel) return null;
    parsed.searchParams.delete(virtualHostParam);
    const qs = parsed.searchParams.toString();
    try {
      return new URL(rel + (qs ? `?${qs}` : ''), steamPublicBaseFromReferer(req, rel));
    } catch {
      return null;
    }
  }

  async function handleSteamAppRelativeAsset(req, res, handleUrlProxy) {
    const target = steamAppRelativeProxyTarget(req);
    if (!target || !isSteamHost(target.hostname)) return false;
    req.url = urlProxyPath(target.toString(), target.toString());
    await handleUrlProxy(req, res);
    return true;
  }

  async function handleVirtualSteamProxy(req, res, handleUrlProxy) {
    const target = parseVirtualProxyTarget(req);
    if (!target) return false;
    try {
      const original = new URL(req.url, 'http://x');
      if (String(req.method || 'GET').toUpperCase() === 'GET' && /^\/stats\/?$/i.test(original.pathname || '')) {
        const location = virtualProxyPath(target);
        if (location && location !== `${original.pathname || '/'}${original.search || ''}${original.hash || ''}`) {
          res.writeHead(302, {
            'Location': location,
            'Cache-Control': 'no-store',
          });
          res.end();
          return true;
        }
      }
    } catch {}
    req.__wallhubVirtualSteamProxy = true;
    req.url = `/url/proxy/?url=${encodeURIComponent(target.toString())}`;
    await handleUrlProxy(req, res);
    return true;
  }

  async function handleUrlProxy(req, res) {
    const method = String(req.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'POST'].includes(method)) {
      return jsonRes(res, 405, { error: 'Only GET, HEAD and POST are supported' });
    }
    let target;
    try {
      target = parseProxyTarget(req);
    } catch {
      target = null;
    }
    if (!target) return jsonRes(res, 400, { error: 'Invalid or unsupported Steam proxy URL' });
    normalizeSteamApiOrigin(target, req.headers.referer || req.headers.referrer || '');
    if (!req.__wallhubVirtualSteamProxy && method === 'GET' && isVirtualLoginPath(target.pathname)) {
      if (isDocumentNavigationRequest(req, method)) {
        const location = virtualProxyPath(target);
        if (location) {
          res.writeHead(302, {
            'Location': location,
            'Cache-Control': 'no-store',
          });
          res.end();
          return;
        }
      }
    }
    try {
      let requestBody = method === 'POST' ? await readBodyBuffer(req) : null;
      const normalizedPost = normalizeSteamLoginPostBody(requestBody, req.headers['content-type'] || '', req.headers.referer || req.headers.referrer || '', target, req.headers.cookie || '');
      requestBody = normalizedPost.body;
      req.__wallhubProxyContentType = normalizedPost.contentType;
      logSteamLoginPostDebug(requestBody, req.__wallhubProxyContentType || req.headers['content-type'] || '', target);
      let headers = buildRequestHeaders(req, target, requestBody, method);
      const redirectCookieJar = new Map();
      if (process.env.WALLHUB_PROXY_AUTH_DEBUG === '1' && method === 'POST' && /\/login\/settoken\/?$/i.test(target.pathname || '')) {
        logger.log(`[UrlProxy] Steam settoken ARRIVED ${method} ${target.hostname}${target.pathname}`);
      }
      let upstream = await requestUrl(target, method, headers, requestBody);
      if ((method === 'GET' || method === 'HEAD') && upstream && upstream.headers) {
        const seenRedirects = new Set([target.toString()]);
        for (let redirectCount = 0; redirectCount < 5; redirectCount++) {
          const status = Number(upstream.statusCode || 0);
          const location = upstream.headers && upstream.headers.location;
          if (![301, 302, 303, 307, 308].includes(status) || !location) break;
          let nextTarget = null;
          try { nextTarget = new URL(String(location), target.toString()); } catch { break; }
          if (!/^https?:$/i.test(nextTarget.protocol) || !isSteamHost(nextTarget.hostname)) break;
          collectUpstreamSetCookies(upstream.headers && upstream.headers['set-cookie'], target.hostname, redirectCookieJar);
          if (isDocumentNavigationRequest(req, method)) {
            if (upstream.stream) {
              try { upstream.stream.destroy(); } catch {}
            }
            res.writeHead(status, buildProxyRedirectHeaders(target, upstream.headers || {}, location));
            res.end();
            return;
          }
          const key = nextTarget.toString();
          if (seenRedirects.has(key)) break;
          seenRedirects.add(key);
          if (upstream.stream) {
            try { upstream.stream.destroy(); } catch {}
          }
          target = nextTarget;
          normalizeSteamApiOrigin(target, req.headers.referer || req.headers.referrer || '');
          headers = buildRequestHeaders(req, target, requestBody, method, redirectJarCookieHeader(redirectCookieJar, target.hostname));
          upstream = await requestUrl(target, method, headers, requestBody);
        }
      }
      const upstreamHeaders = upstream.headers || {};
      const upstreamContentType = String(upstreamHeaders['content-type'] || '');
      // requestUrl returns either a cached buffered body or a live stream.
      let body = upstream.body || null;
      let stream = upstream.stream || null;
      const cachedHit = !!body;
      const contentType = upstreamContentType || (body
        ? inferContentType(target, req.headers.accept, body)
        : inferContentType(target, req.headers.accept, Buffer.alloc(0)));
      const isHtml = isProxyHtmlType(contentType, target);
      const pathExt = typeof rewrite.pathExt === 'function' ? rewrite.pathExt(target) : '';
      const isText = typeof rewrite.isTextType === 'function' ? rewrite.isTextType(contentType, target) : false;
      const willCache = !cachedHit && shouldCacheTarget(target, method, headers, contentType);
      // Buffer only when we must (text to rewrite, or a cacheable static asset).
      // Everything else (e.g. video Range responses) streams straight through so
      // the client can start playing before the whole body is downloaded.
      const mustBuffer = isText || willCache || isWebApiServiceTarget(target);
      if (stream && mustBuffer) {
        const buffered = await bufferResponseImpl(stream);
        body = decodeBody(buffered.body || Buffer.alloc(0), buffered.headers || {});
        stream = null;
        if (willCache) writeCache(target, buffered).catch(() => {});
      } else if (body) {
        body = decodeBody(body, upstreamHeaders);
      }

      if (process.env.WALLHUB_PROXY_AUTH_DEBUG === '1' && /\/login\/settoken\/?$/i.test(target.pathname || '')) {
        const rawSetCookies = upstreamHeaders['set-cookie'];
        const setCookies = rawSetCookies ? (Array.isArray(rawSetCookies) ? rawSetCookies : String(rawSetCookies).split(/\r?\n/)) : [];
        const reqCookie = String(req.headers.cookie || '');
        const sentSession = /sessionid=([^;]+)/.test(reqCookie) ? 'yes' : 'no';
        const len = body ? body.length : (stream ? '-' : 0);
        logger.log(`[UrlProxy] Steam settoken ${method} ${target.hostname}${target.pathname} status=${upstream.statusCode || 0} setCookies=${setCookies.length} sentSessionCookie=${sentSession} bytes=${len}`);
      }
      if (isWebApiServiceTarget(target) && process.env.WALLHUB_PROXY_AUTH_DEBUG === '1') {
        logger.log(`[UrlProxy] Steam WebAPI ${target.pathname} status=${upstream.statusCode || 0} eresult=${upstreamHeaders['x-eresult'] || ''} bytes=${body ? body.length : '-'}`);
      }
      if (isWebApiServiceTarget(target)) {
        if (!body && stream) {
          const b = await bufferResponseImpl(stream);
          body = decodeBody(b.body || Buffer.alloc(0), b.headers || {});
          stream = null;
        }
        res.writeHead(upstream.statusCode || 200, responseHeaders(target, upstreamHeaders, contentType || 'application/octet-stream', body ? body.length : 0, false, method === 'HEAD'));
        if (method === 'HEAD') res.end();
        else res.end(body || Buffer.alloc(0));
        return;
      }

      // Streaming pass-through: binary content that is not rewritten and not
      // cached. Pipe upstream -> client directly.
      if (stream && !mustBuffer) {
        const streamHeaders = responseHeaders(target, upstreamHeaders, contentType || 'application/octet-stream', null, false, method === 'HEAD');
        if (upstreamHeaders['content-length'] && method !== 'HEAD') {
          streamHeaders['Content-Length'] = String(upstreamHeaders['content-length']);
        }
        res.writeHead(upstream.statusCode || 200, streamHeaders);
        if (method === 'HEAD') { stream.destroy(); res.end(); return; }
        stream.on('error', () => { try { res.destroy(); } catch {} });
        req.on('close', () => { try { stream.destroy(); } catch {} });
        stream.pipe(res);
        return;
      }

      const isCss = /^text\/css/i.test(contentType) || pathExt === '.css';
      const isJson = /(?:^|[/+])json(?:;|$)/i.test(contentType) || pathExt === '.json';
      const inputText = isText ? (body || Buffer.alloc(0)).toString('utf8') : '';
      const isMediaManifest = pathExt === '.m3u8' || pathExt === '.mpd' || /(?:mpegurl|dash\+xml)/i.test(contentType) ||
        isExtensionlessBroadcastMediaManifest(inputText, target);
      const isScript = /(?:javascript|ecmascript)/i.test(contentType) || /\.(?:js|mjs)(?:$|\?)/i.test(target.pathname);
      const shouldRewriteBodyText = isText && rewrite.shouldRewriteText(inputText, contentType, target);
      // Steam's login JS validates transfer_info[].url must be https://*.steampowered.com.
      // Server-side rewriting them to /url/proxy/?url=... caused the settoken broadcast
      // to be silently skipped. Skip the rewrite for the finalizelogin response and let
      // the injected client script proxy the absolute Steam URLs at fetch/XHR time.
      const rewriteThisBody = shouldRewriteBodyText && !isSteamLoginFinalizeTarget(target);
      if (process.env.WALLHUB_PROXY_AUTH_DEBUG === '1' && /(?:login\.steampowered\.com|api\.steampowered\.com)$/i.test(target.hostname) && isJson) {
        const compact = inputText.replace(/\s+/g, ' ').slice(0, 600);
        logger.log(`[UrlProxy] Steam login JSON ${target.hostname}${target.pathname} status=${upstream.statusCode || 0} bytes=${(body || Buffer.alloc(0)).length} body=${compact}`);
      }
      let rewrittenText = '';
      if (rewriteThisBody) {
        if (isHtml) {
          rewrittenText = rewrite.html(inputText, target.toString());
        } else if (isScript && typeof rewrite.jsText === 'function') {
          rewrittenText = rewrite.jsText(inputText, target.toString());
        } else if (isCss) {
          rewrittenText = rewrite.css(inputText, target.toString());
        } else if (isMediaManifest && typeof rewrite.mediaManifest === 'function') {
          rewrittenText = rewrite.mediaManifest(inputText, target.toString(), `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}`);
        } else if (isJson && typeof rewrite.jsonText === 'function') {
          rewrittenText = rewrite.jsonText(inputText, target.toString());
        } else {
          rewrittenText = rewrite.escapedUrls(inputText, target.toString());
        }
      }
      if (rewriteThisBody && isJson) {
        try { JSON.parse(rewrittenText); }
        catch {
          rewrittenText = inputText;
        }
      }
      const output = rewriteThisBody
        ? Buffer.from(isHtml ? rewrite.injectClientScript(rewrittenText, target.toString()) : rewrittenText, 'utf8')
        : (body || Buffer.alloc(0));
      if (process.env.WALLHUB_PROXY_AUTH_DEBUG === '1' && isSteamLoginFinalizeTarget(target)) {
        const outText = output.toString('utf8');
        const proxySettoken = (outText.match(/\/url\/proxy\/\?url=[^"]*settoken/g) || []).length;
        const rawSettoken = (outText.match(/https?:\\?\/\\?\/[^"']*steampowered\.com\/login\/settoken/g) || []).length;
        logger.log(`[UrlProxy] Steam finalizelogin response: settokenProxyUrls=${proxySettoken} settokenRawUrls=${rawSettoken} rewrote=${rewriteThisBody ? 'yes' : 'no'}`);
      }
      if (isHtml && method === 'GET' && typeof rewrite.collectPrefetchUrls === 'function') {
        prefetchTargets(rewrite.collectPrefetchUrls(inputText, target.toString()), {
          referer: target.toString(),
        });
      }
      res.writeHead(upstream.statusCode || 200, responseHeaders(target, upstreamHeaders, contentType, output.length, rewriteThisBody, method === 'HEAD'));
      if (method === 'HEAD') res.end();
      else res.end(output);
    } catch (e) {
      if (process.env.WALLHUB_PROXY_AUTH_DEBUG === '1' && target && /\/login\/settoken\/?$/i.test(target.pathname || '')) {
        logger.log(`[UrlProxy] Steam settoken FAILED ${target.hostname}${target.pathname} error=${e && e.message ? e.message : e}`);
      }
      jsonRes(res, e.statusCode || 502, { error: e.message || 'Wallhub URL proxy failed' });
    }
  }

  return {
    shouldCacheTarget,
    cachePaths,
    readCache,
    writeCache,
    cleanupCacheSoon,
    cleanupCache,
    referer,
    origin,
    normalizeSteamApiOrigin,
    buildRequestHeaders,
    requestOnce,
    requestUrl,
    responseHeaders,
    prefetchTargets,
    steamPublicBaseFromReferer,
    steamAppRelativeProxyTarget,
    handleSteamAppRelativeAsset,
    handleVirtualSteamProxy,
    handleUrlProxy,
    normalizeSteamLoginPostBody,
    localProxyValueToSteamUrl,
  };
}

module.exports = {
  wallhubProxyPort,
  isExtensionlessBroadcastMediaManifest,
  createWallhubUrlProxyTools,
};
