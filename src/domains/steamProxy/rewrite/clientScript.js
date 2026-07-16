'use strict';

function wallhubProxyClientScript(options = {}, baseUrl = '') {
  const virtualHostParam = options.virtualHostParam || '__whp_host';
  const workshopCommunityTags = options.workshopCommunityTags || new Set();
    const pageTargetJson = JSON.stringify(String(baseUrl || ''));
    const virtualHostParamJson = JSON.stringify(virtualHostParam);
    const workshopCommunityTagsJson = JSON.stringify(Array.from(workshopCommunityTags));
    return `<script data-wallhub-url-proxy="1">
(() => {
  if (window.__wallhubUrlProxyInstalled) return;
  window.__wallhubUrlProxyInstalled = true;
  window.__wallhubProxyPageTarget = window.__wallhubProxyPageTarget || ${pageTargetJson};
  const virtualHostParam = ${virtualHostParamJson};
  const workshopCommunityTags = new Set(${workshopCommunityTagsJson});
  const steamDomains = ['steamcommunity.com','steampowered.com','steam-api.com','steamusercontent.com','steamcontent.com','steamstatic.com','fastly.steamstatic.com','akamai.steamstatic.com','cloudflare.steamstatic.com','s.team','steam-chat.com','steam.tv','steamgames.com','valvesoftware.com','steamstat.us','steamstats.valve.org','akamaihd.net','steambroadcast.akamaized.net','steambroadcast-test.akamaized.net','steambroadcastchat.akamaized.net','broadcast.st.dl.eccdnx.com','lv.queniujq.cn','steamserver.net'];
  const currentTarget = () => {
    try { return window.__wallhubProxyPageTarget || new URLSearchParams(location.search).get('url') || location.href; } catch { return location.href; }
  };
  const isSteamHost = (host) => {
    host = String(host || '').toLowerCase();
    return steamDomains.some((domain) => host === domain || host.endsWith('.' + domain));
  };
  const isSteamStoreHost = (host) => {
    host = String(host || '').toLowerCase();
    return host === 'store.steampowered.com' || host.endsWith('.store.steampowered.com');
  };
  const isVirtualStoreAppPath = (path) => /^\\/app\\/\\d+(?:\\/[^/?#]+)?\\/?$/i.test(String(path || ''));
  const isVirtualStoreServicePath = (path) => {
    path = String(path || '');
    if (!path || path === '/') return false;
    return /^\\/(?:app\\/\\d+(?:\\/[^/?#]+)?|appreviews(?:\\/|$)|appreviewhistogram(?:\\/|$)|api(?:\\/|$)|ajax[A-Za-z0-9_]*(?:\\/|$)|points(?:\\/|$)|charts(?:\\/|$)|search(?:\\/|$)|news(?:\\/|$)|category(?:\\/|$)|categories(?:\\/|$)|genre(?:\\/|$)|tags?(?:\\/|$)|sale(?:\\/|$)|sales(?:\\/|$)|curator(?:\\/|$)|developer(?:\\/|$)|publisher(?:\\/|$)|franchise(?:\\/|$)|recommended(?:\\/|$)|explore(?:\\/|$)|wishlist(?:\\/|$)|cart(?:\\/|$)|account(?:\\/|$)|join(?:\\/|$)|steamaccount(?:\\/|$)|agecheck(?:\\/|$)|bundle(?:\\/|$)|sub(?:\\/|$)|dlc(?:\\/|$)|labs(?:\\/|$)|hardware(?:\\/|$)|about(?:\\/|$)|stats(?:\\/|$)|remoteplay(?:\\/|$)|deck(?:\\/|$)|steamdeck(?:\\/|$)|events(?:\\/|$)|yearinreview(?:\\/|$)|replay(?:\\/|$))/i.test(path);
  };
  const isSteamCommunityHost = (host) => {
    host = String(host || '').toLowerCase();
    return host === 'steamcommunity.com' || host.endsWith('.steamcommunity.com');
  };
  const isVirtualCommunityServicePath = (path) => {
    path = String(path || '');
    if (!path || path === '/') return false;
    return /^\\/(?:api(?:\\/|$)|app(?:\\/|$)|sharedfiles(?:\\/|$)|workshop(?:\\/|$)|market(?:\\/|$)|profiles(?:\\/|$)|id(?:\\/|$)|gid(?:\\/|$)|groups(?:\\/|$)|games(?:\\/|$)|my(?:\\/|$)|friends(?:\\/|$)|chat(?:\\/|$)|broadcast(?:\\/|$)|stats(?:\\/|$)|news(?:\\/|$)|discussions(?:\\/|$)|guide(?:\\/|$)|actions(?:\\/|$)|linkfilter(?:\\/|$)|tradeoffer(?:\\/|$)|search(?:\\/|$))/i.test(path);
  };
  const normalizeStoreAppLocation = () => {
    try {
      if (!/^\\/url\\/proxy(?:\\/|$)/i.test(location.pathname)) return;
      const target = new URL(currentTarget(), location.href);
      if (!isSteamStoreHost(target.hostname) || !isVirtualStoreServicePath(target.pathname)) return;
      const params = new URLSearchParams(target.search || '');
      params.set(virtualHostParam, target.hostname);
      const next = target.pathname + (params.toString() ? '?' + params.toString() : '') + (target.hash || '');
      if (next && next !== location.pathname + location.search + location.hash) {
        history.replaceState(history.state, '', next);
      }
    } catch {}
  };
  normalizeStoreAppLocation();
  const isUrlDataAttr = (attr) => /^data-[\\w:-]*(?:url|src|source|sources|image|images|background|href|movie|video|webm|mp4|screenshot|thumb|thumbnail|full|small|large|highlight)$/i.test(String(attr || ''));
  const steamPublicBase = () => {
    const valve = typeof window.VALVE_PUBLIC_PATH === 'string' ? window.VALVE_PUBLIC_PATH : '';
    if (valve && /^https?:\\/\\//i.test(valve)) return valve;
    try {
      const cfg = document.getElementById('application_config');
      const raw = cfg && cfg.getAttribute('data-config');
      if (raw) {
        const data = JSON.parse(raw.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'));
        if (data && data.WEBSITE_ID === 'Community' && typeof data.COMMUNITY_CDN_URL === 'string') {
          return data.COMMUNITY_CDN_URL.replace(/\\/?$/, '/') + 'public/';
        }
        if (data && typeof data.PUBLIC_SHARED_URL === 'string') {
          try { return new URL('../', data.PUBLIC_SHARED_URL).toString(); } catch {}
        }
        if (data && typeof data.STORE_CDN_URL === 'string') return data.STORE_CDN_URL.replace(/\\/?$/, '/') + 'public/';
      }
    } catch {}
    return 'https://store.fastly.steamstatic.com/public/';
  };
  const baseFor = (raw) => {
    const text = String(raw || '');
    if (/^(?:javascript|css)\\/applications\\//i.test(text)) return steamPublicBase();
    if (/^\\/(?:javascript|css)\\/applications\\//i.test(text)) return steamPublicBase();
    if (/^shared\\//i.test(text)) return steamPublicBase();
    if (/^\\/shared\\//i.test(text)) return steamPublicBase();
    return currentTarget();
  };
  const isSteamAppRelativePath = (path) => {
    const rel = String(path || '').replace(/^\\/+/, '');
    return /^(?:javascript|css)\\/applications\\//i.test(rel) || /^shared\\//i.test(rel);
  };
  const steamAppRelativeProxyPath = (target) => {
    const rel = String(target.pathname || '').replace(/^\\/+/, '');
    if (/^(?:javascript|css)\\/applications\\/store\\//i.test(rel)) {
      return '/url/proxy/' + rel + (target.search || '') + (target.hash || '');
    }
    return '/url/proxy/?url=' + encodeURIComponent(new URL(rel + (target.search || '') + (target.hash || ''), steamPublicBase()).toString());
  };
  const virtualSteamProxyPath = (target) => {
    try {
      if (isSteamStoreHost(target.hostname) && /^\\/stats\\/?$/i.test(target.pathname || '')) target.pathname = '/charts/';
      if (isSteamStoreHost(target.hostname) && !isVirtualStoreServicePath(target.pathname)) return '';
      if (isSteamCommunityHost(target.hostname) && !isVirtualCommunityServicePath(target.pathname)) return '';
      if (!isSteamStoreHost(target.hostname) && !isSteamCommunityHost(target.hostname)) return '';
      const params = new URLSearchParams(target.search || '');
      params.set(virtualHostParam, target.hostname);
      return target.pathname + (params.toString() ? '?' + params.toString() : '') + (target.hash || '');
    } catch { return ''; }
  };
  const skipUrl = (raw) => {
    const text = String(raw || '').trim();
    return !text || /^(?:data|blob|javascript|mailto|steam|about):/i.test(text) || text[0] === '#';
  };
  const upstreamOrigin = () => {
    try {
      const target = new URL(currentTarget(), location.href);
      if (isSteamHost(target.hostname)) return target.protocol + '//' + target.host;
    } catch {}
    try {
      const host = new URLSearchParams(location.search || '').get(virtualHostParam);
      if (host && isSteamHost(host)) return 'https://' + host;
    } catch {}
    return 'https://steamcommunity.com';
  };
  const proxied = (value) => {
    if (!value) return value;
    const raw = typeof value === 'string' ? value : (value && (value.url || value.href));
    if (typeof raw === 'string' && /^\\/url\\/proxy(?:\\/|\\?)/i.test(raw)) return value;
    if (typeof raw === 'string' && /^https?:\\/\\/url\\/proxy(?:\\/|\\?)/i.test(raw)) {
      try {
        const broken = new URL(raw);
        return '/url' + broken.pathname + broken.search + broken.hash;
      } catch {}
    }
    if (typeof raw === 'string' && /^https?:\\/\\/proxy(?:\\/|\\?)/i.test(raw)) {
      try {
        const broken = new URL(raw);
        return '/url/proxy' + (broken.pathname === '/' ? '/' : broken.pathname) + broken.search + broken.hash;
      } catch {}
    }
    if (typeof raw === 'string' && /^\\/proxy(?:\\/|\\?)/i.test(raw)) return '/url' + raw;
    if (!raw || skipUrl(raw)) return value;
    let target;
    try {
      target = new URL(raw, baseFor(raw));
      if ((target.hostname === 'api.steampowered.com' || target.hostname === 'community.steam-api.com') && /\\/I[A-Za-z0-9_]+Service\\//i.test(target.pathname)) {
        const origin = target.searchParams.get('origin') || '';
        if (/^https?:\\/\\/(?:localhost|127\\.0\\.0\\.1|\\[::1\\])(?::\\d+)?\\/?$/i.test(origin)) {
          target.searchParams.set('origin', upstreamOrigin());
        }
      }
      if ((target.hostname === 's.team' || target.hostname.endsWith('.s.team')) && /^\\/q\\//i.test(target.pathname)) {
        return typeof value === 'string' ? target.toString() : value;
      }
      if (!isSteamHost(target.hostname)) {
        const sameLocalOrigin = target.origin === location.origin || /^(?:localhost|127\\.0\\.0\\.1|\\[::1\\])(?::\\d+)?$/i.test(target.host);
        if (sameLocalOrigin && isSteamAppRelativePath(target.pathname)) {
          return steamAppRelativeProxyPath(target);
        } else if (sameLocalOrigin && !/^\\/(?:url\\/proxy|assets|favicon\\.ico|health)(?:\\/|$)/i.test(target.pathname)) {
          const params = new URLSearchParams(target.search || '');
          params.delete(virtualHostParam);
          target = new URL((target.pathname || '/') + (params.toString() ? '?' + params.toString() : '') + (target.hash || ''), currentTarget());
        }
      }
    } catch { return value; }
    if (!/^https?:$/i.test(target.protocol) || !isSteamHost(target.hostname)) return value;
    const virtualPath = virtualSteamProxyPath(target);
    if (virtualPath) return typeof value === 'string' ? virtualPath : virtualPath;
    const path = '/url/proxy/?url=' + encodeURIComponent(target.toString());
    const next = (String(raw || '').includes('$') && typeof location !== 'undefined')
      ? new URL(path, location.origin).toString()
      : path;
    if (typeof value === 'string') return next;
    try { if (value instanceof Request) return new Request(next, value); } catch {}
    return next;
  };
  const rewriteSrcset = (value) => {
    if (typeof value !== 'string' || !value) return value;
    return value.split(',').map((part) => {
      const seg = part.trim();
      if (!seg) return seg;
      const pieces = seg.split(/\\s+/);
      pieces[0] = proxied(pieces[0]);
      return pieces.join(' ');
    }).join(', ');
  };
  const rewriteCssUrlValue = (value) => {
    if (typeof value !== 'string') return value;
    return value.replace(/url\((["']?)([^"')]+)\\1\)/gi, (m, quote, raw) => {
      if (!raw || skipUrl(raw)) return m;
      return 'url(' + (quote || '') + proxied(raw) + (quote || '') + ')';
    });
  };
  const isStoreHighlightVideo = (video) => !!(video && video.closest && video.closest('.gamehighlight_desktopcarousel, .highlight_player_area, .highlight_movie'));
  const videoVisibleScore = (video) => {
    try {
      const rect = video.getBoundingClientRect();
      if (!rect || rect.width <= 1 || rect.height <= 1) return 0;
      const style = getComputedStyle(video);
      if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity || 1) <= 0.01) return 0;
      const cx = Math.max(0, Math.min(innerWidth || document.documentElement.clientWidth || rect.right, rect.right) - Math.max(0, rect.left));
      const cy = Math.max(0, Math.min(innerHeight || document.documentElement.clientHeight || rect.bottom, rect.bottom) - Math.max(0, rect.top));
      return cx * cy;
    } catch { return 0; }
  };
  const storeHighlightVideos = () => Array.from(document.querySelectorAll('.gamehighlight_desktopcarousel video, .highlight_player_area video, .highlight_movie video'));
  const activeStoreHighlightVideo = () => {
    try {
      const visible = storeHighlightVideos()
        .map((video) => ({ video, score: videoVisibleScore(video) }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
      return (visible[0] && visible[0].video) || null;
    } catch { return null; }
  };
  const pauseStoreHighlightVideo = (video) => {
    try {
      if (!video) return;
      if (videoProgrammaticPauseState) videoProgrammaticPauseState.add(video);
      video.pause();
    } catch {}
  };
  const pauseHiddenStoreHighlightVideos = (activeVideo) => {
    try {
      const videos = storeHighlightVideos();
      const keep = activeVideo || activeStoreHighlightVideo();
      for (const video of videos) {
        if (video === keep) continue;
        pauseStoreHighlightVideo(video);
      }
    } catch {}
  };
  const scheduleStoreHighlightPauseHidden = (activeVideo) => {
    try {
      [0, 80, 250, 700].forEach((delay) => setTimeout(() => pauseHiddenStoreHighlightVideos(activeVideo), delay));
    } catch {}
  };
  const videoReloadState = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  const videoUserPausedState = typeof WeakMap !== 'undefined' ? new WeakMap() : null;
  const videoPauseTracked = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  const videoProgrammaticPauseState = typeof WeakSet !== 'undefined' ? new WeakSet() : null;
  const videoSignature = (video) => {
    try {
      const sources = Array.from(video.querySelectorAll ? video.querySelectorAll('source') : [])
        .map((source) => source.getAttribute('src') || '')
        .filter(Boolean)
        .join('|');
      return [video.getAttribute('src') || video.currentSrc || video.src || '', sources, video.getAttribute('poster') || ''].join('::');
    } catch { return ''; }
  };
  const trackVideoPauseIntent = (video) => {
    try {
      if (!video || !videoPauseTracked || videoPauseTracked.has(video)) return;
      videoPauseTracked.add(video);
      video.addEventListener('pause', () => {
        try {
          if (videoProgrammaticPauseState && videoProgrammaticPauseState.has(video)) {
            videoProgrammaticPauseState.delete(video);
            return;
          }
          if (!videoUserPausedState || video.ended) return;
          videoUserPausedState.set(video, videoSignature(video));
        } catch {}
      }, true);
      const clear = () => { try { if (videoUserPausedState) videoUserPausedState.delete(video); } catch {} };
      video.addEventListener('play', clear, true);
      video.addEventListener('playing', () => {
        clear();
        if (isStoreHighlightVideo(video)) scheduleStoreHighlightPauseHidden(null);
      }, true);
    } catch {}
  };
  const isVideoUserPaused = (video) => {
    try {
      if (!videoUserPausedState || !video.paused) return false;
      const sig = videoUserPausedState.get(video);
      return !!sig && sig === videoSignature(video);
    } catch { return false; }
  };
  const scheduleVideoReload = (node) => {
    try {
      if (!node || node.nodeType !== 1) return;
      const tag = String(node.tagName || '').toUpperCase();
      const video = tag === 'VIDEO' ? node : (tag === 'SOURCE' && node.closest ? node.closest('video') : null);
      if (!video) return;
      trackVideoPauseIntent(video);
      const signature = videoSignature(video);
      if (!signature) return;
      if (videoReloadState && videoReloadState.get(video) === signature) return;
      if (videoReloadState) videoReloadState.set(video, signature);
      const run = () => {
        if (isStoreHighlightVideo(video)) pauseHiddenStoreHighlightVideos(null);
        if (isVideoUserPaused(video)) return;
        const current = String(video.currentSrc || video.src || video.getAttribute('src') || '');
        // Steam's store trailer player uses MediaSource blob: URLs backed by
        // .m4s segment fetches. Calling load() after the blob is attached can
        // detach/restart the MediaSource and leave the player spinning forever.
        if (!/^blob:/i.test(current)) {
          try { video.load(); } catch {}
        }
      };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(run);
      else setTimeout(run, 0);
    } catch {}
  };
  const nativeFetch = window.fetch;
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
  const pickStoreHighlightUrl = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) {
      for (const item of value) {
        const picked = pickStoreHighlightUrl(item);
        if (picked) return picked;
      }
      return '';
    }
    if (typeof value === 'object') {
      return value.max || value.high || value['720'] || value['600'] || value['480'] || value.url || value.href || value.webmMax || value.webm_max || value.mp4Max || value.mp4_max || pickStoreHighlightUrl(value.webm) || pickStoreHighlightUrl(value.mp4) || value.full || value.standard || value.thumbnail || '';
    }
    return '';
  };
  const storeHighlightItems = () => {
    try {
      const target = document.querySelector('.gamehighlight_desktopcarousel[data-props]');
      if (!target) return [];
      const props = JSON.parse(target.getAttribute('data-props') || '{}');
      const items = [];
      for (const trailer of props.trailers || props.highlightTrailers || props.movies || []) {
        const poster = pickStoreHighlightUrl(trailer.poster || trailer.thumbnail || trailer.screenshot || trailer.image || trailer.images);
        const video = pickStoreHighlightUrl(trailer.webmMax || trailer.webm_max || trailer.webm || trailer.mp4Max || trailer.mp4_max || trailer.mp4 || trailer.sources || trailer.url);
        if (poster || video) items.push({ type: 'trailer', title: trailer.title || trailer.name || props.appName || '', poster, video });
      }
      for (const screenshot of props.screenshots || props.highlightScreenshots || []) {
        const image = pickStoreHighlightUrl(screenshot.full || screenshot.standard || screenshot.thumbnail || screenshot.url || screenshot.image);
        if (image) items.push({ type: 'screenshot', title: screenshot.altText || screenshot.title || props.appName || '', poster: image, thumb: pickStoreHighlightUrl(screenshot.thumbnail || screenshot.standard || image) });
      }
      return items;
    } catch { return []; }
  };
  let lastStoreHighlightIndex = 0;
  const storeHighlightThumbs = () => Array.from(document.querySelectorAll('.gamehighlight_desktopcarousel img, .highlight_player_area img'))
    .filter((img) => {
      try {
        const rect = img.getBoundingClientRect();
        return rect.width > 20 && rect.height > 20 && rect.width < 260 && rect.height < 180;
      } catch { return false; }
    });
  try {
    document.addEventListener('click', (event) => {
      try {
        if (!isVirtualStoreAppPath(location.pathname)) return;
        const clicked = event.target && event.target.nodeType === 1 ? event.target : null;
        const directImg = clicked && clicked.closest ? clicked.closest('img') : null;
        const thumbs = storeHighlightThumbs();
        let idx = directImg ? thumbs.indexOf(directImg) : -1;
        if (idx < 0 && clicked) idx = thumbs.findIndex((img) => img === clicked || (img.parentElement && img.parentElement.contains(clicked)) || (clicked.contains && clicked.contains(img)));
        if (idx < 0) return;
        lastStoreHighlightIndex = idx;
        const videos = Array.from(document.querySelectorAll('.gamehighlight_desktopcarousel video, .highlight_player_area video, .highlight_movie video'));
        videos.forEach(pauseStoreHighlightVideo);
        scheduleStoreHighlightPauseHidden(null);
      } catch {}
    }, true);
  } catch {}
  const activeStoreHighlightIndex = () => {
    try {
      const thumbs = storeHighlightThumbs();
      const active = thumbs.findIndex((img) => {
        const node = img.closest('[class],button,[aria-selected]') || img;
        const cls = String(node.className || '');
        return /active|focus|selected|current/i.test(cls) || node.getAttribute('aria-selected') === 'true';
      });
      if (active >= 0) return active;
    } catch {}
    return lastStoreHighlightIndex || 0;
  };
  const nudgeStoreHighlightVideo = () => {
    try {
      if (!isVirtualStoreAppPath(location.pathname)) return;
      const host = new URLSearchParams(location.search || '').get(virtualHostParam);
      if (!isSteamStoreHost(host)) return;
      document.querySelectorAll('.gamehighlight_desktopcarousel video, .highlight_player_area video, .highlight_movie video').forEach((video) => {
        try {
          const visible = !!(video.offsetParent || video.getClientRects().length);
          if (!visible) return;
          trackVideoPauseIntent(video);
          const current = String(video.currentSrc || video.src || video.getAttribute('src') || '');
          if (!isVideoUserPaused(video) && !/^blob:/i.test(current) && video.readyState < 2) video.load();
          pauseHiddenStoreHighlightVideos(video);
        } catch {}
      });
    } catch {}
  };
  const installStoreHighlightFallback = () => {
    try {
      if (!isVirtualStoreAppPath(location.pathname)) return;
      const host = new URLSearchParams(location.search || '').get(virtualHostParam);
      if (!isSteamStoreHost(host)) return;
      const target = document.querySelector('.gamehighlight_desktopcarousel[data-props]');
      if (!target || target.getAttribute('data-wallhub-fallback') === '1') return;
      const props = JSON.parse(target.getAttribute('data-props') || '{}');
      const items = [];
      const pickUrl = (value) => {
        if (!value) return '';
        if (typeof value === 'string') return value;
        if (Array.isArray(value)) return pickUrl(value[0]);
        if (typeof value === 'object') return value.url || value.href || value.webm || value.mp4 || value.max || value.full || value.standard || value.thumbnail || '';
        return '';
      };
      for (const trailer of props.trailers || props.highlightTrailers || props.movies || []) {
        const poster = pickUrl(trailer.poster || trailer.thumbnail || trailer.screenshot || trailer.image || trailer.images);
        const video = pickUrl(trailer.webmMax || trailer.webm_max || trailer.webm || trailer.mp4Max || trailer.mp4_max || trailer.mp4 || trailer.sources || trailer.url);
        if (poster || video) items.push({ type: 'trailer', title: trailer.title || trailer.name || props.appName || '', poster, video });
      }
      for (const screenshot of props.screenshots || props.highlightScreenshots || []) {
        const image = pickUrl(screenshot.full || screenshot.standard || screenshot.thumbnail || screenshot.url || screenshot.image);
        if (image) items.push({ type: 'screenshot', title: screenshot.altText || screenshot.title || props.appName || '', poster: image, thumb: pickUrl(screenshot.thumbnail || screenshot.standard || image) });
      }
      if (!items.length) return;
      const hasMountedContent = () => Array.from(target.children || []).some((child) => {
        const cls = String(child.className || '');
        return !/gamehighlight_desktopskeleton/i.test(cls) && (child.querySelector && (child.querySelector('img,video,source,button') || child.children.length));
      });
      const onlySkeleton = !hasMountedContent();
      if (!onlySkeleton) {
        document.querySelectorAll('.gamehighlight_desktopcarousel video, .highlight_player_area video, .highlight_movie video').forEach((video) => {
          scheduleVideoReload(video);
          try {
            const current = String(video.currentSrc || video.src || video.getAttribute('src') || '');
            if (!isVideoUserPaused(video)) {
              if (!/^blob:/i.test(current) && video.readyState < 2) video.load();
              pauseHiddenStoreHighlightVideos(video);
            }
          } catch {}
        });
        return;
      }
      const style = document.createElement('style');
      style.textContent = '.wallhub_store_highlight{display:flex;flex-direction:column;width:100%;height:100%;min-height:460px;background:#000;color:#dfe3ea}.wallhub_store_highlight_stage{position:relative;display:flex;align-items:center;justify-content:center;min-height:0;flex:1;background:#000;overflow:hidden}.wallhub_store_highlight_stage img,.wallhub_store_highlight_stage video{width:100%;height:100%;object-fit:contain;background:#000}.wallhub_store_highlight_title{position:absolute;left:0;right:0;bottom:0;padding:16px 18px;background:linear-gradient(transparent,rgba(0,0,0,.74));font-size:14px;color:#fff}.wallhub_store_highlight_strip{display:flex;gap:6px;overflow-x:auto;padding:8px;background:rgba(0,0,0,.35)}.wallhub_store_highlight_thumb{width:116px;height:65px;flex:0 0 auto;border:2px solid transparent;background:#111;cursor:pointer;opacity:.72;padding:0}.wallhub_store_highlight_thumb.active{border-color:#66c0f4;opacity:1}.wallhub_store_highlight_thumb img{display:block;width:100%;height:100%;object-fit:cover}.wallhub_store_highlight_play{position:absolute;display:grid;place-items:center;width:74px;height:74px;border-radius:50%;background:rgba(0,0,0,.55);color:#fff;font-size:34px;pointer-events:none}';
      document.head.appendChild(style);
      const root = document.createElement('div');
      root.className = 'wallhub_store_highlight';
      const stage = document.createElement('div');
      stage.className = 'wallhub_store_highlight_stage';
      const strip = document.createElement('div');
      strip.className = 'wallhub_store_highlight_strip';
      const render = (index) => {
        const item = items[index] || items[0];
        stage.textContent = '';
        const media = document.createElement(item.video ? 'video' : 'img');
        if (item.video) {
          media.controls = true;
          media.autoplay = true;
          media.muted = true;
          media.preload = 'auto';
          media.poster = proxied(item.poster || '');
          media.src = proxied(item.video || '');
          media.setAttribute('playsinline', '');
        } else {
          media.src = proxied(item.poster || '');
          media.alt = item.title || '';
        }
        stage.appendChild(media);
        if (item.video) {
          const play = document.createElement('div');
          play.className = 'wallhub_store_highlight_play';
          play.textContent = '▶';
          stage.appendChild(play);
          const playPromise = media.play && media.play();
          if (playPromise && typeof playPromise.catch === 'function') playPromise.catch(() => {});
        }
        if (item.title) {
          const title = document.createElement('div');
          title.className = 'wallhub_store_highlight_title';
          title.textContent = item.title;
          stage.appendChild(title);
        }
        Array.from(strip.children).forEach((child, i) => child.classList.toggle('active', i === index));
      };
      items.forEach((item, index) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'wallhub_store_highlight_thumb';
        btn.addEventListener('click', () => render(index));
        const img = document.createElement('img');
        img.src = proxied(item.thumb || item.poster || '');
        img.alt = item.title || '';
        btn.appendChild(img);
        strip.appendChild(btn);
      });
      root.appendChild(stage);
      root.appendChild(strip);
      target.textContent = '';
      target.setAttribute('data-wallhub-fallback', '1');
      target.appendChild(root);
      document.querySelectorAll('.gamehighlight_desktopskeleton').forEach((node) => node.remove());
      render(0);
    } catch {}
  };
  const scheduleStoreHighlightFallback = () => {
    const runNudges = () => [0, 300, 1000, 2000].forEach((delay) => setTimeout(nudgeStoreHighlightVideo, delay));
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => {
        runNudges();
        setTimeout(installStoreHighlightFallback, 2000);
      }, { once: true });
    } else {
      runNudges();
      setTimeout(installStoreHighlightFallback, 2000);
    }
  };
  scheduleStoreHighlightFallback();
})();
</script>`;
  }

module.exports = { wallhubProxyClientScript };
