'use strict';

const { createProxyRoutes } = require('./routes/proxy');
const { createServerRoutes } = require('./routes/server');
const { createWorkshopRoutes } = require('./routes/workshop');
const { createDownloadVideoRoutes } = require('./routes/downloadVideo');
const { createQueueSettingsRoutes } = require('./routes/queueSettings');
const { pathnameFromRequest } = require('./routes/request');

function createAppRouter(deps) {
  const { jsonRes, send, serveStatic } = deps;
  const routeGroups = [
    createProxyRoutes(deps),
    createServerRoutes(deps),
    createWorkshopRoutes(deps),
    createDownloadVideoRoutes(deps),
    createQueueSettingsRoutes(deps),
  ];

  return async function handleRequest(req, res) {
    const pn = pathnameFromRequest(req);

    try {
      if (pn === '/health') {
        const healthToken = String(process.env.WALLHUB_UPDATE_HEALTH_TOKEN || '');
        if (healthToken) res.setHeader('X-WallHub-Health-Token', healthToken);
        send(res, 200, 'ok');
        return;
      }
      if (pn === '/favicon.ico') {
        res.writeHead(204, { 'Cache-Control': 'public, max-age=604800' });
        res.end();
        return;
      }
      for (const handleRoutes of routeGroups) {
        if (await handleRoutes(req, res, pn)) return;
      }
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
