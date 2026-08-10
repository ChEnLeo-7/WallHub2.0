'use strict';

module.exports = `(() => {
  if (window.__wallhubUrlProxyInstalled) return;
  window.__wallhubUrlProxyInstalled = true;
  window.__wallhubProxyPageTarget = window.__wallhubProxyPageTarget || __WALLHUB_PAGE_TARGET__;
  const virtualHostParam = __WALLHUB_VIRTUAL_HOST_PARAM__;
  const workshopCommunityTags = new Set(__WALLHUB_WORKSHOP_TAGS__);
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
`;
