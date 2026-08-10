'use strict';

const path = require('node:path');

function createRewriteResponsePolicy(options) {
  const {
    isSteamHost,
    isSteamStaticCdnHost,
    steamResourceContentType,
    isWallhubSteamWebApiServiceTarget,
  } = options;

  function inferWallhubProxyContentType(target, acceptHeader, body) {
    const accept = String(acceptHeader || '');
    const text = Buffer.isBuffer(body) ? body.subarray(0, 256).toString('utf8') : '';
    if (/text\/html/i.test(accept) || /^\s*<!doctype html/i.test(text) || /^\s*<html[\s>]/i.test(text)) {
      return 'text/html; charset=utf-8';
    }
    return steamResourceContentType(target.toString());
  }

  function wallhubProxyPathExt(target) {
    try { return path.extname(new URL(target.toString()).pathname).toLowerCase(); } catch { return ''; }
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
    if (ext === '.m3u8' || ext === '.mpd' || /(?:mpegurl|dash\+xml)/i.test(String(contentType || ''))) return true;
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
      if (/srcset/i.test(match)) value.split(',').forEach((part) => add(part.trim().split(/\s+/)[0] || ''));
      else add(value);
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

  return {
    inferWallhubProxyContentType,
    wallhubProxyPathExt,
    isWallhubProxyTextType,
    isWallhubProxyHtmlType,
    isWallhubProxyStaticAsset,
    shouldRewriteWallhubProxyText,
    collectWallhubProxyPrefetchUrls,
  };
}

module.exports = { createRewriteResponsePolicy };
