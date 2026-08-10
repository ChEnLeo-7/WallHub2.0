'use strict';

function createLoginRequestTools(options) {
  const {
    virtualHostParam,
    isSteamHost,
    upstreamCookieValue,
    logger,
  } = options;

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
    // Opaque values such as the finalizelogin nonce must remain byte-for-byte intact.
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

  return {
    isSteamLoginFinalizeTarget,
    normalizeSteamLoginPostBody,
    localProxyValueToSteamUrl,
    logSteamLoginPostDebug,
  };
}

module.exports = { createLoginRequestTools };
