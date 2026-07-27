'use strict';

function pathnameFromRequest(req) {
  try { return new URL(req.url, 'http://x').pathname; } catch { return '/'; }
}

function queryFromRequest(req) {
  return new URL(req.url, 'http://x').searchParams;
}

function methodIs(req, method) {
  return req.method === method;
}

function methodIn(req, methods) {
  return methods.includes(req.method);
}

function isUrlProxyPath(pn) {
  return pn === '/url/proxy' || pn === '/url/proxy/' || pn.startsWith('/url/proxy/') || pn === '/proxy' || pn === '/proxy/';
}

function isSteamCommunityShortcutPath(pn, base) {
  return pn === base || new RegExp(`^${base}(?:/|$)`, 'i').test(pn);
}

function hasVirtualSteamHost(req, virtualHostParam) {
  try { return !!new URL(req.url, 'http://x').searchParams.get(virtualHostParam); } catch { return false; }
}

function rewriteToSteamCommunity(req, virtualHostParam) {
  const target = new URL(req.url, 'http://x');
  if (!target.searchParams.get(virtualHostParam)) {
    target.searchParams.set(virtualHostParam, 'steamcommunity.com');
  }
  req.url = target.pathname + target.search;
}

function createAppRouter(deps) {
  const {
    jsonRes,
    send,
    virtualHostParam,
    isWallhubProxyVirtualSteamPath,
    handleWallhubUrlProxy,
    handleWallhubVirtualSteamProxy,
    handleWallhubSteamAppRelativeAsset,
    handleDebug,
    handleServerRuntime,
    handleServerRuntimeDiagnostics,
    handleServerUpdateStatus,
    handleServerUpdateCheck,
    handleServerUpdateDownload,
    handleServerUpdateInstall,
    handleServerRestart,
    handleServerShutdown,
    handleInternalSteamResolve,
    handleInternalSteamWebApi,
    handleQuery,
    handleSteamAccessReady,
    handleDetails,
    handlePersonalSource,
    handleSteamSubscribe,
    handleSteamUnsubscribe,
    handleSteamFavorite,
    handleSteamUnfavorite,
    handleSteamSubscriptionStatus,
    handleDetailsBatch,
    handleCommentsPage,
    handleClientDownload,
    handleDownload,
    handleMpkgDownload,
    handleMpkgPreparationStart,
    handleMpkgPreparationStatus,
    handleVideoPlay,
    handleVideoStream,
    proxyRemoteVideoStream,
    handleDepotVideoStream,
    handleDepotVideoRelease,
    listCachedItems,
    handleCachedVideoStream,
    handleCachedItemDelete,
    listQueueItems,
    handleQueueAction,
    handleSteamQrLoginStart,
    handleSteamQrLoginStatus,
    handleSteamQrLoginCancel,
    handleSteamPasswordLoginStart,
    handleSteamPasswordLoginStatus,
    handleSteamLogin,
    handleSteamLogout,
    handleSteamStatus,
    handleSteamAccessHostsFetch,
    handleSteamAccessDiagnostics,
    handleClientEvent,
    handleVideoCacheSettingsGet,
    handleVideoCacheSettingsDetailsGet,
    handleDepotStreamCacheClear,
    handleVideoCacheSettingsPost,
    serveStatic,
  } = deps;

  async function handleProxyRoutes(req, res, pn) {
    if (isUrlProxyPath(pn)) {
      await handleWallhubUrlProxy(req, res);
      return true;
    }

    if (isWallhubProxyVirtualSteamPath(pn) || hasVirtualSteamHost(req, virtualHostParam)) {
      if (await handleWallhubVirtualSteamProxy(req, res)) return true;
    }

    if (isSteamCommunityShortcutPath(pn, '/chat')) {
      rewriteToSteamCommunity(req, virtualHostParam);
      if (await handleWallhubVirtualSteamProxy(req, res)) return true;
    }

    if (isSteamCommunityShortcutPath(pn, '/my')) {
      rewriteToSteamCommunity(req, virtualHostParam);
      if (await handleWallhubVirtualSteamProxy(req, res)) return true;
    }

    if (/(?:^|\/)(?:javascript|css)\/applications\//i.test(pn) || /(?:^|\/)shared\//i.test(pn)) {
      if (await handleWallhubSteamAppRelativeAsset(req, res)) return true;
    }

    return false;
  }

  async function handleApiRoutes(req, res, pn) {
    if (pn === '/api/internal/steam/resolve' && typeof handleInternalSteamResolve === 'function') { await handleInternalSteamResolve(req, res); return true; }
    if (pn === '/api/internal/steam/webapi' && typeof handleInternalSteamWebApi === 'function') { await handleInternalSteamWebApi(req, res); return true; }
    if (pn === '/api/debug') { await handleDebug(res); return true; }
    if (pn === '/api/server/runtime/diagnostics' && methodIs(req, 'GET') && typeof handleServerRuntimeDiagnostics === 'function') { await handleServerRuntimeDiagnostics(req, res); return true; }
    if (pn === '/api/server/runtime' && methodIs(req, 'GET')) { await handleServerRuntime(req, res); return true; }
    if (pn === '/api/server/update' && methodIs(req, 'GET') && typeof handleServerUpdateStatus === 'function') { await handleServerUpdateStatus(req, res); return true; }
    if (pn === '/api/server/update/check' && methodIs(req, 'POST') && typeof handleServerUpdateCheck === 'function') { await handleServerUpdateCheck(req, res); return true; }
    if (pn === '/api/server/update/download' && methodIs(req, 'POST') && typeof handleServerUpdateDownload === 'function') { await handleServerUpdateDownload(req, res); return true; }
    if (pn === '/api/server/update/install' && methodIs(req, 'POST') && typeof handleServerUpdateInstall === 'function') { await handleServerUpdateInstall(req, res); return true; }
    if (pn === '/api/server/restart' && methodIs(req, 'POST')) { await handleServerRestart(req, res); return true; }
    if (pn === '/api/server/shutdown' && methodIs(req, 'POST')) { await handleServerShutdown(req, res); return true; }
    if (pn === '/api/steam/access/ready' && methodIs(req, 'GET')) { await handleSteamAccessReady(req, res); return true; }
    if (pn === '/api/client/event' && methodIs(req, 'POST') && typeof handleClientEvent === 'function') { await handleClientEvent(req, res); return true; }
    if (pn === '/api/steam/query' && methodIs(req, 'POST')) { await handleQuery(req, res); return true; }

    if (pn === '/api/steam/details/batch' && methodIs(req, 'POST')) { await handleDetailsBatch(req, res); return true; }

    if (pn === '/api/steam/details' && methodIs(req, 'GET')) {
      const id = queryFromRequest(req).get('id');
      if (!id) return jsonRes(res, 400, { error: 'Missing id' }), true;
      await handleDetails(res, id);
      return true;
    }

    if (pn === '/api/steam/personal-source' && methodIs(req, 'GET')) {
      const q = queryFromRequest(req);
      const id = q.get('id');
      const filter = q.get('filter');
      if (!id || !filter) return jsonRes(res, 400, { error: 'Missing id or filter' }), true;
      await handlePersonalSource(req, res, id, filter);
      return true;
    }

    if (pn === '/api/steam/subscription-status' && methodIs(req, 'GET')) {
      const id = queryFromRequest(req).get('id');
      if (!id) return jsonRes(res, 400, { error: 'Missing id' }), true;
      await handleSteamSubscriptionStatus(req, res, id);
      return true;
    }

    if (pn === '/api/steam/subscribe' && methodIs(req, 'POST')) {
      await handleSteamSubscribe(req, res);
      return true;
    }

    if (pn === '/api/steam/unsubscribe' && methodIs(req, 'POST')) {
      await handleSteamUnsubscribe(req, res);
      return true;
    }

    if (pn === '/api/steam/favorite' && methodIs(req, 'POST')) {
      await handleSteamFavorite(req, res);
      return true;
    }

    if (pn === '/api/steam/unfavorite' && methodIs(req, 'POST')) {
      await handleSteamUnfavorite(req, res);
      return true;
    }

    if (pn === '/api/steam/comments' && methodIs(req, 'GET')) {
      const q = queryFromRequest(req);
      const id = q.get('id');
      if (!id) return jsonRes(res, 400, { error: 'Missing id' }), true;
      await handleCommentsPage(res, id, q.get('start') || 0, q.get('count') || 50, q.get('owner') || q.get('ownerId') || '');
      return true;
    }

    if (pn === '/api/download' && methodIs(req, 'GET')) {
      const q = queryFromRequest(req);
      const id = q.get('id');
      const token = q.get('token');
      const title = q.get('title') || `Wallpaper ${id}`;
      if (!id && !token) return jsonRes(res, 400, { error: 'Missing id' }), true;
      await handleClientDownload(req, res, id, title);
      return true;
    }

    if (pn === '/api/download/background' && methodIs(req, 'GET')) {
      const q = queryFromRequest(req);
      const id = q.get('id');
      const title = q.get('title') || `Wallpaper ${id}`;
      if (!id) return jsonRes(res, 400, { error: 'Missing id' }), true;
      await handleDownload(res, id, title);
      return true;
    }

    if (pn === '/api/mpkg/prepare/status' && methodIs(req, 'GET')) {
      const q = queryFromRequest(req);
      const id = q.get('id');
      const title = q.get('title') || `Wallpaper ${id}`;
      const textureProfile = q.get('profile');
      if (!id) return jsonRes(res, 400, { error: 'Missing id' }), true;
      await handleMpkgPreparationStatus(req, res, id, title, textureProfile);
      return true;
    }

    if (pn === '/api/mpkg/prepare' && methodIs(req, 'GET')) {
      const q = queryFromRequest(req);
      const id = q.get('id');
      const title = q.get('title') || `Wallpaper ${id}`;
      const textureProfile = q.get('profile');
      if (!id) return jsonRes(res, 400, { error: 'Missing id' }), true;
      await handleMpkgPreparationStart(req, res, id, title, textureProfile);
      return true;
    }

    if (pn === '/api/mpkg/download' && methodIs(req, 'GET')) {
      const q = queryFromRequest(req);
      const id = q.get('id');
      const token = q.get('token');
      const title = q.get('title') || `Wallpaper ${id}`;
      if (!id && !token) return jsonRes(res, 400, { error: 'Missing id' }), true;
      await handleMpkgDownload(req, res, id, title);
      return true;
    }

    if (pn === '/api/video/play' && methodIs(req, 'GET')) {
      const q = queryFromRequest(req);
      const id = q.get('id');
      const title = q.get('title') || `Wallpaper ${id}`;
      if (!id) return jsonRes(res, 400, { error: 'Missing id' }), true;
      await handleVideoPlay(req, res, id, title);
      return true;
    }

    if (pn === '/api/video/stream' && methodIn(req, ['GET', 'HEAD'])) {
      const id = queryFromRequest(req).get('id');
      if (!id) return jsonRes(res, 400, { error: 'Missing id' }), true;
      handleVideoStream(req, res, id);
      return true;
    }

    if (pn === '/api/video/remote' && methodIn(req, ['GET', 'HEAD'])) {
      const token = queryFromRequest(req).get('token');
      if (!token) return jsonRes(res, 400, { error: 'Missing token' }), true;
      proxyRemoteVideoStream(req, res, token);
      return true;
    }

    if (pn === '/api/video/depot' && methodIn(req, ['GET', 'HEAD'])) {
      const token = queryFromRequest(req).get('token');
      if (!token) return jsonRes(res, 400, { error: 'Missing token' }), true;
      await handleDepotVideoStream(req, res, token);
      return true;
    }

    if (pn === '/api/video/depot/release' && methodIs(req, 'POST')) {
      const token = queryFromRequest(req).get('token');
      if (!token) return jsonRes(res, 400, { error: 'Missing token' }), true;
      await handleDepotVideoRelease(req, res, token);
      return true;
    }

    if (pn === '/api/cache/list' && methodIs(req, 'GET')) {
      if (typeof res.setHeader === 'function') res.setHeader('Cache-Control', 'no-store');
      const refresh = queryFromRequest(req).get('refresh') === '1';
      jsonRes(res, 200, { items: await listCachedItems({ force: refresh }) });
      return true;
    }

    if (pn === '/api/cache/video/stream' && methodIs(req, 'GET')) {
      const key = queryFromRequest(req).get('key');
      if (!key) return jsonRes(res, 400, { error: 'Missing key' }), true;
      handleCachedVideoStream(req, res, key);
      return true;
    }

    if (pn === '/api/cache/item' && methodIs(req, 'DELETE')) {
      const key = queryFromRequest(req).get('key');
      if (!key) return jsonRes(res, 400, { error: 'Missing key' }), true;
      handleCachedItemDelete(res, key);
      return true;
    }

    if (pn === '/api/queue' && methodIs(req, 'GET')) {
      if (typeof res.setHeader === 'function') res.setHeader('Cache-Control', 'no-store');
      jsonRes(res, 200, { tasks: await listQueueItems() });
      return true;
    }

    if (pn === '/api/queue/action' && methodIs(req, 'POST')) { await handleQueueAction(req, res); return true; }
    if (pn === '/api/steam/login/qr/start' && methodIs(req, 'POST')) { await handleSteamQrLoginStart(req, res); return true; }
    if (pn === '/api/steam/login/qr/status' && methodIs(req, 'GET')) { await handleSteamQrLoginStatus(req, res); return true; }
    if (pn === '/api/steam/login/qr/cancel' && methodIs(req, 'POST')) { await handleSteamQrLoginCancel(req, res); return true; }
    if (pn === '/api/steam/login/start' && methodIs(req, 'POST')) { await handleSteamPasswordLoginStart(req, res); return true; }
    if (pn === '/api/steam/login/status' && methodIs(req, 'GET')) { await handleSteamPasswordLoginStatus(req, res); return true; }
    if (pn === '/api/steam/login' && methodIs(req, 'POST')) { await handleSteamLogin(req, res); return true; }
    if (pn === '/api/steam/logout' && methodIs(req, 'POST')) { await handleSteamLogout(req, res); return true; }
    if (pn === '/api/steam/status' && methodIs(req, 'GET')) { await handleSteamStatus(req, res); return true; }
    if (pn === '/api/steam/access/hosts/fetch' && methodIs(req, 'POST')) { await handleSteamAccessHostsFetch(req, res); return true; }
    if (pn === '/api/steam/access/diagnostics' && methodIs(req, 'GET')) { await handleSteamAccessDiagnostics(req, res); return true; }
    if (pn === '/api/video/cache/settings/details' && methodIs(req, 'GET') && typeof handleVideoCacheSettingsDetailsGet === 'function') { await handleVideoCacheSettingsDetailsGet(req, res); return true; }
    if (pn === '/api/video/cache/settings' && methodIs(req, 'GET')) { await handleVideoCacheSettingsGet(req, res); return true; }
    if (pn === '/api/video/cache/stream/clear' && methodIs(req, 'POST')) { await handleDepotStreamCacheClear(req, res); return true; }
    if (pn === '/api/video/cache/settings' && methodIs(req, 'POST')) { await handleVideoCacheSettingsPost(req, res); return true; }

    return false;
  }

  return async function handleRequest(req, res) {
    const pn = pathnameFromRequest(req);

    try {
      if (pn === '/health') {
        const healthToken = String(process.env.WALLHUB_UPDATE_HEALTH_TOKEN || '');
        if (healthToken) res.setHeader('X-WallHub-Health-Token', healthToken);
        send(res, 200, 'ok');
        return;
      }
      if (pn === '/favicon.ico') { res.writeHead(204, { 'Cache-Control': 'public, max-age=604800' }); res.end(); return; }
      if (await handleProxyRoutes(req, res, pn)) return;
      if (await handleApiRoutes(req, res, pn)) return;
      serveStatic(req, res);
    } catch (err) {
      console.error('[Unhandled]', err);
      jsonRes(res, err.statusCode || 500, {
        error: err.message,
        code: err.code || '',
        requiresSteamLogin: !!err.requiresSteamLogin,
        requiresSteamGuard: !!err.requiresSteamGuard,
      });
    }
  };
}

module.exports = {
  createAppRouter,
  pathnameFromRequest,
};
