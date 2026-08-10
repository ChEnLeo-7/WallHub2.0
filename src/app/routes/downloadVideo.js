'use strict';

const { methodIn, methodIs, queryFromRequest } = require('./request');

function createDownloadVideoRoutes(deps) {
  const {
    jsonRes,
    handleClientDownload,
    handleDownload,
    handleMpkgPreparationStatus,
    handleMpkgPreparationStart,
    handleMpkgDownload,
    handleVideoPlay,
    handleVideoStream,
    proxyRemoteVideoStream,
    handleDepotVideoStream,
    handleDepotVideoRelease,
  } = deps;

  return async function handleDownloadVideoRoutes(req, res, pn) {
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

    return false;
  };
}

module.exports = { createDownloadVideoRoutes };
