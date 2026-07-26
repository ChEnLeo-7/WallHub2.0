'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createAppRouter } = require('./router');

function baseDeps(overrides = {}) {
  const called = [];
  const noop = async () => false;
  return {
    called,
    deps: Object.assign({
      jsonRes(res, code, body) { res.statusCode = code; res.body = body; },
      send(res, code, body) { res.statusCode = code; res.body = body; },
      virtualHostParam: '__whp_host',
      isWallhubProxyVirtualSteamPath: () => false,
      handleWallhubUrlProxy: noop,
      handleWallhubVirtualSteamProxy: noop,
      handleWallhubSteamAppRelativeAsset: noop,
      handleDebug: async () => {},
      handleServerRuntime: async () => {},
      handleServerRuntimeDiagnostics: async () => {},
      handleServerRestart: async () => {},
      handleServerShutdown: async () => {},
      handleInternalSteamResolve: async (req, res) => { called.push('internal'); res.statusCode = 200; res.body = 'internal'; },
      handleInternalSteamWebApi: async (req, res) => { called.push('internal-webapi'); res.statusCode = 200; res.body = 'webapi'; },
      handleQuery: async () => {},
      handleSteamAccessReady: async () => {},
      handleDetails: async () => {},
      handlePersonalSource: async () => {},
      handleSteamSubscribe: async () => {},
      handleSteamUnsubscribe: async () => {},
      handleSteamFavorite: async () => {},
      handleSteamUnfavorite: async () => {},
      handleSteamSubscriptionStatus: async () => {},
      handleDetailsBatch: async () => {},
      handleCommentsPage: async () => {},
      handleClientDownload: async () => {},
      handleDownload: async () => {},
      handleMpkgDownload: async () => {},
      handleMpkgPreparationStart: async () => {},
      handleMpkgPreparationStatus: async () => {},
      handleVideoPlay: async () => {},
      handleVideoStream: () => {},
      proxyRemoteVideoStream: () => {},
      handleDepotVideoStream: async () => {},
      handleDepotVideoRelease: async () => {},
      listCachedItems: async () => [],
      handleCachedVideoStream: () => {},
      handleCachedItemDelete: () => {},
      listQueueItems: async () => [],
      handleQueueAction: async () => {},
      handleSteamQrLoginStart: async () => {},
      handleSteamQrLoginStatus: async () => {},
      handleSteamQrLoginCancel: async () => {},
      handleSteamPasswordLoginStart: async () => {},
      handleSteamPasswordLoginStatus: async () => {},
      handleSteamLogin: async () => {},
      handleSteamLogout: async () => {},
      handleSteamStatus: async () => {},
      handleSteamAccessHostsFetch: async () => {},
      handleSteamAccessDiagnostics: async () => {},
      handleClientEvent: async (req, res) => { called.push('client-event'); res.statusCode = 200; },
      handleVideoCacheSettingsGet: async () => {},
      handleVideoCacheSettingsDetailsGet: async () => {},
      handleDepotStreamCacheClear: async () => {},
      handleVideoCacheSettingsPost: async () => {},
      serveStatic(req, res) { called.push('static'); res.statusCode = 404; },
    }, overrides),
  };
}

test('router dispatches internal Steam resolver before static fallback', async () => {
  const { called, deps } = baseDeps();
  const router = createAppRouter(deps);
  const res = {};

  await router({ method: 'GET', url: '/api/internal/steam/resolve?host=api.steampowered.com' }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(called, ['internal']);
});

test('router dispatches non-GET internal Steam resolver requests to protected handler', async () => {
  const { called, deps } = baseDeps({
    handleInternalSteamResolve: async (req, res) => { called.push(req.method); res.statusCode = 405; },
  });
  const router = createAppRouter(deps);
  const res = {};

  await router({ method: 'POST', url: '/api/internal/steam/resolve?host=api.steampowered.com' }, res);

  assert.equal(res.statusCode, 405);
  assert.deepEqual(called, ['POST']);
});

test('router dispatches internal Steam WebAPI broker before static fallback', async () => {
  const { called, deps } = baseDeps();
  const router = createAppRouter(deps);
  const res = {};

  await router({ method: 'POST', url: '/api/internal/steam/webapi?host=api.steampowered.com&path=%2F' }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(called, ['internal-webapi']);
});

test('router dispatches client click event reports before static fallback', async () => {
  const { called, deps } = baseDeps();
  const router = createAppRouter(deps);
  const res = {};

  await router({ method: 'POST', url: '/api/client/event' }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(called, ['client-event']);
});

test('router keeps detailed runtime diagnostics out of the lightweight runtime route', async () => {
  const { called, deps } = baseDeps({
    handleServerRuntime: async () => { called.push('runtime'); },
    handleServerRuntimeDiagnostics: async () => { called.push('diagnostics'); },
  });
  const router = createAppRouter(deps);

  await router({ method: 'GET', url: '/api/server/runtime' }, {});
  await router({ method: 'GET', url: '/api/server/runtime/diagnostics' }, {});

  assert.deepEqual(called, ['runtime', 'diagnostics']);
});

test('router defers large settings details to their dedicated endpoint', async () => {
  const { called, deps } = baseDeps({
    handleVideoCacheSettingsGet: async () => { called.push('settings'); },
    handleVideoCacheSettingsDetailsGet: async () => { called.push('settings-details'); },
  });
  const router = createAppRouter(deps);

  await router({ method: 'GET', url: '/api/video/cache/settings' }, {});
  await router({ method: 'GET', url: '/api/video/cache/settings/details' }, {});

  assert.deepEqual(called, ['settings', 'settings-details']);
});

test('router starts and polls asynchronous MPKG preparation before the download route', async () => {
  const { called, deps } = baseDeps({
    handleMpkgPreparationStart: async (_req, res, id, title) => { called.push(`start:${id}:${title}`); res.statusCode = 202; },
    handleMpkgPreparationStatus: async (_req, res, id, title) => { called.push(`status:${id}:${title}`); res.statusCode = 200; },
  });
  const router = createAppRouter(deps);

  await router({ method: 'GET', url: '/api/mpkg/prepare?id=123&title=Demo' }, {});
  await router({ method: 'GET', url: '/api/mpkg/prepare/status?id=123&title=Demo' }, {});

  assert.deepEqual(called, ['start:123:Demo', 'status:123:Demo']);
});

test('router starts and polls tracked Steam password logins before the legacy login route', async () => {
  const { called, deps } = baseDeps({
    handleSteamPasswordLoginStart: async () => { called.push('start'); },
    handleSteamPasswordLoginStatus: async () => { called.push('status'); },
    handleSteamLogin: async () => { called.push('legacy'); },
  });
  const router = createAppRouter(deps);

  await router({ method: 'POST', url: '/api/steam/login/start' }, {});
  await router({ method: 'GET', url: '/api/steam/login/status?id=session' }, {});
  await router({ method: 'POST', url: '/api/steam/login' }, {});

  assert.deepEqual(called, ['start', 'status', 'legacy']);
});

test('router dispatches remote Steam Workshop subscriptions', async () => {
  const { called, deps } = baseDeps({
    handleSteamSubscribe: async () => { called.push('subscribe'); },
  });
  const router = createAppRouter(deps);

  await router({ method: 'POST', url: '/api/steam/subscribe' }, {});

  assert.deepEqual(called, ['subscribe']);
});

test('router dispatches remote Steam Workshop unsubscriptions', async () => {
  const { called, deps } = baseDeps({
    handleSteamUnsubscribe: async () => { called.push('unsubscribe'); },
  });
  const router = createAppRouter(deps);

  await router({ method: 'POST', url: '/api/steam/unsubscribe' }, {});

  assert.deepEqual(called, ['unsubscribe']);
});

test('router dispatches remote Steam Workshop favorite actions', async () => {
  const { called, deps } = baseDeps({
    handleSteamFavorite: async () => { called.push('favorite'); },
    handleSteamUnfavorite: async () => { called.push('unfavorite'); },
  });
  const router = createAppRouter(deps);

  await router({ method: 'POST', url: '/api/steam/favorite' }, {});
  await router({ method: 'POST', url: '/api/steam/unfavorite' }, {});

  assert.deepEqual(called, ['favorite', 'unfavorite']);
});

test('router marks queue snapshots as non-cacheable', async () => {
  const { deps } = baseDeps({
    listQueueItems: async () => [{ id: 123, status: 'downloading' }],
  });
  const router = createAppRouter(deps);
  const headers = {};
  const res = { setHeader: (name, value) => { headers[name] = value; } };

  await router({ method: 'GET', url: '/api/queue' }, res);

  assert.equal(headers['Cache-Control'], 'no-store');
  assert.deepEqual(res.body, { tasks: [{ id: 123, status: 'downloading' }] });
});

test('router marks cached-library snapshots as non-cacheable and supports a manual refresh', async () => {
  let receivedOptions = null;
  const { deps } = baseDeps({
    listCachedItems: async (options) => {
      receivedOptions = options;
      return [{ id: 456, status: 'completed' }];
    },
  });
  const router = createAppRouter(deps);
  const headers = {};
  const res = { setHeader: (name, value) => { headers[name] = value; } };

  await router({ method: 'GET', url: '/api/cache/list?refresh=1' }, res);

  assert.equal(headers['Cache-Control'], 'no-store');
  assert.deepEqual(receivedOptions, { force: true });
  assert.deepEqual(res.body, { items: [{ id: 456, status: 'completed' }] });
});
