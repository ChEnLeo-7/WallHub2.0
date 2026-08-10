'use strict';

const { methodIs, queryFromRequest } = require('./request');

function createWorkshopRoutes(deps) {
  const {
    jsonRes,
    handleSteamAccessReady,
    handleClientEvent,
    handleQuery,
    handleDetailsBatch,
    handleDetails,
    handlePersonalSource,
    handleSteamSubscriptionStatus,
    handleSteamSubscribe,
    handleSteamUnsubscribe,
    handleSteamFavorite,
    handleSteamUnfavorite,
    handleCommentsPage,
  } = deps;

  return async function handleWorkshopRoutes(req, res, pn) {
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

    if (pn === '/api/steam/subscribe' && methodIs(req, 'POST')) { await handleSteamSubscribe(req, res); return true; }
    if (pn === '/api/steam/unsubscribe' && methodIs(req, 'POST')) { await handleSteamUnsubscribe(req, res); return true; }
    if (pn === '/api/steam/favorite' && methodIs(req, 'POST')) { await handleSteamFavorite(req, res); return true; }
    if (pn === '/api/steam/unfavorite' && methodIs(req, 'POST')) { await handleSteamUnfavorite(req, res); return true; }

    if (pn === '/api/steam/comments' && methodIs(req, 'GET')) {
      const q = queryFromRequest(req);
      const id = q.get('id');
      if (!id) return jsonRes(res, 400, { error: 'Missing id' }), true;
      await handleCommentsPage(res, id, q.get('start') || 0, q.get('count') || 50, q.get('owner') || q.get('ownerId') || '');
      return true;
    }

    return false;
  };
}

module.exports = { createWorkshopRoutes };
