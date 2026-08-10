'use strict';

function createHtmlRewriteTools(options) {
  const { wallhubUrlProxyPath, rewriteWallhubProxyEscapedUrls } = options;

  function decodeWallhubHtmlAttrValue(value) {
    return String(value || '')
      .replace(/&quot;|&#34;|&#x22;/gi, '"')
      .replace(/&#39;|&#x27;|&apos;/gi, "'")
      .replace(/&lt;|&#60;|&#x3c;/gi, '<')
      .replace(/&gt;|&#62;|&#x3e;/gi, '>')
      .replace(/&amp;|&#38;|&#x26;/gi, '&');
  }

  function encodeWallhubHtmlAttrValue(value, quote) {
    let out = String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    out = quote === "'" ? out.replace(/'/g, '&#39;') : out.replace(/"/g, '&quot;');
    return out;
  }

  function rewriteWallhubProxyDataProps(value, baseUrl) {
    const decoded = decodeWallhubHtmlAttrValue(value);
    if (!/https?:\\?\/\\?\//i.test(decoded)) return value;
    return encodeWallhubHtmlAttrValue(rewriteWallhubProxyEscapedUrls(decoded, baseUrl), '"');
  }

  function rewriteWallhubProxyHtmlTags(fragment, baseUrl) {
    let out = String(fragment || '');
    const urlAttrPattern = '(?:href|src|action|poster|data-[\\w:-]*(?:url|src|source|sources|image|images|background|href|movie|video|webm|mp4|screenshot|thumb|thumbnail|full|small|large|highlight))';
    out = out.replace(new RegExp(`\\b(${urlAttrPattern})=("(?:[^"]*)"|'(?:[^']*)')`, 'gi'), (match, attr, quoted) => {
      const v1 = quoted.startsWith('"') ? quoted.slice(1, -1) : undefined;
      const v2 = quoted.startsWith("'") ? quoted.slice(1, -1) : undefined;
      const value = v1 ?? v2 ?? '';
      if (!value || /^(data:|javascript:|mailto:|steam:|#)/i.test(value)) return match;
      const next = wallhubUrlProxyPath(value, baseUrl);
      const quote = quoted.startsWith("'") ? "'" : '"';
      return `${attr}=${quote}${next.replace(new RegExp(quote, 'g'), quote === '"' ? '&quot;' : '&#39;')}${quote}`;
    });
    const unquotedUrlAttrRe = new RegExp(`\\b(${urlAttrPattern})=([^\\s"'=<>\\x60]+)`, 'gi');
    out = out.replace(unquotedUrlAttrRe, (match, attr, value) => {
      if (!value || /^(data:|javascript:|mailto:|steam:|#)/i.test(value)) return match;
      return `${attr}="${wallhubUrlProxyPath(value, baseUrl).replace(/"/g, '&quot;')}"`;
    });
    out = out.replace(/\b(srcset)=("([^"]*)"|'([^']*)')/gi, (match, attr, quoted, v1, v2) => {
      const value = v1 ?? v2 ?? '';
      const next = value.split(',').map((part) => {
        const pieces = part.trim().split(/\s+/);
        if (!pieces[0]) return '';
        pieces[0] = wallhubUrlProxyPath(pieces[0], baseUrl);
        return pieces.join(' ');
      }).join(', ');
      const quote = quoted.startsWith("'") ? "'" : '"';
      return `${attr}=${quote}${next}${quote}`;
    });
    out = out.replace(/\b(data-props)="([^"]*)"/gi, (match, attr, value) => `${attr}="${rewriteWallhubProxyDataProps(value, baseUrl)}"`);
    out = out.replace(/\b(data-props)='([^']*)'/gi, (match, attr, value) => `${attr}='${rewriteWallhubProxyDataProps(value, baseUrl).replace(/'/g, '&#39;')}'`);
    return out;
  }

  function rewriteWallhubProxyApplicationConfig(html, baseUrl) {
    return String(html || '').replace(
      /(<div\b[^>]*\bid=(["'])application_config\2[^>]*\bdata-config=(["']))([\s\S]*?)(\3)/i,
      (match, prefix, idQuote, valueQuote, encoded, suffix) => {
        try {
          const data = JSON.parse(decodeWallhubHtmlAttrValue(encoded));
          for (const key of Object.keys(data)) {
            const value = data[key];
            if (typeof value !== 'string' || !/^https?:\/\//i.test(value)) continue;
            const next = wallhubUrlProxyPath(value, baseUrl);
            data[key] = next !== value ? next : value;
          }
          return `${prefix}${encodeWallhubHtmlAttrValue(JSON.stringify(data), valueQuote)}${suffix}`;
        } catch {
          return match;
        }
      }
    );
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

  function rewriteWallhubProxyHtml(html, baseUrl) {
    let out = String(html || '');
    out = out.replace(/<base\b[^>]*>/gi, '');
    out = out.replace(/<meta\b[^>]+http-equiv=(["'])?content-security-policy\1?[^>]*>/gi, '');
    out = out.replace(/\s+integrity=("([^"]*)"|'([^']*)'|[^\s>]+)/gi, '');
    out = out.split(/(<script\b[\s\S]*?<\/script>)/gi).map((part) => {
      if (!/^<script\b/i.test(part)) return rewriteWallhubProxyHtmlTags(part, baseUrl);
      return part.replace(/^<script\b[^>]*>/i, (tag) => rewriteWallhubProxyHtmlTags(tag, baseUrl));
    }).join('');
    out = rewriteWallhubProxyApplicationConfig(out, baseUrl);
    return rewriteWallhubProxyStoreBootstrapUrls(out, baseUrl);
  }

  return {
    decodeWallhubHtmlAttrValue,
    encodeWallhubHtmlAttrValue,
    rewriteWallhubProxyHtmlTags,
    rewriteWallhubProxyApplicationConfig,
    rewriteWallhubProxyHtml,
  };
}

module.exports = { createHtmlRewriteTools };
