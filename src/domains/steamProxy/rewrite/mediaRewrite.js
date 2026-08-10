'use strict';

function createMediaRewriteTools(options) {
  const { isSteamHost, encodeWallhubProxyTarget } = options;

  function wallhubUrlProxyPathForMediaManifestUrl(targetUrl, baseUrl, localOrigin = '') {
    let target;
    try { target = new URL(String(targetUrl || ''), baseUrl); } catch { return String(targetUrl || ''); }
    if (!/^https?:$/i.test(target.protocol) || !isSteamHost(target.hostname)) return String(targetUrl || '');
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
        .replace(/\b(initialization|media|sourceURL)=("([^"]*)"|'([^']*)')/gi, (match, attr, quoted, v1, v2) => {
          const value = v1 || v2 || '';
          if (!value || /^(?:data|blob|javascript|#)/i.test(value)) return match;
          const quote = quoted.startsWith("'") ? "'" : '"';
          return `${attr}=${quote}${wallhubUrlProxyPathForMediaManifestUrl(value, extBase, localOrigin).replace(new RegExp(quote, 'g'), quote === '"' ? '&quot;' : '&#39;')}${quote}`;
        })
        .replace(/<BaseURL>([\s\S]*?)<\/BaseURL>/gi, (match, value) => {
          const trimmed = String(value || '').trim();
          if (!trimmed || /^(?:data|blob|javascript|#)/i.test(trimmed)) return match;
          return `<BaseURL>${wallhubUrlProxyPathForMediaManifestUrl(trimmed, extBase, localOrigin)}</BaseURL>`;
        });
    }
    return raw.split(/\r?\n/).map((line) => {
      const trimmed = line.trim();
      if (!trimmed) return line;
      if (trimmed[0] !== '#') return line.replace(trimmed, wallhubUrlProxyPathForMediaManifestUrl(trimmed, extBase, localOrigin));
      return line.replace(/\bURI=("([^"]*)"|'([^']*)')/gi, (match, quoted, v1, v2) => {
        const value = v1 || v2 || '';
        if (!value || /^(?:data|blob|javascript|#)/i.test(value)) return match;
        const quote = quoted.startsWith("'") ? "'" : '"';
        return `URI=${quote}${wallhubUrlProxyPathForMediaManifestUrl(value, extBase, localOrigin).replace(new RegExp(quote, 'g'), quote === '"' ? '&quot;' : '&#39;')}${quote}`;
      });
    }).join('\n');
  }

  return { rewriteWallhubProxyMediaManifest };
}

module.exports = { createMediaRewriteTools };
