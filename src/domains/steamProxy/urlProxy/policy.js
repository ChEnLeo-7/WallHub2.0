'use strict';

function createUrlProxyPolicy(options) {
  const {
    virtualHostParam,
    steamPrefCookie,
    isSteamHost,
    isAuthApiTarget,
    isWebApiServiceTarget,
    isProxyHtmlType,
    isProxyStaticAsset,
    headerValue,
    upstreamCookie,
    headerProfile,
    cache,
    isSteamCommunityHost,
  } = options;

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
      if (host && isSteamCommunityHost(host)) return 'https://community.fastly.steamstatic.com/public/';
    } catch {}
    const ref = String(req.headers.referer || req.headers.referrer || '');
    try {
      const local = new URL(ref, 'http://x');
      const raw = local.searchParams.get('url') || '';
      const upstream = raw ? new URL(raw) : null;
      if (upstream && isSteamCommunityHost(upstream.hostname)) return 'https://community.fastly.steamstatic.com/public/';
      const host = String(local.searchParams.get(virtualHostParam) || '').trim().toLowerCase();
      if (host && isSteamCommunityHost(host)) return 'https://community.fastly.steamstatic.com/public/';
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

  async function handleSteamAppRelativeAsset(req, res, handleUrlProxy, urlProxyPath) {
    const target = steamAppRelativeProxyTarget(req);
    if (!target || !isSteamHost(target.hostname)) return false;
    req.url = urlProxyPath(target.toString(), target.toString());
    await handleUrlProxy(req, res);
    return true;
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
    isDocumentNavigationRequest,
    buildRequestHeaders,
    steamPublicBaseFromReferer,
    steamAppRelativeProxyTarget,
    handleSteamAppRelativeAsset,
  };
}

module.exports = { createUrlProxyPolicy };
