'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { createWorkshopHandlers } = require('./workshop');

function createResponse() {
  const res = new EventEmitter();
  res.statusCode = 0;
  res.body = null;
  return res;
}

function createHandlers(overrides = {}) {
  return createWorkshopHandlers(Object.assign({
    jsonRes(res, statusCode, value) {
      res.statusCode = statusCode;
      res.body = value;
    },
    readBody: async req => req.body,
    get: async () => Buffer.from('<div class="workshopItem" data-publishedfileid="123456"></div>'),
    post: async () => Buffer.from(JSON.stringify({ response: {
      publishedfiledetails: [{ result: 1, publishedfileid: '123456', title: 'Cookie item', tags: [] }],
    } })),
    doRequest: async () => Buffer.alloc(0),
    userAgent: 'WallHub-Test',
    steamPrefCookie: '',
    isAndroidHostLikeEnv: () => false,
    getSteamApiKey: () => '',
    getSteamDataSource: () => 'community',
    getSteamWebApiBaseUrl: () => 'https://api.steampowered.com',
    querySteamKitUserFiles: async () => ({}),
    querySteamKitWorkshop: async () => ({}),
    steamAccessGatewayEnabled: () => false,
    getSteamAccessMode: () => 'resolver',
    nsfwEnabled: () => true,
    isSteamAccessGatewayWarmingUp: () => false,
    ensureSteamAccessGatewayReady: async () => ({}),
    upstreamCookie: () => '',
    resolveSteamKitCommunityCookie: async () => '',
    steamKitPersistentLoginIsUsable: () => false,
    effectiveDownloaderMode: () => 'steamkit',
    cachedSteamLoginUsername: () => '',
    logger: { log() {}, info() {}, warn() {}, error() {} },
  }, overrides));
}

function queryRequest() {
  return {
    body: JSON.stringify({ params: { appid: 431960, page: 1, numperpage: 1 } }),
    headers: { cookie: '' },
  };
}

test('Community public queries resolve and send the signed-in Steam Web session', async () => {
  const requests = [];
  let cookieResolutions = 0;
  const cookie = 'steamLoginSecure=76561198000000001%7C%7Ctoken; sessionid=valid';
  const handlers = createHandlers({
    get: async (url, headers) => {
      requests.push({ url, headers });
      return Buffer.from('<div class="workshopItem" data-publishedfileid="123456"></div>');
    },
    resolveSteamKitCommunityCookie: async () => {
      cookieResolutions += 1;
      return cookie;
    },
    steamKitPersistentLoginIsUsable: () => true,
    upstreamCookie: () => 'steamLoginSecure=76561198000000002%7C%7Cproxy; sessionid=proxy',
  });
  const res = createResponse();

  await handlers.handleQuery(queryRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(cookieResolutions, 1);
  assert.equal(requests[0].headers.Cookie, cookie);
});

test('Community public queries use the proxy session when no SteamKit Web cookie exists', async () => {
  const requests = [];
  const proxyCookie = 'steamLoginSecure=76561198000000002%7C%7Cproxy; sessionid=proxy';
  const handlers = createHandlers({
    get: async (url, headers) => {
      requests.push({ url, headers });
      return Buffer.from('<div class="workshopItem" data-publishedfileid="123456"></div>');
    },
    upstreamCookie: () => proxyCookie,
  });
  const res = createResponse();

  await handlers.handleQuery(queryRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.Cookie, proxyCookie);
});

test('Community public queries retry anonymously after a stale proxy session cookie', async () => {
  const requests = [];
  const proxyCookie = 'steamLoginSecure=76561198000000002%7C%7Cstale; sessionid=stale';
  const handlers = createHandlers({
    get: async (url, headers) => {
      requests.push({ url, headers });
      if (headers.Cookie) return Buffer.from('<script>window.UserConfig={"logged_in":false}</script>');
      return Buffer.from('<div class="workshopItem" data-publishedfileid="123456"></div>');
    },
    upstreamCookie: () => proxyCookie,
  });

  const first = createResponse();
  await handlers.handleQuery(queryRequest(), first);

  assert.equal(first.statusCode, 200);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers.Cookie, proxyCookie);
  assert.equal(Object.hasOwn(requests[1].headers, 'Cookie'), false);

  const second = createResponse();
  const refreshRequest = queryRequest();
  refreshRequest.body = JSON.stringify({ params: { appid: 431960, page: 1, numperpage: 1, _refresh: 1 } });
  await handlers.handleQuery(refreshRequest, second);

  assert.equal(second.statusCode, 200);
  assert.equal(requests.length, 3);
  assert.equal(Object.hasOwn(requests[2].headers, 'Cookie'), false);
});

test('Community personal queries never fall back to anonymous after a stale proxy session cookie', async () => {
  const proxyCookie = 'steamLoginSecure=76561198000000002%7C%7Cstale; sessionid=stale';
  let requests = 0;
  const handlers = createHandlers({
    get: async () => {
      requests += 1;
      return Buffer.from('<script>window.UserConfig={"logged_in":false}</script>');
    },
    upstreamCookie: () => proxyCookie,
  });
  const req = queryRequest();
  req.body = JSON.stringify({ params: {
    appid: 431960,
    page: 1,
    numperpage: 1,
    path: 'myfiles',
    browsefilter: 'myfavorites',
  } });
  const res = createResponse();

  await handlers.handleQuery(req, res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'STEAM_WEB_LOGIN_REQUIRED');
  assert.equal(requests, 1);
});

test('Community public queries stay anonymous only when no login session exists', async () => {
  const requests = [];
  let readinessChecks = 0;
  const handlers = createHandlers({
    get: async (url, headers) => {
      requests.push({ url, headers });
      return Buffer.from('<div class="workshopItem" data-publishedfileid="123456"></div>');
    },
    steamAccessGatewayEnabled: () => true,
    ensureSteamAccessGatewayReady: async () => {
      readinessChecks += 1;
    },
  });
  const res = createResponse();

  await handlers.handleQuery(queryRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(Object.hasOwn(requests[0].headers, 'Cookie'), false);
  assert.equal(readinessChecks, 0);
});

test('Community public queries reject a logged-in SteamKit account without a Web session cookie', async () => {
  const handlers = createHandlers({ steamKitPersistentLoginIsUsable: () => true });
  const res = createResponse();

  await handlers.handleQuery(queryRequest(), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'STEAM_WEB_LOGIN_REQUIRED');
  assert.equal(res.body.requiresSteamLogin, true);
});

test('Steam CM query returns a structured re-login response for an expired remembered session', async () => {
  const handlers = createHandlers({
    getSteamDataSource: () => 'cm',
    steamKitPersistentLoginIsUsable: () => true,
    cachedSteamLoginUsername: () => 'tester',
    querySteamKitWorkshop: async () => {
      const error = new Error('Steam 登录已失效，请重新登录后再使用 Steam CM WebSocket。');
      error.code = 'STEAM_CM_LOGIN_REQUIRED';
      error.statusCode = 401;
      error.requiresSteamLogin = true;
      throw error;
    },
  });
  const res = createResponse();

  await handlers.handleQuery(queryRequest(), res);

  assert.equal(res.statusCode, 401);
  assert.equal(res.body.code, 'STEAM_CM_LOGIN_REQUIRED');
  assert.equal(res.body.requiresSteamLogin, true);
  assert.match(res.body.error, /重新登录/);
});

test('Steam CM query timeout is retryable and does not request a new login', async () => {
  const handlers = createHandlers({
    getSteamDataSource: () => 'cm',
    steamKitPersistentLoginIsUsable: () => true,
    cachedSteamLoginUsername: () => 'tester',
    querySteamKitWorkshop: async () => {
      const error = new Error('Steam CM Workshop query timed out');
      error.code = 'STEAM_CM_QUERY_TIMEOUT';
      error.statusCode = 504;
      error.requiresSteamLogin = false;
      throw error;
    },
  });
  const res = createResponse();

  await handlers.handleQuery(queryRequest(), res);

  assert.equal(res.statusCode, 504);
  assert.equal(res.body.code, 'STEAM_CM_QUERY_TIMEOUT');
  assert.equal(res.body.requiresSteamLogin, false);
});

test('successful Workshop queries emit one safe info summary', async () => {
  const infoLogs = [];
  const handlers = createHandlers({
    logger: {
      log() {},
      info(message) { infoLogs.push(message); },
      warn() {},
      error() {},
    },
  });
  const res = createResponse();

  await handlers.handleQuery(queryRequest(), res);

  assert.equal(res.statusCode, 200);
  assert.equal(infoLogs.length, 1);
  assert.match(infoLogs[0], /^\[Workshop\] query completed source=community-html page=1 items=1 total=1 fallback=false durationMs=\d+$/);
  assert.doesNotMatch(infoLogs[0], /Cookie item|steamLoginSecure|steamcommunity\.com/);
});

test('successful Workshop details emit one safe info summary', async () => {
  const infoLogs = [];
  const handlers = createHandlers({
    logger: {
      log() {},
      info(message) { infoLogs.push(message); },
      warn() {},
      error() {},
    },
  });
  const res = createResponse();

  await handlers.handleDetails(res, '123456');

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.publishedfileid, '123456');
  assert.equal(infoLogs.length, 1);
  assert.match(infoLogs[0], /^\[Workshop\] detail completed id=123456 comments=0 preview=false durationMs=\d+$/);
  assert.doesNotMatch(infoLogs[0], /Cookie item|steamcommunity\.com/);
});
