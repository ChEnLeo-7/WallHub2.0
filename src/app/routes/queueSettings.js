'use strict';

const { methodIs, queryFromRequest } = require('./request');

function createQueueSettingsRoutes(deps) {
  const {
    jsonRes,
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
    handleVideoCacheSettingsDetailsGet,
    handleVideoCacheSettingsGet,
    handleDepotStreamCacheClear,
    handleVideoCacheSettingsPost,
  } = deps;

  return async function handleQueueSettingsRoutes(req, res, pn) {
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
  };
}

module.exports = { createQueueSettingsRoutes };
