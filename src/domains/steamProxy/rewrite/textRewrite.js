'use strict';

function createTextRewriteTools(options) {
  const { wallhubUrlProxyPath, steamProxyHostPattern } = options;

  function rewriteWallhubProxyEscapedUrls(text, baseUrl) {
    const hostPattern = steamProxyHostPattern();
    const normalRe = new RegExp(`https?://(?:[^"' <>()\\\\]+\\.)?${hostPattern}[^"' <>()\\\\]*`, 'gi');
    let out = String(text || '').replace(normalRe, (value) => wallhubUrlProxyPath(value, baseUrl));
    const protocolRelativeRe = new RegExp(`(?<!:)//(?:[^"' <>()\\\\]+\\.)?${hostPattern}[^"' <>()\\\\]*`, 'gi');
    out = out.replace(protocolRelativeRe, (value) => wallhubUrlProxyPath(value, baseUrl));
    const escapedRe = new RegExp(`https?:\\\\/\\\\/(?:[^"' <>()\\\\]+\\.)?${hostPattern}(?:\\\\/|[^"' <>()\\\\])*`, 'gi');
    out = out.replace(escapedRe, (value) => wallhubUrlProxyPath(value.replace(/\\\//g, '/'), baseUrl));
    const escapedProtocolRelativeRe = new RegExp(`(?<!:)\\\\/\\\\/(?:[^"' <>()\\\\]+\\.)?${hostPattern}(?:\\\\/|[^"' <>()\\\\])*`, 'gi');
    out = out.replace(escapedProtocolRelativeRe, (value) => wallhubUrlProxyPath(value.replace(/\\\//g, '/'), baseUrl));
    const htmlEscapedRe = new RegExp(`https?:\\\\\\\\/\\\\\\\\/(?:[^"' <>()\\\\]+\\\\\\\\.)?${hostPattern.replace(/\\\\\\\./g, '\\\\\\\\\\\\\\\\.')}[^"' <>()]*`, 'gi');
    out = out.replace(htmlEscapedRe, (value) => {
      const raw = value.replace(/\\\\\//g, '/').replace(/\\\\\./g, '.');
      return wallhubUrlProxyPath(raw, baseUrl).replace(/\//g, '\\/');
    });
    return out;
  }

  function rewriteWallhubProxyJsonText(text, baseUrl) {
    const raw = String(text || '');
    if (!/steamcommunity\.com|steampowered\.com|steam-api\.com|steamstatic\.com|steamusercontent\.com|steamcontent\.com|steam\.tv|akamaihd\.net|akamaized\.net|eccdnx\.com|queniujq\.cn/i.test(raw)) return raw;
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
    out = out.replace(/\b(import(?:[^'"()]*?\bfrom\s*)?)(["'])([^"']+)(\2)/g, (match, prefix, quote, specifier) => {
      return `${prefix}${rewriteQuoted(quote, specifier)}`;
    });
    out = out.replace(/\b(export[^'"()]*?\bfrom\s*)(["'])([^"']+)(\2)/g, (match, prefix, quote, specifier) => {
      return `${prefix}${rewriteQuoted(quote, specifier)}`;
    });
    out = out.replace(/\bimport\s*\(\s*(["'])([^"']+)(\1)\s*\)/g, (match, quote, specifier) => {
      return `import(${rewriteQuoted(quote, specifier)})`;
    });
    return out;
  }

  function rewriteWallhubProxyJsText(text, baseUrl) {
    return rewriteWallhubProxyEscapedUrls(rewriteWallhubProxyJsModuleSpecifiers(text, baseUrl), baseUrl);
  }

  function rewriteWallhubProxyCss(css, baseUrl) {
    let out = String(css || '');
    out = out.replace(/url\((["']?)([^"')]+)\1\)/gi, (match, quote, value) => {
      const raw = String(value || '').trim();
      if (!raw || /^(data:|#|about:)/i.test(raw)) return match;
      return `url(${quote || ''}${wallhubUrlProxyPath(raw, baseUrl)}${quote || ''})`;
    });
    out = out.replace(/@import\s+(?:url\()?("([^"]*)"|'([^']*)'|([^\s;)]+))\)?/gi, (match, quoted, v1, v2, v3) => {
      const raw = v1 || v2 || v3 || '';
      if (!raw || /^(data:|#|about:)/i.test(raw)) return match;
      return `@import url("${wallhubUrlProxyPath(raw, baseUrl).replace(/"/g, '\\"')}")`;
    });
    return rewriteWallhubProxyEscapedUrls(out, baseUrl);
  }

  return {
    rewriteWallhubProxyEscapedUrls,
    rewriteWallhubProxyJsonText,
    rewriteWallhubProxyJsText,
    rewriteWallhubProxyCss,
  };
}

module.exports = { createTextRewriteTools };
