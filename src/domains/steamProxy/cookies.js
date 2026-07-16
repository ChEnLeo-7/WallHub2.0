'use strict';

const WALLHUB_PROXY_COOKIE_PREFIX = 'whp_';

function base64UrlEncode(value) {
  return Buffer.from(String(value || ''), 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function base64UrlDecode(value) {
  const raw = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = raw + '='.repeat((4 - raw.length % 4) % 4);
  return Buffer.from(padded, 'base64').toString('utf8');
}

function createSteamProxyCookieTools(options = {}) {
  const isSteamHost = typeof options.isSteamHost === 'function' ? options.isSteamHost : () => false;

  function wallhubProxyCookieName(domain, name) {
    return `${WALLHUB_PROXY_COOKIE_PREFIX}${base64UrlEncode(String(domain || '').toLowerCase())}_${base64UrlEncode(name)}`;
  }

  function parseWallhubProxyCookieName(localName) {
    const raw = String(localName || '');
    if (!raw.startsWith(WALLHUB_PROXY_COOKIE_PREFIX)) return null;
    const rest = raw.slice(WALLHUB_PROXY_COOKIE_PREFIX.length);
    const sep = rest.indexOf('_');
    if (sep <= 0) return null;
    try {
      return {
        domain: base64UrlDecode(rest.slice(0, sep)).toLowerCase(),
        name: base64UrlDecode(rest.slice(sep + 1)),
      };
    } catch {
      return null;
    }
  }

  function parseCookieHeader(raw) {
    const out = [];
    for (const part of String(raw || '').split(/;\s*/)) {
      if (!part) continue;
      const idx = part.indexOf('=');
      if (idx <= 0) continue;
      out.push({ name: part.slice(0, idx).trim(), value: part.slice(idx + 1) });
    }
    return out;
  }

  function wallhubProxyDomainMatches(cookieDomain, hostname) {
    const domain = String(cookieDomain || '').replace(/^\./, '').toLowerCase();
    const host = String(hostname || '').toLowerCase();
    if (!domain || !host || !isSteamHost(domain)) return false;
    return host === domain || host.endsWith(`.${domain}`);
  }

  function wallhubProxyUpstreamCookie(cookieHeader, hostname) {
    const items = [];
    for (const cookie of parseCookieHeader(cookieHeader)) {
      const parsed = parseWallhubProxyCookieName(cookie.name);
      if (!parsed || !parsed.name || !wallhubProxyDomainMatches(parsed.domain, hostname)) continue;
      items.push(`${parsed.name}=${cookie.value}`);
    }
    return items.join('; ');
  }

  function wallhubProxyCookieValue(cookieHeader, hostname, upstreamName) {
    const name = String(upstreamName || '');
    if (!name) return '';
    for (const cookie of parseCookieHeader(cookieHeader)) {
      const parsed = parseWallhubProxyCookieName(cookie.name);
      if (!parsed || parsed.name !== name || !wallhubProxyDomainMatches(parsed.domain, hostname)) continue;
      return cookie.value;
    }
    return '';
  }

  function transformWallhubProxySetCookie(setCookie, hostname) {
    const values = Array.isArray(setCookie) ? setCookie : [setCookie].filter(Boolean);
    const out = [];
    const host = String(hostname || '').toLowerCase();
    for (const value of values) {
      const text = String(value || '');
      const parts = text.split(';');
      const first = parts.shift() || '';
      const idx = first.indexOf('=');
      if (idx <= 0) continue;
      const upstreamName = first.slice(0, idx).trim();
      const upstreamValue = first.slice(idx + 1);
      let upstreamDomain = host;
      const attrs = [];
      for (const rawAttr of parts) {
        const attr = rawAttr.trim();
        if (!attr) continue;
        const lower = attr.toLowerCase();
        if (lower.startsWith('domain=')) {
          const candidate = attr.slice(attr.indexOf('=') + 1).trim().replace(/^\./, '').toLowerCase();
          if (wallhubProxyDomainMatches(candidate, host)) upstreamDomain = candidate;
          continue;
        }
        if (lower.startsWith('path=') || lower === 'secure' || lower.startsWith('samesite=')) continue;
        attrs.push(attr);
      }
      const localName = wallhubProxyCookieName(upstreamDomain, upstreamName);
      out.push(`${localName}=${upstreamValue}; Path=/; SameSite=Lax${attrs.length ? `; ${attrs.join('; ')}` : ''}`);
    }
    return out;
  }

  return {
    base64UrlEncode,
    base64UrlDecode,
    wallhubProxyCookieName,
    parseWallhubProxyCookieName,
    parseCookieHeader,
    wallhubProxyDomainMatches,
    wallhubProxyUpstreamCookie,
    wallhubProxyCookieValue,
    transformWallhubProxySetCookie,
  };
}

module.exports = {
  WALLHUB_PROXY_COOKIE_PREFIX,
  base64UrlEncode,
  base64UrlDecode,
  createSteamProxyCookieTools,
};
