'use strict';

module.exports = `  const nativeFetch = window.fetch;
  if (nativeFetch) {
    window.fetch = function(input, init) {
      try {
        if (input instanceof Request) {
          return nativeFetch.call(this, proxied(input), init || undefined);
        }
      } catch {}
      return nativeFetch.call(this, proxied(input), init);
    };
  }
  const xhrOpen = typeof XMLHttpRequest !== 'undefined' && XMLHttpRequest.prototype && XMLHttpRequest.prototype.open;
  if (xhrOpen) {
    XMLHttpRequest.prototype.open = function(method, url, ...rest) {
      return xhrOpen.call(this, method, proxied(url), ...rest);
    };
  }
  const attrSet = typeof Element !== 'undefined' && Element.prototype && Element.prototype.setAttribute;
  if (attrSet) {
    Element.prototype.setAttribute = function(name, value) {
      const attr = String(name || '').toLowerCase();
      if (attr === 'integrity') return;
      if (attr === 'srcset') {
        const result = attrSet.call(this, name, rewriteSrcset(value));
        scheduleVideoReload(this);
        return result;
      }
      if (attr === 'src' || attr === 'href' || attr === 'action' || attr === 'poster' || isUrlDataAttr(attr)) {
        const result = attrSet.call(this, name, proxied(value));
        if (attr === 'src' || attr === 'poster') scheduleVideoReload(this);
        return result;
      }
      return attrSet.call(this, name, value);
    };
  }
  const patchElementUrlProperty = (proto, prop, mapValue, afterSet) => {
    try {
      if (!proto) return;
      const desc = Object.getOwnPropertyDescriptor(proto, prop);
      if (!desc || !desc.set || !desc.get) return;
      Object.defineProperty(proto, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set(value) {
          desc.set.call(this, mapValue(value));
          if (typeof afterSet === 'function') afterSet(this);
        }
      });
    } catch {}
  };
  patchElementUrlProperty(typeof HTMLScriptElement !== 'undefined' && HTMLScriptElement.prototype, 'src', proxied);
  patchElementUrlProperty(typeof HTMLLinkElement !== 'undefined' && HTMLLinkElement.prototype, 'href', proxied);
  patchElementUrlProperty(typeof HTMLImageElement !== 'undefined' && HTMLImageElement.prototype, 'src', proxied);
  patchElementUrlProperty(typeof HTMLImageElement !== 'undefined' && HTMLImageElement.prototype, 'srcset', rewriteSrcset);
  patchElementUrlProperty(typeof HTMLSourceElement !== 'undefined' && HTMLSourceElement.prototype, 'src', proxied, scheduleVideoReload);
  patchElementUrlProperty(typeof HTMLSourceElement !== 'undefined' && HTMLSourceElement.prototype, 'srcset', rewriteSrcset, scheduleVideoReload);
  patchElementUrlProperty(typeof HTMLVideoElement !== 'undefined' && HTMLVideoElement.prototype, 'src', proxied, scheduleVideoReload);
  patchElementUrlProperty(typeof HTMLAnchorElement !== 'undefined' && HTMLAnchorElement.prototype, 'href', proxied);
  const cssSet = typeof CSSStyleDeclaration !== 'undefined' && CSSStyleDeclaration.prototype && CSSStyleDeclaration.prototype.setProperty;
  if (cssSet) {
    CSSStyleDeclaration.prototype.setProperty = function(name, value, priority) {
      const prop = String(name || '').toLowerCase();
      if (/(?:background|image|cursor|content)/i.test(prop) && typeof value === 'string') {
        return cssSet.call(this, name, rewriteCssUrlValue(value), priority);
      }
      return cssSet.call(this, name, value, priority);
    };
  }
  const patchStyleUrlProperty = (prop) => {
    try {
      if (typeof CSSStyleDeclaration === 'undefined' || !CSSStyleDeclaration.prototype) return;
      const desc = Object.getOwnPropertyDescriptor(CSSStyleDeclaration.prototype, prop);
      if (!desc || !desc.set || !desc.get) return;
      Object.defineProperty(CSSStyleDeclaration.prototype, prop, {
        configurable: true,
        enumerable: desc.enumerable,
        get: desc.get,
        set(value) { desc.set.call(this, rewriteCssUrlValue(value)); }
      });
    } catch {}
  };
  ['backgroundImage', 'background', 'listStyleImage', 'borderImageSource', 'content', 'cursor'].forEach(patchStyleUrlProperty);
  // Catch <img>/<source>/<video>/<link>/<script>/<a> injected via innerHTML or
  // React rendering with raw Steam URLs that bypassed the setAttribute/property
  // patches (HTML parsing sets attributes without going through JS setters).
  // Only rewrites raw Steam URLs; already-proxied URLs are left alone, so no
  // re-entrant mutation loop.
  const isRawSteamUrl = (raw) => {
    const text = String(raw || '').trim();
    if (!text || !/^https?:\\/\\//i.test(text)) return false;
    try { return isSteamHost(new URL(text).hostname); } catch { return false; }
  };
  const isBrokenProxyAbsoluteUrl = (raw) => /^https?:\\/\\/url\\/proxy(?:\\/|\\?)/i.test(String(raw || '').trim());
  const rewriteElUrls = (el) => {
    if (!el || el.nodeType !== 1) return;
    let mediaChanged = false;
    for (const a of ['src', 'href', 'poster', 'data-src', 'data-poster']) {
      const v = el.getAttribute(a);
      if (v && (isRawSteamUrl(v) || isBrokenProxyAbsoluteUrl(v))) {
        el.setAttribute(a, proxied(v));
        if (a === 'src' || a === 'poster') mediaChanged = true;
      }
    }
    const ss = el.getAttribute && el.getAttribute('srcset');
    if (ss) {
      el.setAttribute('srcset', rewriteSrcset(ss));
      mediaChanged = true;
    }
    if (mediaChanged) scheduleVideoReload(el);
  };
  try {
    const domObserver = new MutationObserver((mutations) => {
      for (const mut of mutations) {
        for (const node of mut.addedNodes) {
          if (node.nodeType !== 1) continue;
          rewriteElUrls(node);
          if (node.querySelectorAll) {
            node.querySelectorAll('img,source,video,a,link,script,iframe').forEach(rewriteElUrls);
          }
        }
      }
    });
    domObserver.observe(document.documentElement, { childList: true, subtree: true });
  } catch {}
  // Steam's workshop tag controls sometimes assign a native href immediately
  // before dispatching click, bypassing the DOM setter/observer hooks above.
  // Intercept only those navigation links in capture phase and route them back
  // through the virtual Steam Community path.
  const rewriteSteamAnchorOnClick = (event) => {
    try {
      const clicked = event && event.target && event.target.nodeType === 1 ? event.target : null;
      const anchor = clicked && clicked.closest ? clicked.closest('a[href]') : null;
      if (!anchor) return;
      const raw = anchor.getAttribute('href') || anchor.href || '';
      const target = new URL(raw, baseFor(raw));
      if (!isSteamCommunityHost(target.hostname) || !/^\\/workshop\\/browse\\/?$/i.test(target.pathname || '')) return;
      const next = proxied(raw);
      if (!next || next === raw) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(next);
    } catch {}
  };
  try { document.addEventListener('click', rewriteSteamAnchorOnClick, true); } catch {}
  // Current Workshop React pages render filter/tag controls as role=button divs
  // rather than anchors. Their delegated handler navigates to Steam's native
  // Browse URL, so capture these known Workshop tags before that handler runs.
  const workshopTagBrowsePath = (value) => {
    try {
      const tag = String(value || '').replace(/\\s*\\(\\s*[\\d,]+\\s*\\)\\s*$/, '').trim();
      if (!tag || !workshopCommunityTags.has(tag.toLowerCase())) return '';
      const page = new URL(currentTarget(), location.href);
      const appid = String(page.searchParams.get('appid') || ((page.pathname.match(/\\/app\\/(\\d+)/i) || [])[1]) || '').trim();
      if (!/^\\d+$/.test(appid)) return '';
      const target = new URL('https://steamcommunity.com/workshop/browse/');
      target.searchParams.set('appid', appid);
      target.searchParams.append('requiredtags[]', tag);
      return proxied(target.toString());
    } catch { return ''; }
  };
  const rewriteWorkshopTagControlOnClick = (event) => {
    try {
      const target = event && event.target;
      const clicked = target && target.nodeType === 1 ? target : (target && target.parentElement ? target.parentElement : null);
      const control = clicked && clicked.closest ? clicked.closest('button,[role="button"]') : null;
      if (!control || control.closest('a[href]')) return;
      const next = workshopTagBrowsePath(control.textContent || '');
      if (!next) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(next);
    } catch {}
  };
  try { document.addEventListener('click', rewriteWorkshopTagControlOnClick, true); } catch {}
  // Dropdown choices are React listbox options, not links. Capture their choice
  // before Steam's delegated handler navigates to the native Community origin.
  const workshopFilterBrowsePath = (value) => {
    try {
      const tag = String(value || '').replace(/\\s*\\(\\s*[\\d,]+\\s*\\)\\s*$/, '').trim();
      const page = new URL(currentTarget(), location.href);
      const appid = String(page.searchParams.get('appid') || ((page.pathname.match(/\\/app\\/(\\d+)/i) || [])[1]) || '').trim();
      if (!/^\\d+$/.test(appid)) return '';
      if (!tag || /^(?:<[^>]+>|none|not selected)$/i.test(tag)) {
        return proxied('https://steamcommunity.com/app/' + appid + '/workshop/');
      }
      const target = new URL('https://steamcommunity.com/workshop/browse/');
      target.searchParams.set('appid', appid);
      target.searchParams.append('requiredtags[]', tag);
      return proxied(target.toString());
    } catch { return ''; }
  };
  const rewriteWorkshopFilterOption = (event) => {
    try {
      const target = event && event.target;
      const clicked = target && target.nodeType === 1 ? target : (target && target.parentElement ? target.parentElement : null);
      const option = clicked && clicked.closest ? clicked.closest('[role="option"]') : null;
      if (!option || !option.closest('[role="listbox"]')) return;
      const next = workshopFilterBrowsePath(option.textContent || '');
      if (!next) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      window.location.assign(next);
    } catch {}
  };
  try {
    document.addEventListener('click', rewriteWorkshopFilterOption, true);
    document.addEventListener('keydown', (event) => {
      if (event && (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar')) rewriteWorkshopFilterOption(event);
    }, true);
  } catch {}
`;
