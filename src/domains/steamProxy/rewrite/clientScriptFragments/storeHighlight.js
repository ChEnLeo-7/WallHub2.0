'use strict';

module.exports = `  const pickStoreHighlightUrl = (value) => {
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
`;
