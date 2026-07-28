'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkshopSearchService } = require('./search');

function createNormalService(overrides = {}) {
  return createWorkshopSearchService(Object.assign({
    nsfwEnabled: () => true,
    logger: { log() {}, warn() {} },
    get: async () => Buffer.from([
      '<div id="workshopBrowseItems">',
      '<div class="workshopItem" data-publishedfileid="101">',
      '<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=101">',
      '<img class="workshopItemPreviewImage" src="https://img/101.jpg" alt="Item 101">',
      '<div class="workshopItemTitle">Item 101</div>',
      '</a></div></div>',
    ].join('')),
    getFileDetailsSafe: async (ids) => ids.map((id) => ({
      result: 1,
      publishedfileid: id,
      title: `Detail ${id}`,
      tags: [{ tag: 'Everyone' }, { tag: 'Video' }],
    })),
  }, overrides));
}

test('anonymous Workshop browsing uses Community pages when logged out', async () => {
  const requests = [];
  const service = createNormalService({
    get: async (url) => {
      requests.push(url);
      return Buffer.from([
        '<div id="workshopBrowseItems">',
        '<div class="workshopItem" data-publishedfileid="101">',
        '<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=101">',
        '<img class="workshopItemPreviewImage" src="https://img/101.jpg" alt="Item 101">',
        '<div class="workshopItemTitle">Item 101</div>',
        '</a></div></div>',
      ].join(''));
    },
  });

  for (const params of [
    { query_type: 1, 'type_or[0]': 'Video', 'type_or[1]': 'Scene' },
    { query_type: 0, 'rating_or[0]': 'Everyone', 'rating_or[1]': 'Questionable' },
  ]) {
    const result = await service.search(
      { appid: 431960, page: 1, numperpage: 1, ...params },
      { steamKitQueryAvailable: false },
    );
    assert.notEqual(result.diagnostics?.pageLoadMode, 'community-sequence-page');
    assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['101']);
  }
  assert.ok(requests.every((url) => new URL(url).host === 'steamcommunity.com'));
  assert.ok(requests.every((url) => new URL(url).pathname === '/workshop/browse/'));
});

test('signed-out browsing uses the anonymous Workshop page without a personal Web API key', async () => {
  const requests = [];
  const service = createNormalService({
    get: async (url) => {
      requests.push(url);
      return Buffer.from([
        '<div id="workshopBrowseItems">',
        '<div class="workshopItem" data-publishedfileid="101">',
        '<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=101">',
        '<img class="workshopItemPreviewImage" src="https://img/101.jpg" alt="Item 101">',
        '<div class="workshopItemTitle">Item 101</div>',
        '</a></div></div>',
      ].join(''));
    },
  });

  const result = await service.search(
    { appid: 431960, page: 1, numperpage: 1, 'requiredtags[0]': 'Everyone' },
    { steamKitQueryAvailable: false },
  );

  assert.equal(requests.length, 1);
  const requested = new URL(requests[0]);
  assert.equal(requested.host, 'steamcommunity.com');
  assert.equal(requested.pathname, '/workshop/browse/');
  assert.equal(requested.searchParams.has('key'), false);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.title), ['Detail 101']);
});

test('signed-in public browsing still uses Community pages when no Web API key is configured', async () => {
  let communityRequests = 0;
  const service = createWorkshopSearchService({
    nsfwEnabled: () => true,
    logger: { log() {}, warn() {} },
    get: async () => {
      communityRequests += 1;
      return Buffer.from('<div class="workshopItem" data-publishedfileid="101"><div class="workshopItemTitle">Community item</div></div>');
    },
    getFileDetailsSafe: async (ids) => ids.map(id => ({ result: 1, publishedfileid: id, title: 'Community item', tags: [{ tag: 'Video' }] })),
  });

  const result = await service.search(
    { appid: 431960, page: 1, numperpage: 1, 'requiredtags[0]': 'Video' },
    { steamKitQueryAvailable: true }
  );

  assert.equal(communityRequests, 1);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.title), ['Community item']);
});

test('SteamKit-first query mode uses GetUserFiles details for personal lists', async () => {
  let detailRequests = 0;
  let steamKitOptions;
  const service = createWorkshopSearchService({
    nsfwEnabled: () => true,
    logger: { log() {}, warn() {} },
    get: async () => {
      throw new Error('Steam Community should not be requested');
    },
    getFileDetailsSafe: async () => {
      detailRequests += 1;
      throw new Error('SteamKit GetUserFiles already returned the details');
    },
    querySteamKitUserFiles: async (_listType, options) => {
      steamKitOptions = options;
      return {
        ids: ['101'],
        totalCount: 1,
        details: [{ result: 1, publishedfileid: '101', title: 'SteamKit subscription', tags: [{ tag: 'Video' }] }],
      };
    },
  });

  const result = await service.search(
    { appid: 431960, page: 1, numperpage: 1, path: 'myfiles', browsefilter: 'mysubscriptions', sortmethod: 'creationorder' },
    { steamKitQueryAvailable: true, steamAccountKey: 'steamkit:tester' }
  );

  assert.equal(detailRequests, 0);
  assert.equal(steamKitOptions.sortmethod, 'creationorder');
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.title), ['SteamKit subscription']);
  assert.equal(result.diagnostics.detailMode, 'steamkit');
});

test('signed-out anonymous browsing does not send a personal Web API key', async () => {
  let requestedUrl = '';
  let requestedHeaders = null;
  const service = createWorkshopSearchService({
    nsfwEnabled: () => true,
    logger: { log() {}, warn() {} },
    get: async (url, headers) => {
      requestedUrl = url;
      requestedHeaders = headers;
      return Buffer.from([
        '<div id="workshopBrowseItems">',
        '<div class="workshopItem" data-publishedfileid="101">',
        '<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=101">',
        '<img class="workshopItemPreviewImage" src="https://img/101.jpg" alt="Item 101">',
        '<div class="workshopItemTitle">Item 101</div>',
        '</a></div></div>',
      ].join(''));
    },
    getFileDetailsSafe: async (ids) => ids.map(id => ({ result: 1, publishedfileid: id, title: 'Anonymous item', tags: [{ tag: 'Video' }] })),
  });

  const result = await service.search(
    { appid: 431960, page: 1, numperpage: 1, 'requiredtags[0]': 'Video' },
    { steamKitQueryAvailable: false }
  );

  const parsed = new URL(requestedUrl);
  assert.equal(parsed.host, 'steamcommunity.com');
  assert.equal(parsed.pathname, '/workshop/browse/');
  assert.equal(parsed.searchParams.has('key'), false);
  assert.equal(Object.hasOwn(requestedHeaders || {}, 'x-webapi-key'), false);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.title), ['Anonymous item']);
});

test('a configured Web API key takes priority over Community browsing for signed-in public searches', async () => {
  const requests = [];
  const service = createWorkshopSearchService({
    getSteamApiKey: () => 'test-key',
    nsfwEnabled: () => true,
    logger: { log() {}, warn() {} },
    get: async (url, headers) => {
      requests.push({ url, headers });
      return Buffer.from(JSON.stringify({ response: {
        total: 1,
        publishedfiledetails: [{ result: 1, publishedfileid: '101', title: 'Web API item', tags: [{ tag: 'Video' }] }],
      } }));
    },
    getFileDetailsSafe: async () => {
      throw new Error('Web API already returned the details');
    },
  });

  const result = await service.search(
    { appid: 431960, page: 1, numperpage: 1, search_text: '极客湾', 'requiredtags[0]': 'Video' },
    { steamKitQueryAvailable: true },
  );

  const requested = new URL(requests[0].url);
  assert.equal(requested.host, 'api.steampowered.com');
  assert.equal(requested.searchParams.get('key'), 'test-key');
  assert.equal(requested.searchParams.get('search_text'), '极客湾');
  assert.equal(requests[0].headers['x-webapi-key'], 'test-key');
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.title), ['Web API item']);
});

test('a failed Web API request falls back to Community browsing', async () => {
  const requests = [];
  const service = createNormalService({
    getSteamApiKey: () => 'test-key',
    get: async (url) => {
      requests.push(url);
      if (new URL(url).host === 'api.steampowered.com') throw new Error('HTTP 403 api.steampowered.com');
      return Buffer.from('<div class="workshopItem" data-publishedfileid="101"><div class="workshopItemTitle">Community item</div></div>');
    },
  });

  const result = await service.search({ appid: 431960, page: 1, numperpage: 1, 'requiredtags[0]': 'Video' });

  assert.deepEqual(requests.map(url => new URL(url).host), ['api.steampowered.com', 'steamcommunity.com']);
  assert.equal(result.source, 'webapi-fallback');
  assert.equal(result.fallbackUsed, true);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['101']);
});

test('signed-in public browsing uses Community pages when no Web API key is configured', async () => {
  let communityRequests = 0;
  const service = createNormalService({
    get: async () => {
      communityRequests += 1;
      return Buffer.from('<div class="workshopItem" data-publishedfileid="101"><div class="workshopItemTitle">Community item</div></div>');
    },
  });

  const result = await service.search(
    { appid: 431960, page: 1, numperpage: 1, 'requiredtags[0]': 'Video' },
    { steamKitQueryAvailable: true },
  );
  assert.equal(communityRequests, 1);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['101']);
});

test('signed-in public browsing uses Community pages without a Web API key', async () => {
  let communityRequests = 0;
  const service = createNormalService({
    get: async () => {
      communityRequests += 1;
      return Buffer.from([
        '<div id="workshopBrowseItems">',
        '<div class="workshopItem" data-publishedfileid="101">',
        '<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=101">',
        '<img class="workshopItemPreviewImage" src="https://img/101.jpg" alt="Item 101">',
        '<div class="workshopItemTitle">Item 101</div>',
        '</a></div></div>',
      ].join(''));
    },
  });

  const result = await service.search(
    { appid: 431960, page: 1, numperpage: 1, 'requiredtags[0]': 'Video' },
    { steamKitQueryAvailable: true },
  );

  assert.equal(communityRequests, 1);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['101']);
});

test('personal Community filters retain the authenticated profile without an ordering mode', async () => {
  const requests = [];
  const service = createNormalService({
    get: async (url, headers) => {
      requests.push({ url, headers });
      return Buffer.from('<div class="workshopItem" data-publishedfileid="101"><div class="workshopItemTitle">Favorite</div></div>');
    },
  });

  const result = await service.search(
    { appid: 431960, page: 1, numperpage: 1, path: 'myfiles', browsefilter: 'myfavorites' },
    { steamCommunityCookie: 'steamLoginSecure=76561198000000001%7C%7Ctoken; sessionid=valid' },
  );

  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['101']);
  assert.equal(new URL(requests[0].url).pathname, '/profiles/76561198000000001/myworkshopfiles/');
  assert.equal(requests[0].headers.Cookie, 'steamLoginSecure=76561198000000001%7C%7Ctoken; sessionid=valid');
});
