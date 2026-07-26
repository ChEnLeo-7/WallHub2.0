'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cookieValue,
  parseSubscriptionResponse,
  parseSubscriptionStatus,
  parseFavoriteStatus,
  createWorkshopSubscriptionService,
} = require('./subscription');

test('cookieValue reads and decodes the Steam session id', () => {
  assert.equal(cookieValue('steamLoginSecure=secure; sessionid=abc%2Fdef', 'sessionid'), 'abc/def');
});

test('parseSubscriptionResponse accepts the Steam success payload', () => {
  assert.deepEqual(parseSubscriptionResponse(Buffer.from('{"success":1}')), { success: 1 });
});

test('Steam HTTP 200 anonymous error pages are treated as expired login sessions', () => {
  assert.throws(
    () => parseSubscriptionResponse('<script>g_steamID = false;</script>', 'favorite'),
    error => error && error.code === 'STEAM_WEB_LOGIN_REQUIRED' && error.requiresSteamLogin === true,
  );
  assert.throws(
    () => parseFavoriteStatus('<script>g_steamID = false</script>'),
    error => error && error.code === 'STEAM_WEB_LOGIN_REQUIRED' && error.requiresSteamLogin === true,
  );
});

test('favorite status ignores unrelated boolean statistics and requires the user action DOM', () => {
  assert.throws(
    () => parseFavoriteStatus('<script>window.stats = { "favorited": true };</script>'),
    error => error && error.code === 'STEAM_FAVORITE_STATUS_INVALID_RESPONSE',
  );
});

test('remote subscription posts the official Workshop fields and session cookie', async () => {
  let request;
  const service = createWorkshopSubscriptionService({
    getCommunityCookie: async () => 'steamLoginSecure=secure; sessionid=session-value',
    post: async (url, body, timeout, headers) => {
      request = { url, body, timeout, headers };
      return Buffer.from('{"success":1}');
    },
  });

  const result = await service.subscribe('3763428294');
  const form = new URLSearchParams(request.body);
  assert.equal(result.success, true);
  assert.equal(request.url, 'https://steamcommunity.com/sharedfiles/subscribe');
  assert.equal(form.get('id'), '3763428294');
  assert.equal(form.get('appid'), '431960');
  assert.equal(form.get('sessionid'), 'session-value');
  assert.equal(request.headers.Cookie, 'steamLoginSecure=secure; sessionid=session-value');
});

test('remote unsubscribe posts the official Workshop fields and session cookie', async () => {
  let request;
  const service = createWorkshopSubscriptionService({
    getCommunityCookie: async () => 'steamLoginSecure=secure; sessionid=session-value',
    post: async (url, body, timeout, headers) => {
      request = { url, body, timeout, headers };
      return Buffer.from('{"success":1}');
    },
  });

  const result = await service.unsubscribe('3763428294');
  const form = new URLSearchParams(request.body);
  assert.equal(result.success, true);
  assert.equal(request.url, 'https://steamcommunity.com/sharedfiles/unsubscribe');
  assert.equal(form.get('id'), '3763428294');
  assert.equal(form.get('appid'), '431960');
  assert.equal(form.get('sessionid'), 'session-value');
});

for (const operation of ['favorite', 'unfavorite']) {
  test(`remote ${operation} posts the official Workshop fields and session cookie`, async () => {
    let request;
    const service = createWorkshopSubscriptionService({
      getCommunityCookie: async () => 'steamLoginSecure=secure; sessionid=session-value',
      post: async (url, body, timeout, headers) => {
        request = { url, body, timeout, headers };
        return Buffer.from('{"success":1}');
      },
    });

    const result = await service[operation]('3763428294');
    const form = new URLSearchParams(request.body);
    assert.equal(result.success, true);
    assert.equal(request.url, `https://steamcommunity.com/sharedfiles/${operation}`);
    assert.equal(form.get('id'), '3763428294');
    assert.equal(form.get('appid'), '431960');
    assert.equal(form.get('sessionid'), 'session-value');
    assert.equal(request.headers.Cookie, 'steamLoginSecure=secure; sessionid=session-value');
  });
}

test('Workshop user status parses selected options regardless of HTML attribute order', () => {
  const active = [
    '<div class="subscribeOption subscribed selected" id="SubscribeItemOptionSubscribed">Subscribed</div>',
    '<div class="favoriteOption favorited selected" id="FavoriteItemOptionFavorited">Favorited</div>',
  ].join('');
  const inactive = [
    '<div id="SubscribeItemOptionAdd" class="subscribeOption subscribe selected">Subscribe</div>',
    '<div id="FavoriteItemOptionAdd" class="favoriteOption addfavorite selected">Favorite</div>',
  ].join('');

  assert.equal(parseSubscriptionStatus(active), true);
  assert.equal(parseFavoriteStatus(active), true);
  assert.equal(parseSubscriptionStatus(inactive), false);
  assert.equal(parseFavoriteStatus(inactive), false);
});

test('Workshop user status supports the legacy toggled favorite button', () => {
  assert.equal(parseFavoriteStatus('<span class="general_btn favorite toggled" id="FavoriteItemBtn"></span>'), true);
  assert.equal(parseFavoriteStatus('<span id="FavoriteItemBtn" class="general_btn favorite"></span>'), false);
});

test('subscription status loads one Workshop page and returns subscription and favorite state', async () => {
  let getCount = 0;
  const service = createWorkshopSubscriptionService({
    getCommunityCookie: async () => 'steamLoginSecure=secure; sessionid=session-value',
    get: async () => {
      getCount += 1;
      return Buffer.from([
        '<div id="SubscribeItemOptionSubscribed" class="subscribeOption subscribed selected"></div>',
        '<div id="FavoriteItemOptionAdd" class="favoriteOption addfavorite selected"></div>',
      ].join(''));
    },
  });

  const result = await service.status('3763428294');
  assert.equal(getCount, 1);
  assert.equal(result.subscribed, true);
  assert.equal(result.favorited, false);
});

test('favorite verifies the detail page when Steam returns a non-JSON success response', async () => {
  let getCount = 0;
  const service = createWorkshopSubscriptionService({
    getCommunityCookie: async () => 'steamLoginSecure=secure; sessionid=session-value',
    post: async () => Buffer.from(''),
    get: async () => {
      getCount += 1;
      return Buffer.from('<div id="FavoriteItemOptionFavorited" class="favoriteOption favorited selected"></div>');
    },
  });

  const result = await service.favorite('3763428294');
  assert.equal(result.success, true);
  assert.equal(getCount, 1);
});

test('favorite retries the proxy Community cookie after a g_steamID anonymous response', async () => {
  const cookies = [];
  const service = createWorkshopSubscriptionService({
    getCommunityCookie: async () => 'steamLoginSecure=expired; sessionid=expired',
    post: async (_url, _body, _timeout, headers) => {
      cookies.push(headers.Cookie);
      if (headers.Cookie.includes('expired')) return Buffer.from('<script>g_steamID = false;</script>');
      return Buffer.from('{"success":1}');
    },
  });

  const result = await service.favorite('3763428294', {
    steamCommunityCookie: 'steamLoginSecure=proxy; sessionid=proxy-session',
  });

  assert.equal(result.success, true);
  assert.deepEqual(cookies, [
    'steamLoginSecure=expired; sessionid=expired',
    'steamLoginSecure=proxy; sessionid=proxy-session',
  ]);
});

test('subscription remains available without the removed remote-subscription experiment', async () => {
  const service = createWorkshopSubscriptionService({
    getCommunityCookie: async () => 'steamLoginSecure=secure; sessionid=session-value',
    post: async () => Buffer.from('{"success":1}'),
  });

  const result = await service.subscribe('3763428294');
  assert.equal(result.success, true);
});

test('remote subscription requires a Community session id', async () => {
  const service = createWorkshopSubscriptionService({
    getCommunityCookie: async () => 'steamLoginSecure=secure',
    post: async () => Buffer.from('{"success":1}'),
  });
  await assert.rejects(() => service.subscribe('3763428294'), error => error && error.code === 'STEAM_WEB_LOGIN_REQUIRED' && error.requiresSteamLogin === true);
});

test('remote subscription retries the proxy Community cookie after an expired SteamKit cookie', async () => {
  const cookies = [];
  const service = createWorkshopSubscriptionService({
    getCommunityCookie: async () => 'steamLoginSecure=expired; sessionid=expired',
    post: async (_url, _body, _timeout, headers) => {
      cookies.push(headers.Cookie);
      if (headers.Cookie.includes('expired')) return Buffer.from('<script>window.UserConfig={"logged_in":false}</script>');
      return Buffer.from('{"success":1}');
    },
  });

  const result = await service.subscribe('3763428294', {
    steamCommunityCookie: 'steamLoginSecure=proxy; sessionid=proxy-session',
  });

  assert.equal(result.success, true);
  assert.deepEqual(cookies, [
    'steamLoginSecure=expired; sessionid=expired',
    'steamLoginSecure=proxy; sessionid=proxy-session',
  ]);
});
