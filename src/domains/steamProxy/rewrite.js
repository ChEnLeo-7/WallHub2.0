'use strict';

const { WORKSHOP_COMMUNITY_TAGS } = require('./rewrite/workshopTags');

function createSteamProxyRewriteTools(options = {}) {
  const virtualHostParam = options.virtualHostParam || '__whp_host';
  const isSteamHost = typeof options.isSteamHost === 'function' ? options.isSteamHost : () => false;
  const isSteamStaticCdnHost = typeof options.isSteamStaticCdnHost === 'function' ? options.isSteamStaticCdnHost : () => false;
  const isSteamCommunityHost = typeof options.isSteamCommunityHost === 'function' ? options.isSteamCommunityHost : () => false;
  const steamResourceContentType = typeof options.steamResourceContentType === 'function'
    ? options.steamResourceContentType
    : () => 'application/octet-stream';
  const workshopCommunityTags = new Set(WORKSHOP_COMMUNITY_TAGS.map(tag => tag.toLowerCase()));

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
      if (target && /login\.steampowered\.com$/i.test(String(target.hostname || ''))) {
        return 'https://store.steampowered.com';
      }
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

  function parseWallhubUrlProxyRelativeTarget(current, req) {
    try {
      const pathname = String(current && current.pathname || '');
      const match = pathname.match(/^\/url\/proxy\/(.+)$/i);
      if (!match || !match[1]) return null;
      if (current.searchParams.has('url') || current.searchParams.has(virtualHostParam)) return null;
      const base = wallhubUrlProxyRefererTarget(req);
      if (!base) return null;
      const rel = match[1].replace(/^\/+/, '');
      const target = new URL(rel + (current.search || '') + (current.hash || ''), base);
      if (!/^https?:$/i.test(target.protocol) || !isSteamHost(target.hostname)) return null;
      return normalizeWallhubSteamCommunityAssetTarget(target);
    } catch {
      return null;
    }
  }

  function normalizeWallhubSteamCommunityAssetTarget(target) {
    const host = String(target && target.hostname || '').toLowerCase();
    const pathname = String(target && target.pathname || '');
    if (!isSteamCommunityHost(host)) return target;
    if (!/^\/images\/webui\//i.test(pathname)) return target;
    const next = new URL(`https://community.fastly.steamstatic.com/public${pathname}`);
    next.search = target.search;
    next.hash = target.hash;
    return next;
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
    if (!/^https?:$/i.test(target.protocol)) return null;
    if (!isSteamHost(target.hostname)) return null;
    return normalizeWallhubSteamCommunityAssetTarget(target);
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

  function isSteamChatHost(hostname) {
    const host = String(hostname || '').toLowerCase();
    return host === 'steam-chat.com' || host.endsWith('.steam-chat.com');
  }

  function canUseWallhubVirtualSteamProxyPath(target) {
    const host = String(target && target.hostname || '').toLowerCase();
    const pathname = String(target && target.pathname || '');
    if (!host || !isSteamHost(host)) return false;
    if (isWallhubProxyVirtualLoginPath(pathname)) return true;
    if (isSteamStoreHost(host)) return isWallhubProxyVirtualStoreServicePath(pathname);
    if (isSteamCommunityHost(host)) return isWallhubProxyVirtualCommunityServicePath(pathname);
    if (isSteamChatHost(host)) return /^\/chat\/?$/i.test(pathname);
    return false;
  }

  function wallhubVirtualSteamProxyPath(target) {
    try {
      const url = target instanceof URL ? new URL(target.toString()) : new URL(String(target || ''));
      const pathname = String(url.pathname || '');
      if (isSteamStoreHost(url.hostname) && /^\/stats\/?$/i.test(pathname)) {
        url.pathname = '/charts/';
      }
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
    if ((explicitHost && isSteamStoreHost(explicitHost)) && /^\/stats\/?$/i.test(current.pathname || '')) {
      current.pathname = '/charts/';
    }
    const hasKnownVirtualPath = isWallhubProxyVirtualSteamPath(current.pathname);
    if (!hasKnownVirtualPath && !(explicitHost && isSteamHost(explicitHost))) return null;
    // Steam's login JS navigates to the finalizelogin `redir` (e.g. /login/home/)
    // as a bare relative path with no __whp_host. Store/community SPAs also issue
    // many same-origin relative requests; when the virtual host is explicit, keep
    // routing those arbitrary upstream paths through the proxy.
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
    const pathname = String(target && target.pathname || '');
    return (host === 's.team' || host.endsWith('.s.team')) && /^\/q\//i.test(pathname);
  }

  function encodeWallhubProxyTarget(target) {
    return encodeURIComponent(target.toString())
      // Steam chat URLs contain {0} as a client-side cursor template. It must
      // remain literal until broadcast_chat.js substitutes the next timestamp.
      .replace(/%257B(\d+)%257D/gi, '{$1}');
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
      const decoded = raw
        .replace(/&amp;/gi, '&')
        .replace(/&#38;/g, '&')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/g, "'");
      target = new URL(decoded, baseUrl);
    } catch {
      return String(targetUrl || '');
    }
    if (!/^https?:$/i.test(target.protocol) || !isSteamHost(target.hostname)) {
      return String(targetUrl || '');
    }
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

  function rewriteWallhubProxyEscapedUrls(text, baseUrl) {
    const hostPattern = steamProxyHostPattern();
    const normalRe = new RegExp(`https?://(?:[^"' <>()\\\\]+\\.)?${hostPattern}[^"' <>()\\\\]*`, 'gi');
    let out = String(text || '').replace(normalRe, (value) => wallhubUrlProxyPath(value, baseUrl));
    const protocolRelativeRe = new RegExp(`(?<!:)//(?:[^"' <>()\\\\]+\\.)?${hostPattern}[^"' <>()\\\\]*`, 'gi');
    out = out.replace(protocolRelativeRe, (value) => wallhubUrlProxyPath(value, baseUrl));
    const escapedRe = new RegExp(`https?:\\\\/\\\\/(?:[^"' <>()\\\\]+\\.)?${hostPattern}(?:\\\\/|[^"' <>()\\\\])*`, 'gi');
    out = out.replace(escapedRe, (value) => {
      const raw = value.replace(/\\\//g, '/');
      return wallhubUrlProxyPath(raw, baseUrl);
    });
    const escapedProtocolRelativeRe = new RegExp(`(?<!:)\\\\/\\\\/(?:[^"' <>()\\\\]+\\.)?${hostPattern}(?:\\\\/|[^"' <>()\\\\])*`, 'gi');
    out = out.replace(escapedProtocolRelativeRe, (value) => {
      const raw = value.replace(/\\\//g, '/');
      return wallhubUrlProxyPath(raw, baseUrl);
    });
    const htmlEscapedRe = new RegExp(`https?:\\\\\\\\/\\\\\\\\/(?:[^"' <>()\\\\]+\\\\\\\\.)?${hostPattern.replace(/\\\\\\./g, '\\\\\\\\\\\\\\\\.')}[^"' <>()]*`, 'gi');
    out = out.replace(htmlEscapedRe, (value) => {
      const raw = value.replace(/\\\\\//g, '/').replace(/\\\\\./g, '.');
      return wallhubUrlProxyPath(raw, baseUrl).replace(/\//g, '\\/');
    });
    return out;
  }

  function rewriteWallhubProxyJsonText(text, baseUrl) {
    const raw = String(text || '');
    if (!/steamcommunity\.com|steampowered\.com|steam-api\.com|steamstatic\.com|steamusercontent\.com|steamcontent\.com|steam\.tv|akamaihd\.net|akamaized\.net|eccdnx\.com|queniujq\.cn/i.test(raw)) {
      return raw;
    }
    return rewriteWallhubProxyEscapedUrls(raw, baseUrl);
  }

  function rewriteWallhubProxyJsModuleSpecifiers(text, baseUrl) {
    const rewriteSpecifier = (specifier) => {
      const raw = String(specifier || '');
      if (!raw || /^(?:data|blob|javascript|mailto|steam|about):|^#/i.test(raw)) return raw;
      if (!/^(?:\.{0,2}\/|https?:\/\/)/i.test(raw)) return raw;
      const next = wallhubUrlProxyPath(raw, baseUrl);
      return next === raw ? raw : next;
    };
    const rewriteQuoted = (quote, specifier) => {
      const next = rewriteSpecifier(specifier);
      return `${quote}${next.replace(new RegExp(quote, 'g'), `\\${quote}`)}${quote}`;
    };
    let out = String(text || '');
    out = out.replace(/\b(import(?:[^'"()]*?\bfrom\s*)?)(["'])([^"']+)(\2)/g, (m, prefix, quote, specifier) => {
      return `${prefix}${rewriteQuoted(quote, specifier)}`;
    });
    out = out.replace(/\b(export[^'"()]*?\bfrom\s*)(["'])([^"']+)(\2)/g, (m, prefix, quote, specifier) => {
      return `${prefix}${rewriteQuoted(quote, specifier)}`;
    });
    out = out.replace(/\bimport\s*\(\s*(["'])([^"']+)(\1)\s*\)/g, (m, quote, specifier) => {
      return `import(${rewriteQuoted(quote, specifier)})`;
    });
    return out;
  }

  function rewriteWallhubProxyJsText(text, baseUrl) {
    return rewriteWallhubProxyEscapedUrls(rewriteWallhubProxyJsModuleSpecifiers(text, baseUrl), baseUrl);
  }

  function decodeWallhubHtmlAttrValue(value) {
    return String(value || '')
      .replace(/&quot;|&#34;|&#x22;/gi, '"')
      .replace(/&#39;|&#x27;|&apos;/gi, "'")
      .replace(/&lt;|&#60;|&#x3c;/gi, '<')
      .replace(/&gt;|&#62;|&#x3e;/gi, '>')
      .replace(/&amp;|&#38;|&#x26;/gi, '&');
  }

  function encodeWallhubHtmlAttrValue(value, quote) {
    let out = String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    out = quote === "'"
      ? out.replace(/'/g, '&#39;')
      : out.replace(/"/g, '&quot;');
    return out;
  }

  function rewriteWallhubProxyDataProps(value, baseUrl) {
    const decoded = decodeWallhubHtmlAttrValue(value);
    if (!/https?:\\?\/\\?\//i.test(decoded)) return value;
    const rewritten = rewriteWallhubProxyEscapedUrls(decoded, baseUrl);
    return encodeWallhubHtmlAttrValue(rewritten, '"');
  }

  function rewriteWallhubProxyHtmlTags(fragment, baseUrl) {
    let out = String(fragment || '');
    const urlAttrPattern = '(?:href|src|action|poster|data-[\\w:-]*(?:url|src|source|sources|image|images|background|href|movie|video|webm|mp4|screenshot|thumb|thumbnail|full|small|large|highlight))';
    out = out.replace(new RegExp(`\\b(${urlAttrPattern})=("(?:[^"]*)"|'(?:[^']*)')`, 'gi'), (m, attr, quoted) => {
      const v1 = quoted.startsWith('"') ? quoted.slice(1, -1) : undefined;
      const v2 = quoted.startsWith("'") ? quoted.slice(1, -1) : undefined;
      const value = v1 ?? v2 ?? '';
      if (!value || /^(data:|javascript:|mailto:|steam:|#)/i.test(value)) return m;
      const next = wallhubUrlProxyPath(value, baseUrl);
      const quote = quoted.startsWith("'") ? "'" : '"';
      return `${attr}=${quote}${next.replace(new RegExp(quote, 'g'), quote === '"' ? '&quot;' : '&#39;')}${quote}`;
    });
    const unquotedUrlAttrRe = new RegExp(`\\b(${urlAttrPattern})=([^\\s"'=<>\\x60]+)`, 'gi');
    out = out.replace(unquotedUrlAttrRe, (m, attr, value) => {
      if (!value || /^(data:|javascript:|mailto:|steam:|#)/i.test(value)) return m;
      return `${attr}="${wallhubUrlProxyPath(value, baseUrl).replace(/"/g, '&quot;')}"`;
    });
    out = out.replace(/\b(srcset)=("([^"]*)"|'([^']*)')/gi, (m, attr, quoted, v1, v2) => {
      const value = v1 ?? v2 ?? '';
      const next = value.split(',').map(part => {
        const seg = part.trim();
        if (!seg) return seg;
        const pieces = seg.split(/\s+/);
        pieces[0] = wallhubUrlProxyPath(pieces[0], baseUrl);
        return pieces.join(' ');
      }).join(', ');
      const quote = quoted.startsWith("'") ? "'" : '"';
      return `${attr}=${quote}${next}${quote}`;
    });
    out = out.replace(/\b(data-props)="([^"]*)"/gi, (m, attr, value) => {
      return `${attr}="${rewriteWallhubProxyDataProps(value, baseUrl)}"`;
    });
    out = out.replace(/\b(data-props)='([^']*)'/gi, (m, attr, value) => {
      const rewritten = rewriteWallhubProxyDataProps(value, baseUrl).replace(/'/g, '&#39;');
      return `${attr}='${rewritten}'`;
    });
    return out;
  }

  function rewriteWallhubProxyApplicationConfig(html, baseUrl) {
    return String(html || '').replace(
      /(<div\b[^>]*\bid=(["'])application_config\2[^>]*\bdata-config=(["']))([\s\S]*?)(\3)/i,
      (m, prefix, idQuote, valueQuote, encoded, suffix) => {
        try {
          const decoded = decodeWallhubHtmlAttrValue(encoded);
          const data = JSON.parse(decoded);
          // Rewrite any string value that points at a Steam host. This covers
          // WEBAPI_BASE_URL / TOKEN_URL / *_BASE_URL as well as CDN keys like
          // COMMUNITY_CDN_URL, STORE_CDN_URL, PUBLIC_SHARED_URL, MEDIA_CDN_URL
          // that rankings / news / points-shop pages rely on, without needing
          // an exhaustive allow-list that drifts as Steam adds keys.
          const rewriteValue = (v) => {
            if (typeof v !== 'string') return v;
            if (!/^https?:\/\//i.test(v)) return v;
            const next = wallhubUrlProxyPath(v, baseUrl);
            return next !== v ? next : v;
          };
          for (const key of Object.keys(data)) {
            data[key] = rewriteValue(data[key]);
          }
          return `${prefix}${encodeWallhubHtmlAttrValue(JSON.stringify(data), valueQuote)}${suffix}`;
        } catch {
          return m;
        }
      }
    );
  }

  function rewriteWallhubProxyHtml(html, baseUrl) {
    let out = String(html || '');
    out = out.replace(/<base\b[^>]*>/gi, '');
    out = out.replace(/<meta\b[^>]+http-equiv=(["'])?content-security-policy\1?[^>]*>/gi, '');
    out = out.replace(/\s+integrity=("([^"]*)"|'([^']*)'|[^\s>]+)/gi, '');
    out = out
      .split(/(<script\b[\s\S]*?<\/script>)/gi)
      .map(part => {
        if (!/^<script\b/i.test(part)) return rewriteWallhubProxyHtmlTags(part, baseUrl);
        return part.replace(/^<script\b[^>]*>/i, (tag) => rewriteWallhubProxyHtmlTags(tag, baseUrl));
      })
      .join('');
    out = rewriteWallhubProxyApplicationConfig(out, baseUrl);
    return rewriteWallhubProxyStoreBootstrapUrls(out, baseUrl);
  }

  function rewriteWallhubProxyStoreBootstrapUrls(html, baseUrl) {
    const raw = String(html || '');
    if (!/store\.steampowered\.com|application_config|__remixContext|SSR_DATA|data-props/i.test(raw)) return raw;
    return raw.replace(/(?<![A-Za-z0-9+.-])\/(?!\/|url\/proxy(?:\/|\?)|api(?:\/|$)|assets(?:\/|$)|favicon\.ico(?:$|[?#])|health(?:$|[?#]))(?:app\/\d+|appreviews|appreviewhistogram|ajax[A-Za-z0-9_]*|points|charts|search|news|category|categories|genre|tag|tags|sale|sales|curator|developer|publisher|franchise|recommended|explore|wishlist|cart|account|join|steamaccount|agecheck|bundle|sub|dlc|labs|hardware|about|stats|remoteplay|deck|steamdeck|events|yearinreview|replay)(?:[^"'<>\\\s)]*)?/gi, (value, offset, input) => {
      const lastTagOpen = input.lastIndexOf('<', offset);
      const lastTagClose = input.lastIndexOf('>', offset);
      if (lastTagOpen > lastTagClose) return value;
      const prefix = input.slice(Math.max(0, offset - 32), offset);
      const suffix = input.slice(offset + value.length, offset + value.length + 32);
      if (/\\$/.test(prefix)) return value;
      const quote = (prefix.match(/(?:href|src|action|poster|data-[\w:-]*(?:url|src|source|sources|image|images|background|href|movie|video|webm|mp4|screenshot|thumb|thumbnail|full|small|large|highlight))=(\\?["'])[^"']*$/i) || [])[1] || '';
      if (quote && /^(?:\\?")?\s*\]/.test(suffix)) return value;
      return wallhubUrlProxyPath(value, baseUrl);
    });
  }

  function rewriteWallhubProxyCss(css, baseUrl) {
    let out = String(css || '');
    out = out.replace(/url\((["']?)([^"')]+)\1\)/gi, (m, quote, value) => {
      const raw = String(value || '').trim();
      if (!raw || /^(data:|#|about:)/i.test(raw)) return m;
      return `url(${quote || ''}${wallhubUrlProxyPath(raw, baseUrl)}${quote || ''})`;
    });
    out = out.replace(/@import\s+(?:url\()?("([^"]*)"|'([^']*)'|([^\s;)]+))\)?/gi, (m, quoted, v1, v2, v3) => {
      const raw = v1 || v2 || v3 || '';
      if (!raw || /^(data:|#|about:)/i.test(raw)) return m;
      return `@import url("${wallhubUrlProxyPath(raw, baseUrl).replace(/"/g, '\\"')}")`;
    });
    return rewriteWallhubProxyEscapedUrls(out, baseUrl);
  }

  function wallhubUrlProxyPathForMediaManifestUrl(targetUrl, baseUrl, localOrigin = '') {
    let target;
    try {
      target = new URL(String(targetUrl || ''), baseUrl);
    } catch {
      return String(targetUrl || '');
    }
    if (!/^https?:$/i.test(target.protocol) || !isSteamHost(target.hostname)) {
      return String(targetUrl || '');
    }
    let encoded = encodeWallhubProxyTarget(target);
    encoded = encoded.replace(/%(?:25)*24([A-Za-z]+)(?:%(?:25)*25([0-9]+d))?%(?:25)*24/g, (match, name, width) => {
      return `$${name}${width ? `%${width}` : ''}$`;
    });
    const path = `/url/proxy/?url=${encoded}`;
    if (localOrigin) {
      try { return new URL(path, localOrigin).toString(); } catch {}
    }
    return path;
  }

  function rewriteWallhubProxyMediaManifest(text, baseUrl, localOrigin = '') {
    const raw = String(text || '');
    const extBase = (() => {
      try { return new URL('./', baseUrl).toString(); } catch { return baseUrl; }
    })();
    if (/^\s*<\?xml|<MPD\b/i.test(raw)) {
      return raw
        .replace(/\b(initialization|media|sourceURL)=("([^"]*)"|'([^']*)')/gi, (m, attr, quoted, v1, v2) => {
          const value = v1 || v2 || '';
          if (!value || /^(?:data|blob|javascript|#)/i.test(value)) return m;
          const quote = quoted.startsWith("'") ? "'" : '"';
          return `${attr}=${quote}${wallhubUrlProxyPathForMediaManifestUrl(value, extBase, localOrigin).replace(new RegExp(quote, 'g'), quote === '"' ? '&quot;' : '&#39;')}${quote}`;
        })
        .replace(/<BaseURL>([\s\S]*?)<\/BaseURL>/gi, (m, value) => {
          const trimmed = String(value || '').trim();
          if (!trimmed || /^(?:data|blob|javascript|#)/i.test(trimmed)) return m;
          return `<BaseURL>${wallhubUrlProxyPathForMediaManifestUrl(trimmed, extBase, localOrigin)}</BaseURL>`;
        });
    }
    return raw.split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed[0] !== '#') return line.replace(trimmed, wallhubUrlProxyPathForMediaManifestUrl(trimmed, extBase, localOrigin));
      return line.replace(/\bURI=("([^"]*)"|'([^']*)')/gi, (m, quoted, v1, v2) => {
        const value = v1 || v2 || '';
        if (!value || /^(?:data|blob|javascript|#)/i.test(value)) return m;
        const quote = quoted.startsWith("'") ? "'" : '"';
        return `URI=${quote}${wallhubUrlProxyPathForMediaManifestUrl(value, extBase, localOrigin).replace(new RegExp(quote, 'g'), quote === '"' ? '&quot;' : '&#39;')}${quote}`;
      });
    }).join('\n');
  }

  const wallhubProxyClientScript = (baseUrl = '') => require('./rewrite/clientScript').wallhubProxyClientScript({ virtualHostParam, workshopCommunityTags }, baseUrl);

  function injectWallhubProxyClientScript(html, baseUrl) {
    const text = String(html || '');
    if (/data-wallhub-url-proxy=/i.test(text)) return text;
    const script = wallhubProxyClientScript(baseUrl);
    if (/<head\b[^>]*>/i.test(text)) return text.replace(/<head\b[^>]*>/i, (m) => `${m}${script}`);
    if (/<\/head>/i.test(text)) return text.replace(/<\/head>/i, `${script}</head>`);
    if (/<\/body>/i.test(text)) return text.replace(/<\/body>/i, `${script}</body>`);
    return script + text;
  }

  function inferWallhubProxyContentType(target, acceptHeader, body) {
    const accept = String(acceptHeader || '');
    const text = Buffer.isBuffer(body) ? body.subarray(0, 256).toString('utf8') : '';
    if (/text\/html/i.test(accept) || /^\s*<!doctype html/i.test(text) || /^\s*<html[\s>]/i.test(text)) {
      return 'text/html; charset=utf-8';
    }
    return steamResourceContentType(target.toString());
  }

  function wallhubProxyPathExt(target) {
    try {
      return require('path').extname(new URL(target.toString()).pathname).toLowerCase();
    } catch {
      return '';
    }
  }

  function isWallhubProxyTextType(contentType, target) {
    const ct = String(contentType || '').toLowerCase();
    const ext = wallhubProxyPathExt(target);
    return /^text\//i.test(ct) ||
      /(?:javascript|ecmascript|json|xml|xhtml|mpegurl|dash\+xml)/i.test(ct) ||
      ['.css', '.js', '.mjs', '.json', '.xml', '.svg', '.html', '.htm', '.m3u8', '.mpd', '.vtt'].includes(ext);
  }

  function isWallhubProxyHtmlType(contentType, target) {
    return /^text\/html/i.test(String(contentType || '')) || ['.html', '.htm'].includes(wallhubProxyPathExt(target));
  }

  function isWallhubProxyStaticAsset(target, contentType = '') {
    const ext = wallhubProxyPathExt(target);
    if (['.css', '.js', '.mjs', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.avif', '.svg', '.ico', '.woff', '.woff2', '.ttf', '.otf', '.eot', '.map', '.mp4', '.webm', '.m4v', '.mov', '.m3u8', '.mpd', '.m4s', '.ts', '.vtt'].includes(ext)) return true;
    const ct = String(contentType || '').toLowerCase();
    if (/^(image|font|video|audio)\//.test(ct)) return true;
    if (/(?:text\/css|javascript|ecmascript|mpegurl|dash\+xml)/.test(ct)) return true;
    return isSteamStaticCdnHost(target.hostname) && !isWallhubProxyHtmlType(contentType, target);
  }

  function shouldRewriteWallhubProxyText(text, contentType, target) {
    if (isWallhubSteamWebApiServiceTarget(target)) return false;
    if (isWallhubProxyHtmlType(contentType, target)) return true;
    const ext = wallhubProxyPathExt(target);
    const raw = String(text || '');
    const extensionlessBroadcastMpd = isSteamHost(target && target.hostname) &&
      /\/broadcast\//i.test(String(target && target.pathname || '')) &&
      /^\s*(?:<\?xml[^>]*>\s*)?<MPD\b/i.test(raw);
    if (extensionlessBroadcastMpd) return true;
    if (ext === '.css' || /^text\/css/i.test(String(contentType || ''))) {
      return /(?:url\(|@import|steamcommunity\.com|steampowered\.com|steamstatic\.com|fastly\.steamstatic\.com|cloudflare\.steamstatic\.com|steamusercontent\.com|akamaihd\.net)/i.test(raw);
    }
    if (ext === '.m3u8' || ext === '.mpd' || /(?:mpegurl|dash\+xml)/i.test(String(contentType || ''))) {
      return true;
    }
    if (ext === '.json' || /(?:^|[/+])json(?:;|$)/i.test(String(contentType || ''))) {
      return /(?:steamcommunity\.com|steampowered\.com|steam-api\.com|steamstatic\.com|steamusercontent\.com|steamcontent\.com|akamaihd\.net|akamaized\.net|eccdnx\.com|queniujq\.cn)/i.test(raw);
    }
    if (/(?:javascript|ecmascript)/i.test(String(contentType || '')) || /\.(?:js|mjs)(?:$|\?)/i.test(target.pathname)) {
      if (/\/javascript\/applications\//i.test(String(target && target.pathname || ''))) return false;
      return /(?:steamcommunity\.com|steampowered\.com|steamstatic\.com|fastly\.steamstatic\.com|cloudflare\.steamstatic\.com|steamusercontent\.com|akamaihd\.net|https?:\\?\/\\?\/|\b(?:import|export)\b[^;]*?(?:from\s*)?["']\.{0,2}\/|\bimport\s*\(\s*["']\.{0,2}\/)/i.test(raw);
    }
    return false;
  }

  function collectWallhubProxyPrefetchUrls(html, baseUrl) {
    const out = [];
    const seen = new Set();
    const add = (value) => {
      if (!value || /^(data:|javascript:|mailto:|steam:|#)/i.test(value)) return;
      try {
        const target = new URL(String(value).replace(/&amp;/gi, '&'), baseUrl);
        if (!/^https?:$/i.test(target.protocol) || !isSteamHost(target.hostname)) return;
        if (!isWallhubProxyStaticAsset(target, steamResourceContentType(target.toString()))) return;
        const key = target.toString();
        if (seen.has(key)) return;
        seen.add(key);
        out.push(target);
      } catch {}
    };
    const text = String(html || '');
    text.replace(/<(?:link|script|img|source|video|div|span|a)\b[^>]*(?:href|src|poster|srcset|data-[\w:-]*(?:url|src|source|sources|image|images|background|href|movie|video|webm|mp4|screenshot|thumb|thumbnail|full|small|large|highlight))=("([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi, (match, quoted, v1, v2, v3) => {
      const value = v1 || v2 || v3 || '';
      if (/srcset/i.test(match)) {
        value.split(',').forEach(part => add(part.trim().split(/\s+/)[0] || ''));
        return match;
      }
      add(value);
      return match;
    });
    text.replace(/(?:href|src|poster|data-[\w:-]*(?:url|src|source|sources|image|images|background|href|movie|video|webm|mp4|screenshot|thumb|thumbnail|full|small|large|highlight))=(&quot;([^&]*)&quot;|&#39;([^&]*)&#39;)/gi, (match, quoted, v1, v2) => {
      add(v1 || v2 || '');
      return match;
    });
    text.replace(/url\((["']?)([^"')]+)\1\)/gi, (match, quote, value) => {
      add(value);
      return match;
    });
    return out.slice(0, 24);
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
    rewriteWallhubProxyEscapedUrls,
    rewriteWallhubProxyJsonText,
    rewriteWallhubProxyJsText,
    decodeWallhubHtmlAttrValue,
    encodeWallhubHtmlAttrValue,
    rewriteWallhubProxyHtmlTags,
    rewriteWallhubProxyApplicationConfig,
    rewriteWallhubProxyHtml,
    rewriteWallhubProxyCss,
    rewriteWallhubProxyMediaManifest,
    wallhubProxyClientScript,
    injectWallhubProxyClientScript,
    inferWallhubProxyContentType,
    wallhubProxyPathExt,
    isWallhubProxyTextType,
    isWallhubProxyHtmlType,
    isWallhubProxyStaticAsset,
    shouldRewriteWallhubProxyText,
    collectWallhubProxyPrefetchUrls,
    isWallhubSteamAuthApiTarget,
    isWallhubSteamWebApiServiceTarget,
    isSteamQrChallengeUrl,
    isSteamCommunityHost,
  };
}

module.exports = {
  createSteamProxyRewriteTools,
};
