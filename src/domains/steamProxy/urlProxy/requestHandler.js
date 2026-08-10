'use strict';

const { isExtensionlessBroadcastMediaManifest } = require('./helpers');

function createUrlProxyRequestHandlers(options) {
  const {
    logger,
    isSteamHost,
    isWebApiServiceTarget,
    isProxyHtmlType,
    transformSetCookie,
    urlProxyPath,
    parseProxyTarget,
    parseVirtualProxyTarget,
    virtualProxyPath,
    isVirtualLoginPath,
    inferContentType,
    jsonRes,
    readBodyBuffer,
    decodeBody,
    rewrite,
    bufferResponseImpl,
    shouldCacheTarget,
    writeCache,
    normalizeSteamApiOrigin,
    isDocumentNavigationRequest,
    buildRequestHeaders,
    normalizeSteamLoginPostBody,
    logSteamLoginPostDebug,
    isSteamLoginFinalizeTarget,
    requestUrl,
    responseHeaders,
    prefetchTargets,
  } = options;

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
      jar.set(`${domain}\n${name}`, { domain, name, value: first.slice(idx + 1) });
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

  async function handleVirtualSteamProxy(req, res, handleUrlProxy) {
    const target = parseVirtualProxyTarget(req);
    if (!target) return false;
    try {
      const original = new URL(req.url, 'http://x');
      if (String(req.method || 'GET').toUpperCase() === 'GET' && /^\/stats\/?$/i.test(original.pathname || '')) {
        const location = virtualProxyPath(target);
        if (location && location !== `${original.pathname || '/'}${original.search || ''}${original.hash || ''}`) {
          res.writeHead(302, { 'Location': location, 'Cache-Control': 'no-store' });
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

  async function followRedirects(req, res, target, method, requestBody, headers, upstream) {
    if (!((method === 'GET' || method === 'HEAD') && upstream && upstream.headers)) {
      return { target, headers, upstream, handled: false };
    }
    const redirectCookieJar = new Map();
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
        return { target, headers, upstream, handled: true };
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
    return { target, headers, upstream, handled: false };
  }

  async function handleUrlProxy(req, res) {
    const method = String(req.method || 'GET').toUpperCase();
    if (!['GET', 'HEAD', 'POST'].includes(method)) {
      return jsonRes(res, 405, { error: 'Only GET, HEAD and POST are supported' });
    }
    let target;
    try { target = parseProxyTarget(req); } catch { target = null; }
    if (!target) return jsonRes(res, 400, { error: 'Invalid or unsupported Steam proxy URL' });
    normalizeSteamApiOrigin(target, req.headers.referer || req.headers.referrer || '');
    if (!req.__wallhubVirtualSteamProxy && method === 'GET' && isVirtualLoginPath(target.pathname) && isDocumentNavigationRequest(req, method)) {
      const location = virtualProxyPath(target);
      if (location) {
        res.writeHead(302, { 'Location': location, 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
    }
    try {
      let requestBody = method === 'POST' ? await readBodyBuffer(req) : null;
      const normalizedPost = normalizeSteamLoginPostBody(requestBody, req.headers['content-type'] || '', req.headers.referer || req.headers.referrer || '', target, req.headers.cookie || '');
      requestBody = normalizedPost.body;
      req.__wallhubProxyContentType = normalizedPost.contentType;
      logSteamLoginPostDebug(requestBody, req.__wallhubProxyContentType || req.headers['content-type'] || '', target);
      let headers = buildRequestHeaders(req, target, requestBody, method);
      if (process.env.WALLHUB_PROXY_AUTH_DEBUG === '1' && method === 'POST' && /\/login\/settoken\/?$/i.test(target.pathname || '')) {
        logger.log(`[UrlProxy] Steam settoken ARRIVED ${method} ${target.hostname}${target.pathname}`);
      }
      let upstream = await requestUrl(target, method, headers, requestBody);
      const redirected = await followRedirects(req, res, target, method, requestBody, headers, upstream);
      if (redirected.handled) return;
      ({ target, headers, upstream } = redirected);
      const upstreamHeaders = upstream.headers || {};
      const upstreamContentType = String(upstreamHeaders['content-type'] || '');
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
        const sentSession = /sessionid=([^;]+)/.test(String(req.headers.cookie || '')) ? 'yes' : 'no';
        const len = body ? body.length : (stream ? '-' : 0);
        logger.log(`[UrlProxy] Steam settoken ${method} ${target.hostname}${target.pathname} status=${upstream.statusCode || 0} setCookies=${setCookies.length} sentSessionCookie=${sentSession} bytes=${len}`);
      }
      if (isWebApiServiceTarget(target) && process.env.WALLHUB_PROXY_AUTH_DEBUG === '1') {
        logger.log(`[UrlProxy] Steam WebAPI ${target.pathname} status=${upstream.statusCode || 0} eresult=${upstreamHeaders['x-eresult'] || ''} bytes=${body ? body.length : '-'}`);
      }
      if (isWebApiServiceTarget(target)) {
        if (!body && stream) {
          const buffered = await bufferResponseImpl(stream);
          body = decodeBody(buffered.body || Buffer.alloc(0), buffered.headers || {});
          stream = null;
        }
        res.writeHead(upstream.statusCode || 200, responseHeaders(target, upstreamHeaders, contentType || 'application/octet-stream', body ? body.length : 0, false, method === 'HEAD'));
        if (method === 'HEAD') res.end();
        else res.end(body || Buffer.alloc(0));
        return;
      }
      if (stream && !mustBuffer) {
        const streamHeaders = responseHeaders(target, upstreamHeaders, contentType || 'application/octet-stream', null, false, method === 'HEAD');
        if (upstreamHeaders['content-length'] && method !== 'HEAD') streamHeaders['Content-Length'] = String(upstreamHeaders['content-length']);
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
      const rewriteThisBody = isText && rewrite.shouldRewriteText(inputText, contentType, target) && !isSteamLoginFinalizeTarget(target);
      if (process.env.WALLHUB_PROXY_AUTH_DEBUG === '1' && /(?:login\.steampowered\.com|api\.steampowered\.com)$/i.test(target.hostname) && isJson) {
        logger.log(`[UrlProxy] Steam login JSON ${target.hostname}${target.pathname} status=${upstream.statusCode || 0} bytes=${(body || Buffer.alloc(0)).length} body=${inputText.replace(/\s+/g, ' ').slice(0, 600)}`);
      }
      let rewrittenText = '';
      if (rewriteThisBody) {
        if (isHtml) rewrittenText = rewrite.html(inputText, target.toString());
        else if (isScript && typeof rewrite.jsText === 'function') rewrittenText = rewrite.jsText(inputText, target.toString());
        else if (isCss) rewrittenText = rewrite.css(inputText, target.toString());
        else if (isMediaManifest && typeof rewrite.mediaManifest === 'function') rewrittenText = rewrite.mediaManifest(inputText, target.toString(), `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host || 'localhost'}`);
        else if (isJson && typeof rewrite.jsonText === 'function') rewrittenText = rewrite.jsonText(inputText, target.toString());
        else rewrittenText = rewrite.escapedUrls(inputText, target.toString());
      }
      if (rewriteThisBody && isJson) {
        try { JSON.parse(rewrittenText); } catch { rewrittenText = inputText; }
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
        prefetchTargets(rewrite.collectPrefetchUrls(inputText, target.toString()), { referer: target.toString() });
      }
      res.writeHead(upstream.statusCode || 200, responseHeaders(target, upstreamHeaders, contentType, output.length, rewriteThisBody, method === 'HEAD'));
      if (method === 'HEAD') res.end();
      else res.end(output);
    } catch (error) {
      if (process.env.WALLHUB_PROXY_AUTH_DEBUG === '1' && target && /\/login\/settoken\/?$/i.test(target.pathname || '')) {
        logger.log(`[UrlProxy] Steam settoken FAILED ${target.hostname}${target.pathname} error=${error && error.message ? error.message : error}`);
      }
      jsonRes(res, error.statusCode || 502, { error: error.message || 'Wallhub URL proxy failed' });
    }
  }

  return { handleVirtualSteamProxy, handleUrlProxy };
}

module.exports = { createUrlProxyRequestHandlers };
