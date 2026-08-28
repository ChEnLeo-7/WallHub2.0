'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createDownloadVideoHandlers } = require('./downloadVideo');
const { createRuntimeHandlers } = require('./runtime');
const { createHttpRequestTracker, createServerControlHandlers } = require('./serverControl');
const { createSettingsHandlers } = require('./settings');
const { createSteamProxyHandlers } = require('./steamProxy');
const { createSteamSessionHandlers } = require('./steamSession');
const { createUpdateHandlers } = require('./update');
const { createWorkshopHandlers } = require('./workshop');

function jsonRes(res, statusCode, value) {
  res.statusCode = statusCode;
  res.body = value;
}

function createResponse() {
  const res = new EventEmitter();
  res.statusCode = 0;
  res.body = null;
  res.headers = {};
  res.setHeader = (name, value) => { res.headers[name] = value; };
  return res;
}

test('update handlers preserve mutation rejection and update status formats', async () => {
  const calls = [];
  const updateService = {
    snapshot: () => ({ status: 'idle', version: '2.0.0' }),
    checkNow: async options => { calls.push(options); return { status: 'available' }; },
    startDownload: () => ({ status: 'downloading' }),
    installDownloaded() {
      const error = new Error('busy');
      error.code = 'UPDATE_BUSY';
      throw error;
    },
  };
  const denied = createUpdateHandlers({ jsonRes, isMutationAllowed: () => false, updateService });
  const deniedRes = createResponse();
  await denied.handleServerUpdateCheck({ url: '/api/server/update/check' }, deniedRes);
  assert.equal(deniedRes.statusCode, 403);
  assert.equal(deniedRes.body.code, 'UPDATE_ORIGIN_DENIED');

  const handlers = createUpdateHandlers({ jsonRes, isMutationAllowed: () => true, updateService });
  const statusRes = createResponse();
  await handlers.handleServerUpdateStatus({}, statusRes);
  assert.deepEqual(statusRes.body, { status: 'idle', version: '2.0.0' });

  const checkRes = createResponse();
  await handlers.handleServerUpdateCheck({ url: '/api/server/update/check?cached=1' }, checkRes);
  assert.equal(checkRes.statusCode, 200);
  assert.deepEqual(calls, [{ maxAgeMs: 5 * 60 * 1000 }]);

  const installRes = createResponse();
  await handlers.handleServerUpdateInstall({}, installRes);
  assert.equal(installRes.statusCode, 409);
  assert.equal(installRes.body.code, 'UPDATE_BUSY');
});

test('request tracker preserves host and pending-update guards and releases active requests', async () => {
  const tracker = createHttpRequestTracker();
  const deniedHandler = tracker.createHandler({
    jsonRes,
    isAllowedHost: () => false,
    getUpdateInstallPending: () => false,
    routeHttpRequest: async () => {},
  });
  const deniedRes = createResponse();
  await deniedHandler({ method: 'GET', url: '/', headers: { host: 'example.com' } }, deniedRes);
  assert.equal(deniedRes.statusCode, 421);
  assert.equal(deniedRes.body.code, 'WALLHUB_HOST_DENIED');

  const pendingHandler = tracker.createHandler({
    jsonRes,
    isAllowedHost: () => true,
    getUpdateInstallPending: () => true,
    routeHttpRequest: async () => {},
  });
  const pendingRes = createResponse();
  await pendingHandler({ method: 'GET', url: '/api/steam/status', headers: {} }, pendingRes);
  assert.equal(pendingRes.statusCode, 503);
  assert.equal(pendingRes.body.code, 'UPDATE_INSTALL_PENDING');

  let finishRoute;
  const trackedHandler = tracker.createHandler({
    jsonRes,
    isAllowedHost: () => true,
    getUpdateInstallPending: () => false,
    routeHttpRequest: () => new Promise(resolve => { finishRoute = resolve; }),
  });
  const trackedRes = createResponse();
  const request = trackedHandler({ method: 'GET', url: '/api/steam/status', headers: {} }, trackedRes);
  assert.equal(tracker.activeCount(), 1);
  trackedRes.emit('finish');
  assert.equal(tracker.activeCount(), 0);
  finishRoute();
  await request;
});

test('server control handlers keep restart and shutdown response fields', async () => {
  const handlers = createServerControlHandlers({
    jsonRes,
    getRestartServer: () => async () => ({ mode: 'exit', logPath: 'wallhub.log' }),
    getShutdownServer: () => async () => ({ mode: 'shutdown' }),
  });
  const restartRes = createResponse();
  await handlers.handleServerRestart({}, restartRes);
  assert.deepEqual(restartRes.body, {
    success: true,
    message: '服务端正在退出，请由 Docker 重启策略拉起',
    mode: 'exit',
    logPath: 'wallhub.log',
  });
  const shutdownRes = createResponse();
  await handlers.handleServerShutdown({}, shutdownRes);
  assert.deepEqual(shutdownRes.body, {
    success: true,
    message: '服务端正在关闭',
    mode: 'shutdown',
  });
});

test('runtime handlers preserve compact runtime and diagnostic snapshots', async () => {
  const updateService = { snapshot: () => ({ status: 'idle', updatedAt: 17 }) };
  const handlers = createRuntimeHandlers({
    jsonRes,
    send() {},
    get: async () => Buffer.from(''),
    isDockerLikeEnv: () => false,
    isTermuxLikeEnv: () => true,
    runtimeSetupSnapshot: () => ({ mode: 'steamkit', updatedAt: 11, runnerDir: 'runner', accountDir: 'account' }),
    steamCdnStatusSnapshot: () => ({ currentHost: 'cdn', currentVHost: '', currentPort: 443, source: 'direct', mode: 'steamkit', strategy: 'auto', updatedAt: 12 }),
    steamAccessRuntimeSnapshot: () => ({ enabled: true, updatedAt: 13 }),
    steamAccessDiagnosticSnapshot: () => ({ generatedAt: 14, routes: [] }),
    steamKitDepotStreamingEnabled: () => true,
    getDepotStreamWorkerCount: () => 2,
    getDepotStreamDiagnostics: () => ({ readThrough: true, readWindowBytes: 524288, sessions: [] }),
    getDepotStreamCacheMaxMb: () => 512,
    updateService,
    platform: 'linux',
    arch: 'x64',
    supervised: true,
    version: '2.0.0',
    getDownloaderMode: () => 'steamkit',
    nsfwEnabled: false,
    getDownloadsDir: () => 'downloads',
    resolveDepotDownloaderPath: () => 'DepotDownloader',
    depotStreamCacheDir: 'cache',
    depotStreamFirstRangeBytes: 1024,
    depotStreamMaxRangeBytes: 2048,
    ensureSteamAccessGatewayReady: async () => ({ ready: true }),
    steamAccessGatewayEnabled: () => true,
  });
  const runtimeRes = createResponse();
  await handlers.handleServerRuntime({}, runtimeRes);
  assert.equal(runtimeRes.statusCode, 200);
  assert.equal(runtimeRes.body.revision, '11:12:13:2:1:17');
  assert.equal(runtimeRes.body.canShutdown, true);
  assert.equal(runtimeRes.body.depotStream.workers, 2);
  assert.equal(runtimeRes.body.downloadsDir, 'downloads');

  const diagnosticsRes = createResponse();
  await handlers.handleServerRuntimeDiagnostics({}, diagnosticsRes);
  assert.equal(diagnosticsRes.body.revision, '11:12:14');
  assert.deepEqual(diagnosticsRes.body.depotStream, {
    enabled: true,
    workers: 2,
    cacheDir: 'cache',
    cacheMaxMb: 512,
    firstRangeBytes: 1024,
    rangeBytes: 2048,
    readThrough: true,
    readWindowBytes: 524288,
    sessions: [],
  });
});

test('settings handlers preserve origin guards and deferred Hosts detail format', async () => {
  const base = {
    jsonRes,
    readBody: async req => req.body || '',
    getSettings: () => ({ wallhubSteamAccessHosts: '1.2.3.4 steamcommunity.com' }),
    hostsUpdater: { fetchAndMaybeSave: async () => ({ success: true }) },
  };
  let mutationChecks = 0;
  const denied = createSettingsHandlers({
    ...base,
    isReadAllowed: () => false,
    isMutationAllowed: () => { mutationChecks += 1; return true; },
  });
  const deniedRes = createResponse();
  await denied.handleVideoCacheSettingsGet({}, deniedRes);
  assert.equal(deniedRes.statusCode, 403);
  assert.equal(deniedRes.body.code, 'SETTINGS_ORIGIN_DENIED');
  assert.equal(mutationChecks, 0);

  const handlers = createSettingsHandlers({ ...base, isReadAllowed: () => true, isMutationAllowed: () => true });
  const detailsRes = createResponse();
  await handlers.handleVideoCacheSettingsDetailsGet({}, detailsRes);
  assert.deepEqual(detailsRes.body, {
    wallhubSteamAccessHosts: '1.2.3.4 steamcommunity.com',
    wallhubSteamAccessHostsDeferred: false,
  });
  const hostsRes = createResponse();
  await handlers.handleSteamAccessHostsFetch({ body: JSON.stringify({ url: 'https://example.com/hosts' }) }, hostsRes);
  assert.equal(hostsRes.statusCode, 400);
  assert.equal(hostsRes.body.success, false);
});

test('settings POST continues to use mutation trust independently', async () => {
  let readChecks = 0;
  const handlers = createSettingsHandlers({
    jsonRes,
    readBody: async req => req.body || '',
    isReadAllowed: () => { readChecks += 1; return true; },
    isMutationAllowed: () => false,
  });
  const res = createResponse();

  await handlers.handleVideoCacheSettingsPost({ body: '{}' }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'SETTINGS_ORIGIN_DENIED');
  assert.equal(readChecks, 0);
});

test('stream cache clear rejects cross-site mutation requests', async () => {
  let clears = 0;
  const handlers = createSettingsHandlers({
    jsonRes,
    isMutationAllowed: () => false,
    clearDepotStreamCacheNow: () => { clears += 1; return { success: true }; },
  });
  const res = createResponse();

  await handlers.handleDepotStreamCacheClear({}, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'SETTINGS_ORIGIN_DENIED');
  assert.equal(clears, 0);
});

test('stream cache clear allows trusted mutation requests', async () => {
  const handlers = createSettingsHandlers({
    jsonRes,
    isMutationAllowed: () => true,
    clearDepotStreamCacheNow: () => ({ success: true, removedBytes: 42, remainingBytes: 0 }),
  });
  const res = createResponse();

  await handlers.handleDepotStreamCacheClear({}, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body, { success: true, removedBytes: 42, remainingBytes: 0 });
});

test('settings changes restart the SteamKit query bridge when SteamAccess routing changes', async () => {
  let settings = { wallhubSteamAccessEnhance: true };
  const stopped = [];
  const handlers = createSettingsHandlers({
    jsonRes,
    readBody: async req => req.body || '',
    isMutationAllowed: () => true,
    getSettings: () => settings,
    setSettings: value => { settings = value; },
    getRuntimeSettings: () => ({
      setState() {},
      applyPatch: () => ({
        settings: { wallhubSteamAccessEnhance: false },
        steamAccessEnhanceChanged: true,
        steamAccessDirectWebApiChanged: false,
        steamAccessResolverChanged: false,
        steamAccessHostsChanged: false,
        steamApiKeyChanged: false,
        steamDataSourceChanged: false,
      }),
      steamAccessStaticCdnEnhanceEnabled: () => false,
    }),
    saveSettings() {},
    settingsSnapshot: () => ({ success: true }),
    steamAccessGateway: { clear() {} },
    clearWorkshopCaches() {},
    updateService: { scheduleSoon() {} },
    hostsUpdater: { schedule() {} },
    warmupSteamAccessGatewayCore() {},
    warmupSteamAccessGatewayCdnBackground: async () => {},
    logSteamAccessResolvedRoutes: async () => {},
    cleanupDepotStreamCache: async () => {},
    stopAllDepotStreamWorkers() {},
    stopSteamKitQueryBridge: reason => stopped.push(reason),
    warmupDepotStreamDownloader() {},
    triggerQueue() {},
    getSteamCdnRouteStrategy: () => 'nearest',
    getSteamKitMaxDownloads: () => 1,
  });
  const res = createResponse();

  await handlers.handleVideoCacheSettingsPost({ body: JSON.stringify({ wallhubSteamAccessEnhance: false }) }, res);

  assert.equal(res.statusCode, 200);
  assert.deepEqual(stopped, ['steam-access-settings-changed']);
});

test('steam session handlers preserve pending-login and ownership status fields', async () => {
  const credentials = {
    username: '',
    password: '',
    steamGuardCode: '',
    isPersistent: false,
    pendingPersistentUsername: 'alice',
  };
  const handlers = createSteamSessionHandlers({
    jsonRes,
    readBody: async req => req.body || '',
    credentials,
    getOwnership: () => ({ username: 'alice', status: 'owned' }),
    setOwnership() {},
    getSettings: () => ({}),
    saveSettings() {},
    verifyLogin: async () => {},
    startPasswordSession: () => ({}),
    getPasswordSession: () => null,
    startQrSession: async () => ({}),
    getQrSession: () => null,
    cancelQrSession: () => false,
    normalizeError: error => error,
    stopQueryBridge() {},
    clearAuth() {},
    getRuntimeSetupStatus: () => 'checking',
    effectiveDownloaderMode: () => 'steamkit',
    getDownloaderMode: () => 'steamkit',
    logger: { log() {} },
  });
  const res = createResponse();
  await handlers.handleSteamStatus({}, res);
  assert.deepEqual(res.body, {
    loggedIn: true,
    username: 'alice',
    isPersistent: false,
    pendingValidation: true,
    pendingUsername: 'alice',
    wallpaperEngineAccess: 'owned',
    backend: 'steamkit',
    requestedBackend: 'steamkit',
  });
});

test('Steam proxy handlers preserve direct fallback except for configured Steam proxy routes', () => {
  function createHandlers(getSettings, getSteamCdnRouteStrategy) {
    return createSteamProxyHandlers({
      userAgent: 'WallHub-Test',
      steamPrefCookie: '',
      virtualHostParam: '__whp_host',
      cache: { dir: 'unused-cache', version: 1 },
      env: { WALLHUB_PROXY: 'http://proxy.local:8080' },
      platform: 'linux',
      logger: { log() {}, warn() {}, error() {} },
      jsonRes,
      readBodyBuffer: async () => Buffer.alloc(0),
      stripProxyEnv: value => value,
      contentTypeFromUrl: () => 'application/octet-stream',
      isAndroidHostLikeEnv: () => false,
      isSteamHost: host => host === 'steamcommunity.com',
      isSteamStaticCdnHost: () => false,
      isSteamBroadcastResource: () => false,
      isSteamCommunityHost: host => host === 'steamcommunity.com',
      isSteamAccessGatewayHost: () => false,
      getSettings,
      getSteamCdnRouteStrategy,
      steamAccessDirectWebApiEnabled: () => false,
      steamAccessGatewayEnabled: () => false,
      shouldUseSteamAccessGateway: () => false,
      requestBySteamAccessGateway: async () => Buffer.alloc(0),
      requestStreamBySteamAccessGateway: async () => ({}),
      chooseSteamAccessRoute: async () => null,
      removeSteamAccessCachedIp() {},
      steamAccessPolicyForHost: () => ({}),
    });
  }

  const explicit = createHandlers(() => ({}), () => 'auto');
  assert.deepEqual(explicit.getProxyCandidates('https:', 'example.com').map(proxy => proxy && proxy.hostname), [
    'proxy.local',
    null,
  ]);

  const configured = createHandlers(
    () => ({ steamHttpProxyUrl: 'http://steam-proxy.local:3128' }),
    () => 'proxy',
  );
  assert.deepEqual(configured.getProxyCandidates('https:', 'steamcommunity.com').map(proxy => proxy && proxy.hostname), [
    'proxy.local',
    'steam-proxy.local',
  ]);
});

test('workshop handlers keep batch detail sanitization and item response format', async () => {
  const handlers = createWorkshopHandlers({
    jsonRes,
    readBody: async req => req.body || '',
    get: async () => Buffer.from(''),
    post: async () => Buffer.from(JSON.stringify({
      response: {
        publishedfiledetails: [
          { result: 1, publishedfileid: '123456', title: 'First', tags: [] },
          { result: 1, publishedfileid: '789012', title: 'Second', tags: [] },
        ],
      },
    })),
    doRequest: async () => Buffer.from(''),
    userAgent: 'WallHub-Test',
    steamPrefCookie: '',
    isAndroidHostLikeEnv: () => false,
    getSteamApiKey: () => '',
    getSteamWebApiBaseUrl: () => 'https://api.steampowered.com',
    querySteamKitUserFiles: async () => ({}),
    steamAccessGatewayEnabled: () => false,
    getSteamAccessMode: () => 'resolver',
    nsfwEnabled: () => false,
    isSteamAccessGatewayWarmingUp: () => false,
    ensureSteamAccessGatewayReady: async () => ({}),
    upstreamCookie: () => '',
    resolveSteamKitCommunityCookie: async () => '',
    steamKitPersistentLoginIsUsable: () => false,
    effectiveDownloaderMode: () => 'steamkit',
    cachedSteamLoginUsername: () => '',
    logger: { log() {}, warn() {}, error() {} },
  });
  const res = createResponse();
  await handlers.handleDetailsBatch({
    body: JSON.stringify({ ids: ['123456x', '789012', '123456'] }),
  }, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.items.map(item => [item.publishedfileid, item.title]), [
    ['123456', 'First'],
    ['789012', 'Second'],
  ]);
});

test('download and video handlers delegate without changing arguments or return values', async () => {
  const calls = [];
  const handlers = createDownloadVideoHandlers({
    getVideoController: () => ({
      handleVideoPlay: (...args) => { calls.push(['video', ...args]); return 'video-result'; },
    }),
    getCacheItemsService: () => ({
      handleCachedItemDelete: (...args) => { calls.push(['cache', ...args]); return 'cache-result'; },
    }),
    getDownloadsController: () => ({
      handleQueueAction: (...args) => { calls.push(['queue', ...args]); return 'queue-result'; },
    }),
    readBody: async req => req.body || '',
  });
  assert.equal(handlers.handleVideoPlay('req', 'res', '123'), 'video-result');
  assert.equal(handlers.handleCachedItemDelete('res', 'key'), 'cache-result');
  assert.equal(handlers.handleQueueAction('req', 'res'), 'queue-result');
  assert.deepEqual(calls, [
    ['video', 'req', 'res', '123'],
    ['cache', 'res', 'key'],
    ['queue', 'req', 'res'],
  ]);
});

test('depot playback feedback parses a bounded JSON body before delegation', async () => {
  const calls = [];
  const handlers = createDownloadVideoHandlers({
    getVideoController: () => ({
      handleDepotVideoFeedback: (...args) => { calls.push(args); return 'feedback-result'; },
    }),
    getCacheItemsService: () => ({}),
    getDownloadsController: () => ({}),
    readBody: async (req, limit) => {
      assert.equal(limit, 4096);
      return req.body;
    },
  });
  const req = { body: JSON.stringify({ state: 'playing', sequence: 1 }) };
  const res = {};

  assert.equal(await handlers.handleDepotVideoFeedback(req, res, 'token'), 'feedback-result');
  assert.deepEqual(calls, [[req, res, 'token', { state: 'playing', sequence: 1 }]]);
  await assert.rejects(
    handlers.handleDepotVideoFeedback({ body: '{' }, res, 'token'),
    error => error.statusCode === 400 && /Invalid playback feedback JSON/.test(error.message)
  );
});
