'use strict';

function createRewriteUrlPolicy(options) {
  const {
    virtualHostParam,
    isSteamHost,
    isSteamCommunityHost,
    workshopCommunityTags,
  } = options;

  function isWallhubSteamWebApiServiceTarget(target) {
    const host = String(target && target.hostname || '').toLowerCase();
    const pathname = String(target && target.pathname || '');
    if (host !== 'api.steampowered.com' && host !== 'community.steam-api.com') return false;
    return /^\/I[A-Za-z0-9_]+Service\/[^/]+\/v\d+\/?$/i.test(pathname);
  }

  function wallhubProxyLocalOriginForTarget(current, target) {
    try {
      const raw = current && String(current.searchParams.get('url') || '').trim();
      if (raw) {
        const upstream = new URL(raw);
        if (/^https?:$/i.test(upstream.protocol) && isSteamHost(upstream.hostname)) {
          const upstreamHost = String(upstream.hostname || '').toLowerCase();
          if (upstreamHost === 'api.steampowered.com' || upstreamHost === 'community.steam-api.com') return '';
          return `${upstream.protocol}//${upstream.host}`;
        }
      }
    } catch {}
    try {
      const host = current && String(current.searchParams.get(virtualHostParam) || '').trim().toLowerCase();
      if (host && isSteamHost(host)) return `https://${host}`;
    } catch {}
    try {
      if (target && /login\.steampowered\.com$/i.test(String(target.hostname || ''))) return 'https://store.steampowered.com';
    } catch {}
    return 'https://steamcommunity.com';
  }

  function normalizeWallhubProxyTargetQuery(target, current) {
    try {
      if (!target || !isWallhubSteamWebApiServiceTarget(target)) return;
      const origin = String(target.searchParams.get('origin') || '').trim();
      if (!origin) return;
      let parsed = null;
      try { parsed = new URL(origin); } catch {}
      const host = parsed ? String(parsed.hostname || '').toLowerCase() : '';
      if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host === '::1') {
        target.searchParams.set('origin', wallhubProxyLocalOriginForTarget(current, target));
      }
    } catch {}
  }

  function normalizeWallhubSteamCommunityAssetTarget(target) {
    const host = String(target && target.hostname || '').toLowerCase();
    const pathname = String(target && target.pathname || '');
    if (!isSteamCommunityHost(host) || !/^\/images\/webui\//i.test(pathname)) return target;
    const next = new URL(`https://community.fastly.steamstatic.com/public${pathname}`);
    next.search = target.search;
    next.hash = target.hash;
    return next;
  }

  function wallhubUrlProxyRefererTarget(req) {
    try {
      const ref = String((req && req.headers && (req.headers.referer || req.headers.referrer)) || '').trim();
      if (!ref) return null;
      const local = new URL(ref, 'http://x');
      const raw = String(local.searchParams.get('url') || '').trim();
      if (raw) {
        const upstream = new URL(raw);
        if (/^https?:$/i.test(upstream.protocol) && isSteamHost(upstream.hostname)) return upstream;
      }
      const host = String(local.searchParams.get(virtualHostParam) || '').trim().toLowerCase();
      if (host && isSteamHost(host)) return new URL(`https://${host}${local.pathname}${local.search}${local.hash || ''}`);
    } catch {}
    return null;
  }

  function parseWallhubUrlProxyStaticAssetTarget(current) {
    try {
      const pathname = String(current && current.pathname || '');
      const match = pathname.match(/^\/url\/proxy\/((?:javascript|css)\/applications\/(?:store|community)\/.+)$/i);
      if (!match) return null;
      const rel = match[1].replace(/^\/+/, '');
      const base = /^(?:javascript|css)\/applications\/community\//i.test(rel)
        ? 'https://community.fastly.steamstatic.com/public/'
        : 'https://store.fastly.steamstatic.com/public/';
      const target = new URL(rel, base);
      for (const [key, value] of current.searchParams.entries()) {
        if (key === virtualHostParam) continue;
        target.searchParams.append(key, value);
      }
      return target;
    } catch {
      return null;
    }
  }

  function parseWallhubUrlProxyRelativeTarget(current, req) {
    try {
      const match = String(current && current.pathname || '').match(/^\/url\/proxy\/(.+)$/i);
      if (!match || !match[1] || current.searchParams.has('url') || current.searchParams.has(virtualHostParam)) return null;
      const base = wallhubUrlProxyRefererTarget(req);
      if (!base) return null;
      const target = new URL(match[1].replace(/^\/+/, '') + (current.search || '') + (current.hash || ''), base);
      if (!/^https?:$/i.test(target.protocol) || !isSteamHost(target.hostname)) return null;
      return normalizeWallhubSteamCommunityAssetTarget(target);
    } catch {
      return null;
    }
  }

  function parseWallhubUrlProxySearchTarget(current) {
    const pathname = String(current && current.pathname || '');
    if (!/^\/url\/proxy\/?$/i.test(pathname)) return null;
    if (current.searchParams.has('url') || current.searchParams.has(virtualHostParam)) return null;
    if (!current.searchParams.has('term') && !current.searchParams.has('snr')) return null;
    const target = new URL('https://store.steampowered.com/search/');
    for (const [key, value] of current.searchParams.entries()) {
      if (key === 'url' || key === virtualHostParam) continue;
      target.searchParams.append(key, value);
    }
    return target;
  }

  function parseWallhubUrlProxyTarget(req) {
    const current = new URL(req.url, 'http://x');
    const urlParam = String(current.searchParams.get('url') || '').trim();
    const virtualStatic = parseWallhubUrlProxyStaticAssetTarget(current);
    if (virtualStatic) return virtualStatic;
    const relativeTarget = parseWallhubUrlProxyRelativeTarget(current, req);
    if (relativeTarget) return relativeTarget;
    const searchTarget = parseWallhubUrlProxySearchTarget(current);
    if (searchTarget) return searchTarget;
    let raw = urlParam;
    if (raw && !/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = `https://${raw}`;
    if (!raw) return null;
    const target = new URL(raw);
    for (const [key, value] of current.searchParams.entries()) {
      if (key === 'url' || key === virtualHostParam) continue;
      target.searchParams.append(key, value);
    }
    normalizeWallhubProxyTargetQuery(target, current);
    if (!/^https?:$/i.test(target.protocol) || !isSteamHost(target.hostname)) return null;
    return normalizeWallhubSteamCommunityAssetTarget(target);
  }

  function isWallhubProxyVirtualLoginPath(pathname) {
    return /^\/(?:login(?:\/home)?|oauth\/loginform|openid\/loginform)\/?$/i.test(String(pathname || ''));
  }

  function isSteamStoreHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'store.steampowered.com' || host.endsWith('.store.steampowered.com');
  }

  function isWallhubProxyVirtualStoreServicePath(pathname) {
    const path = String(pathname || '');
    if (!path || path === '/') return false;
    return /^\/(?:app\/\d+(?:\/[^/?#]+)?|appreviews(?:\/|$)|appreviewhistogram(?:\/|$)|ajax[A-Za-z0-9_]*(?:\/|$)|points(?:\/|$)|charts(?:\/|$)|search(?:\/|$)|news(?:\/|$)|category(?:\/|$)|categories(?:\/|$)|genre(?:\/|$)|tags?(?:\/|$)|sale(?:\/|$)|sales(?:\/|$)|curator(?:\/|$)|developer(?:\/|$)|publisher(?:\/|$)|franchise(?:\/|$)|recommended(?:\/|$)|explore(?:\/|$)|wishlist(?:\/|$)|cart(?:\/|$)|account(?:\/|$)|join(?:\/|$)|steamaccount(?:\/|$)|agecheck(?:\/|$)|bundle(?:\/|$)|sub(?:\/|$)|dlc(?:\/|$)|labs(?:\/|$)|hardware(?:\/|$)|about(?:\/|$)|stats(?:\/|$)|remoteplay(?:\/|$)|deck(?:\/|$)|steamdeck(?:\/|$)|events(?:\/|$)|yearinreview(?:\/|$)|replay(?:\/|$))/i.test(path);
  }

  function isWallhubProxyVirtualCommunityServicePath(pathname) {
    const path = String(pathname || '');
    if (!path || path === '/') return false;
    return /^\/(?:app(?:\/|$)|sharedfiles(?:\/|$)|workshop(?:\/|$)|market(?:\/|$)|profiles(?:\/|$)|id(?:\/|$)|gid(?:\/|$)|groups(?:\/|$)|games(?:\/|$)|my(?:\/|$)|friends(?:\/|$)|chat(?:\/|$)|broadcast(?:\/|$)|stats(?:\/|$)|news(?:\/|$)|discussions(?:\/|$)|guide(?:\/|$)|actions(?:\/|$)|linkfilter(?:\/|$)|tradeoffer(?:\/|$)|search(?:\/|$))/i.test(path);
  }

  function isWallhubProxyVirtualSteamPath(pathname) {
    return isWallhubProxyVirtualLoginPath(pathname) ||
      isWallhubProxyVirtualStoreServicePath(pathname) ||
      isWallhubProxyVirtualCommunityServicePath(pathname);
  }

  function canUseWallhubVirtualSteamProxyPath(target) {
    const host = String(target && target.hostname || '').toLowerCase();
    const pathname = String(target && target.pathname || '');
    if (!host || !isSteamHost(host)) return false;
    if (isWallhubProxyVirtualLoginPath(pathname)) return true;
    if (isSteamStoreHost(host)) return isWallhubProxyVirtualStoreServicePath(pathname);
    if (isSteamCommunityHost(host)) return isWallhubProxyVirtualCommunityServicePath(pathname);
    if (host === 'steam-chat.com' || host.endsWith('.steam-chat.com')) return /^\/chat\/?$/i.test(pathname);
    return false;
  }

  function wallhubVirtualSteamProxyPath(target) {
    try {
      const url = target instanceof URL ? new URL(target.toString()) : new URL(String(target || ''));
      if (isSteamStoreHost(url.hostname) && /^\/stats\/?$/i.test(String(url.pathname || ''))) url.pathname = '/charts/';
      if (!canUseWallhubVirtualSteamProxyPath(url)) return '';
      const params = new URLSearchParams(url.search || '');
      params.set(virtualHostParam, url.hostname);
      const qs = params.toString();
      return `${url.pathname || '/'}${qs ? `?${qs}` : ''}`;
    } catch {
      return '';
    }
  }

  function parseWallhubVirtualSteamProxyTarget(req) {
    let current;
    try { current = new URL(req.url, 'http://x'); } catch { return null; }
    const explicitHost = String(current.searchParams.get(virtualHostParam) || '').trim().toLowerCase();
    if ((explicitHost && isSteamStoreHost(explicitHost)) && /^\/stats\/?$/i.test(current.pathname || '')) current.pathname = '/charts/';
    const hasKnownVirtualPath = isWallhubProxyVirtualSteamPath(current.pathname);
    if (!hasKnownVirtualPath && !(explicitHost && isSteamHost(explicitHost))) return null;
    const requestedHost = (explicitHost && isSteamHost(explicitHost)) ? explicitHost : '';
    const host = /^\/chat\/?$/i.test(current.pathname)
      ? (requestedHost || 'steamcommunity.com')
      : (requestedHost
        ? requestedHost
        : (isWallhubProxyVirtualLoginPath(current.pathname)
          ? 'login.steampowered.com'
          : (isWallhubProxyVirtualStoreServicePath(current.pathname)
            ? 'store.steampowered.com'
            : (isWallhubProxyVirtualCommunityServicePath(current.pathname) ? 'steamcommunity.com' : ''))));
    if (!host) return null;
    if (!hasKnownVirtualPath && !explicitHost && /^\/(?:url\/proxy|api|assets|favicon\.ico|health)(?:\/|$)/i.test(current.pathname || '')) return null;
    current.searchParams.delete(virtualHostParam);
    try {
      const target = new URL(`https://${host}${current.pathname}${current.search}${current.hash || ''}`);
      if (!/^https?:$/i.test(target.protocol) || !isSteamHost(target.hostname)) return null;
      return explicitHost ? target : (canUseWallhubVirtualSteamProxyPath(target) ? target : null);
    } catch {
      return null;
    }
  }

  function isSteamQrChallengeUrl(target) {
    const host = String(target && target.hostname || '').toLowerCase();
    return (host === 's.team' || host.endsWith('.s.team')) && /^\/q\//i.test(String(target && target.pathname || ''));
  }

  function encodeWallhubProxyTarget(target) {
    return encodeURIComponent(target.toString()).replace(/%257B(\d+)%257D/gi, '{$1}');
  }

  function wallhubUrlProxyPath(targetUrl, baseUrl) {
    let target;
    try {
      const raw = String(targetUrl || '').trim();
      if (!raw) return raw;
      if (/^https?:\/\/url\/(?:proxy)(?:\/|\?)/i.test(raw)) {
        try {
          const broken = new URL(raw);
          return `/${broken.hostname}${broken.pathname}${broken.search}${broken.hash || ''}`;
        } catch {}
      }
      if (/^https?:\/\/proxy(?:\/|\?)/i.test(raw)) {
        try {
          const broken = new URL(raw);
          return `/url/${broken.hostname}${broken.pathname}${broken.search}${broken.hash || ''}`;
        } catch {}
      }
      if (/^\/proxy(?:\/|\?)/i.test(raw)) return `/url${raw}`;
      if (/^\/url\/proxy(?:\/|\?)/i.test(raw)) return raw;
      const decoded = raw.replace(/&amp;/gi, '&').replace(/&#38;/g, '&').replace(/&quot;/gi, '"').replace(/&#39;/g, "'");
      target = new URL(decoded, baseUrl);
    } catch {
      return String(targetUrl || '');
    }
    if (!/^https?:$/i.test(target.protocol) || !isSteamHost(target.hostname)) return String(targetUrl || '');
    if (target.hostname.endsWith('.fastly.steamstatic.com')) {
      target.hostname = target.hostname.replace(/\.fastly\.steamstatic\.com$/i, '.akamai.steamstatic.com');
    }
    if (isSteamQrChallengeUrl(target)) return target.toString();
    const virtualPath = wallhubVirtualSteamProxyPath(target);
    if (virtualPath) return virtualPath;
    return `/url/proxy/?url=${encodeWallhubProxyTarget(target)}`;
  }

  function wallhubWorkshopTagBrowsePath(tagName, baseUrl) {
    const tag = String(tagName || '').replace(/\s*\(\s*[\d,]+\s*\)\s*$/, '').trim();
    if (!tag || !workshopCommunityTags.has(tag.toLowerCase())) return '';
    let pageTarget;
    try { pageTarget = new URL(String(baseUrl || '')); } catch { return ''; }
    const appid = String(pageTarget.searchParams.get('appid') || (pageTarget.pathname.match(/\/app\/(\d+)/i) || [])[1] || '').trim();
    if (!/^\d+$/.test(appid)) return '';
    const target = new URL('https://steamcommunity.com/workshop/browse/');
    target.searchParams.set('appid', appid);
    target.searchParams.append('requiredtags[]', tag);
    return wallhubUrlProxyPath(target.toString(), pageTarget.toString());
  }

  function wallhubWorkshopFilterBrowsePath(optionValue, baseUrl) {
    const tag = String(optionValue || '').replace(/\s*\(\s*[\d,]+\s*\)\s*$/, '').trim();
    let pageTarget;
    try { pageTarget = new URL(String(baseUrl || '')); } catch { return ''; }
    const appid = String(pageTarget.searchParams.get('appid') || (pageTarget.pathname.match(/\/app\/(\d+)/i) || [])[1] || '').trim();
    if (!/^\d+$/.test(appid)) return '';
    if (!tag || /^(?:<[^>]+>|none|not selected)$/i.test(tag)) {
      return wallhubUrlProxyPath(`https://steamcommunity.com/app/${appid}/workshop/`, pageTarget.toString());
    }
    const target = new URL('https://steamcommunity.com/workshop/browse/');
    target.searchParams.set('appid', appid);
    target.searchParams.append('requiredtags[]', tag);
    return wallhubUrlProxyPath(target.toString(), pageTarget.toString());
  }

  function steamProxyHostPattern() {
    return '(?:(?:[a-z0-9-]+\\.)*(?:steamcommunity\\.com|steampowered\\.com|steam-api\\.com|steamusercontent\\.com|steamcontent\\.com|steamstatic\\.com|s\\.team|steam-chat\\.com|steam\\.tv|steamgames\\.com|valvesoftware\\.com|steamstat\\.us|akamaihd\\.net|akamaized\\.net|eccdnx\\.com|queniujq\\.cn|steamserver\\.net)|steamstats\\.valve\\.org|steamstatic-a\\.akamaihd\\.net|steamvideo-a\\.akamaihd\\.net|steambroadcast\\.akamaized\\.net)';
  }

  function isWallhubSteamAuthApiTarget(target) {
    const host = String(target && target.hostname || '').toLowerCase();
    const pathname = String(target && target.pathname || '');
    if (host !== 'api.steampowered.com' && host !== 'community.steam-api.com') return false;
    return /\/IAuthenticationService\//i.test(pathname);
  }

  return {
    parseWallhubUrlProxyTarget,
    normalizeWallhubProxyTargetQuery,
    isWallhubProxyVirtualLoginPath,
    isWallhubProxyVirtualSteamPath,
    canUseWallhubVirtualSteamProxyPath,
    wallhubVirtualSteamProxyPath,
    parseWallhubVirtualSteamProxyTarget,
    wallhubUrlProxyPath,
    wallhubWorkshopTagBrowsePath,
    wallhubWorkshopFilterBrowsePath,
    steamProxyHostPattern,
    isWallhubSteamAuthApiTarget,
    isWallhubSteamWebApiServiceTarget,
    isSteamQrChallengeUrl,
    encodeWallhubProxyTarget,
  };
}

module.exports = { createRewriteUrlPolicy };
