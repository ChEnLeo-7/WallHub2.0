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
      handleServerOnboardingStatus: async () => {},
      handleServerOnboardingNetworkCheck: async () => {},
      handleServerOnboardingAccountCheck: async () => {},
      handleServerOnboardingComplete: async () => {},
      handleServerUpdateStatus: async () => {},
      handleServerUpdateCheck: async () => {},
      handleServerUpdateDownload: async () => {},
      handleServerUpdateInstall: async () => {},
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
      handleDepotVideoFeedback: async () => {},
      handleDepotVideoFullCacheStart: async () => {},
      handleDepotVideoFullCacheStatus: async () => {},
      handleDepotVideoFullCacheCancel: async () => {},
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

test('health keeps the ok body and exposes the updater token only when configured', async () => {
  const previous = process.env.WALLHUB_UPDATE_HEALTH_TOKEN;
  process.env.WALLHUB_UPDATE_HEALTH_TOKEN = 'health-test-token';
  try {
    const { deps } = baseDeps({
      send(res, code, body) { res.statusCode = code; res.body = body; },
    });
    const router = createAppRouter(deps);
    const headers = {};
    const res = { setHeader(name, value) { headers[name] = value; } };
    await router({ url: '/health' }, res);
    assert.equal(res.statusCode, 200);
    assert.equal(res.body, 'ok');
    assert.equal(headers['X-WallHub-Health-Token'], 'health-test-token');
  } finally {
    if (previous === undefined) delete process.env.WALLHUB_UPDATE_HEALTH_TOKEN;
    else process.env.WALLHUB_UPDATE_HEALTH_TOKEN = previous;
  }
});

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

test('router dispatches proxy routes before API groups and static fallback', async () => {
  const { called, deps } = baseDeps({
    isWallhubProxyVirtualSteamPath: () => true,
    handleWallhubVirtualSteamProxy: async () => { called.push('proxy'); return true; },
    handleDebug: async () => { called.push('debug'); },
  });
  const router = createAppRouter(deps);

  await router({ method: 'GET', url: '/api/debug' }, {});

  assert.deepEqual(called, ['proxy']);
});

test('router preserves static fallback for unmatched routes and methods', async () => {
  const { called, deps } = baseDeps();
  const router = createAppRouter(deps);

  await router({ method: 'POST', url: '/api/server/runtime' }, {});

  assert.deepEqual(called, ['static']);
});

test('router preserves handler error status and Steam metadata', async () => {
  const failure = Object.assign(new Error('Steam Guard required'), {
    statusCode: 401,
    code: 'STEAM_GUARD_REQUIRED',
    requiresSteamLogin: true,
    requiresSteamGuard: true,
  });
  const { called, deps } = baseDeps({
    handleQuery: async () => { throw failure; },
  });
  const router = createAppRouter(deps);
  const originalConsoleError = console.error;
  console.error = () => {};

  try {
    const res = {};
    await router({ method: 'POST', url: '/api/steam/query' }, res);
    assert.equal(res.statusCode, 401);
    assert.deepEqual(res.body, {
      error: 'Steam Guard required',
      code: 'STEAM_GUARD_REQUIRED',
      requiresSteamLogin: true,
      requiresSteamGuard: true,
    });
    assert.deepEqual(called, []);
  } finally {
    console.error = originalConsoleError;
  }
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

test('router dispatches bounded depot playback feedback by token', async () => {
  const { called, deps } = baseDeps({
    handleDepotVideoFeedback: async (_req, _res, token) => { called.push(`feedback:${token}`); },
  });
  const router = createAppRouter(deps);

  await router({ method: 'POST', url: '/api/video/depot/feedback?token=stream-token' }, {});
  assert.deepEqual(called, ['feedback:stream-token']);

  const missing = {};
  await router({ method: 'POST', url: '/api/video/depot/feedback' }, missing);
  assert.equal(missing.statusCode, 400);
  assert.deepEqual(missing.body, { error: 'Missing token' });
});

test('router dispatches depot full-cache lifecycle by token', async () => {
  const { called, deps } = baseDeps({
    handleDepotVideoFullCacheStart: async () => { called.push('start'); },
    handleDepotVideoFullCacheStatus: async () => { called.push('status'); },
    handleDepotVideoFullCacheCancel: async () => { called.push('cancel'); },
  });
  const router = createAppRouter(deps);

  await router({ method: 'POST', url: '/api/video/depot/cache?token=stream-token' }, {});
  await router({ method: 'GET', url: '/api/video/depot/cache?token=stream-token' }, {});
  await router({ method: 'POST', url: '/api/video/depot/cache/cancel?token=stream-token' }, {});
  assert.deepEqual(called, ['start', 'status', 'cancel']);

  const missing = {};
  await router({ method: 'GET', url: '/api/video/depot/cache' }, missing);
  assert.equal(missing.statusCode, 400);
});

test('router dispatches startup onboarding status and actions by method', async () => {
  const { called, deps } = baseDeps({
    handleServerOnboardingStatus: async () => { called.push('status'); },
    handleServerOnboardingNetworkCheck: async () => { called.push('network'); },
    handleServerOnboardingAccountCheck: async () => { called.push('account'); },
    handleServerOnboardingComplete: async () => { called.push('complete'); },
  });
  const router = createAppRouter(deps);

  await router({ method: 'GET', url: '/api/server/onboarding' }, {});
  await router({ method: 'POST', url: '/api/server/onboarding/network-check' }, {});
  await router({ method: 'POST', url: '/api/server/onboarding/account-check' }, {});
  await router({ method: 'POST', url: '/api/server/onboarding/complete' }, {});

  assert.deepEqual(called, ['status', 'network', 'account', 'complete']);
});

test('router dispatches update status and actions by method', async () => {
  const { called, deps } = baseDeps({
    handleServerUpdateStatus: async () => { called.push('status'); },
    handleServerUpdateCheck: async () => { called.push('check'); },
    handleServerUpdateDownload: async () => { called.push('download'); },
    handleServerUpdateInstall: async () => { called.push('install'); },
  });
  const router = createAppRouter(deps);

  await router({ method: 'GET', url: '/api/server/update' }, {});
  await router({ method: 'POST', url: '/api/server/update/check' }, {});
  await router({ method: 'POST', url: '/api/server/update/download' }, {});
  await router({ method: 'POST', url: '/api/server/update/install' }, {});

  assert.deepEqual(called, ['status', 'check', 'download', 'install']);
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
