'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { STEAM_RESOLUTION_TAG_LIST } = require('./filters');
const {
  CONTENT_RATING_TAG_LIST,
  WORKSHOP_CATEGORY_TAG_LIST,
  WORKSHOP_GENRE_TAG_LIST,
  WORKSHOP_TYPE_TAG_LIST,
} = require('./filterCatalog');
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
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.title), ['Item 101']);
});

test('signed-in public browsing sends the Community session cookie', async () => {
  const requests = [];
  const service = createWorkshopSearchService({
    nsfwEnabled: () => true,
    logger: { log() {}, warn() {} },
    get: async (url, headers) => {
      requests.push({ url, headers });
      return Buffer.from('<div class="workshopItem" data-publishedfileid="101"><div class="workshopItemTitle">Community item</div></div>');
    },
    getFileDetailsSafe: async (ids) => ids.map(id => ({ result: 1, publishedfileid: id, title: 'Community item', tags: [{ tag: 'Video' }] })),
  });

  const result = await service.search(
    { appid: 431960, page: 1, numperpage: 1, 'requiredtags[0]': 'Video' },
    {
      steamDataSource: 'community',
      steamCommunityCookie: 'steamLoginSecure=76561198000000001%7C%7Ctoken; sessionid=valid',
    },
  );

  assert.equal(requests.length, 1);
  assert.equal(requests[0].headers.Cookie, 'steamLoginSecure=76561198000000001%7C%7Ctoken; sessionid=valid');
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.title), ['Community item']);
});

test('signed-in public browsing rejects an expired Community session instead of becoming anonymous', async () => {
  const service = createNormalService({
    get: async () => Buffer.from('<script>window.UserConfig={"logged_in":false}</script>'),
  });

  await assert.rejects(
    () => service.search(
      { appid: 431960, page: 1, numperpage: 1 },
      {
        steamDataSource: 'community',
        steamCommunityCookie: 'steamLoginSecure=76561198000000001%7C%7Cexpired; sessionid=expired',
      },
    ),
    error => error && error.code === 'STEAM_WEB_LOGIN_REQUIRED',
  );
});

test('authenticated Community public caches are isolated by Steam account', async () => {
  const requests = [];
  const service = createNormalService({
    get: async (_url, headers) => {
      requests.push(headers.Cookie);
      const id = headers.Cookie.includes('76561198000000001') ? '123456' : '789012';
      return Buffer.from(`<div class="workshopItem" data-publishedfileid="${id}"><div class="workshopItemTitle">${id}</div></div>`);
    },
  });
  const params = { appid: 431960, page: 1, numperpage: 1 };

  const first = await service.search(params, {
    steamDataSource: 'community',
    steamCommunityCookie: 'steamLoginSecure=76561198000000001%7C%7Cone; sessionid=one',
  });
  const second = await service.search(params, {
    steamDataSource: 'community',
    steamCommunityCookie: 'steamLoginSecure=76561198000000002%7C%7Ctwo; sessionid=two',
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(first.response.publishedfiledetails.map(item => item.publishedfileid), ['123456']);
  assert.deepEqual(second.response.publishedfiledetails.map(item => item.publishedfileid), ['789012']);
});

test('Steam CM mode uses GetUserFiles details for personal lists', async () => {
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
    querySteamKitWorkshop: async (query) => {
      steamKitOptions = query;
      return {
        ids: ['101'],
        totalCount: 1,
        details: [{ result: 1, publishedfileid: '101', title: 'SteamKit subscription', tags: [{ tag: 'Video' }] }],
      };
    },
  });

  const result = await service.search(
    { appid: 431960, page: 1, numperpage: 1, path: 'myfiles', browsefilter: 'mysubscriptions', sortmethod: 'creationorder' },
    { steamKitQueryAvailable: true, steamAccountKey: 'steamkit:tester', steamDataSource: 'cm' }
  );

  assert.equal(detailRequests, 0);
  assert.equal(steamKitOptions.operation, 'user-files');
  assert.equal(steamKitOptions.type, 'mysubscriptions');
  assert.equal(steamKitOptions.sortmethod, 'creationorder');
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.title), ['SteamKit subscription']);
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
  assert.equal(Object.hasOwn(requestedHeaders || {}, 'Cookie'), false);
  assert.equal(Object.hasOwn(requestedHeaders || {}, 'x-webapi-key'), false);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.title), ['Item 101']);
});

test('Community public queries preserve one HTML page with official exclusion complements', async () => {
  const requests = [];
  let detailRequests = 0;
  const service = createNormalService({
    get: async (url) => {
      requests.push(url);
      return Buffer.from([
        '<div class="workshopBrowsePagingInfo">Showing 4-6 of 73</div>',
        '<div id="workshopBrowseItems">',
        '<div class="workshopItem" data-publishedfileid="303"><img class="workshopItemPreviewImage" src="https://img/303.jpg"><div class="workshopItemTitle">HTML first</div></div>',
        '<div class="workshopItem" data-publishedfileid="101"><img class="workshopItemPreviewImage" src="https://img/101.jpg"><div class="workshopItemTitle">HTML second</div></div>',
        '<div class="workshopItem" data-publishedfileid="202"><img class="workshopItemPreviewImage" src="https://img/202.jpg"><div class="workshopItemTitle">HTML third</div></div>',
        '</div>',
      ].join(''));
    },
    getFileDetailsSafe: async () => {
      detailRequests += 1;
      throw new Error('Community HTML must not block on details');
    },
  });

  const result = await service.search({
    appid: 431960,
    page: 2,
    numperpage: 3,
    'requiredtags[0]': 'Video',
    'type_or[0]': 'Scene',
    'rating_or[0]': 'Everyone',
    'genre_or[0]': 'Anime',
  }, { steamDataSource: 'community' });

  assert.equal(requests.length, 1);
  const requested = new URL(requests[0]);
  assert.equal(requested.searchParams.get('p'), '2');
  assert.deepEqual(requested.searchParams.getAll('requiredtags[]'), ['Wallpaper']);
  assert.deepEqual(requested.searchParams.getAll('excludedtags[]'), [
    ...WORKSHOP_TYPE_TAG_LIST.filter(tag => !['Video', 'Scene'].includes(tag)),
    ...CONTENT_RATING_TAG_LIST.filter(tag => tag !== 'Everyone'),
    ...WORKSHOP_GENRE_TAG_LIST.filter(tag => tag !== 'Anime'),
    ...WORKSHOP_CATEGORY_TAG_LIST.filter(tag => tag !== 'Wallpaper'),
  ]);
  assert.equal(detailRequests, 0);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['303', '101', '202']);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.title), ['HTML first', 'HTML second', 'HTML third']);
  assert.ok(result.response.publishedfiledetails.every(item => item.preview_url === ''));
  assert.ok(result.response.publishedfiledetails.every(item => item.detailsPending));
  assert.equal(result.response.total, 73);
  assert.equal(result.diagnostics.pageLoadMode, 'community-html-single-page');
});

test('Community multi-select sends one official complement query', async () => {
  const requests = [];
  let detailRequests = 0;
  const service = createNormalService({
    get: async (url) => {
      requests.push(url);
      return Buffer.from('<div class="workshopItem" data-publishedfileid="101"><div class="workshopItemTitle">Steam AND result</div></div>');
    },
    getFileDetailsSafe: async () => {
      detailRequests += 1;
      return [];
    },
  });

  const result = await service.search({
    appid: 431960,
    page: 1,
    numperpage: 10,
    'requiredtags[0]': 'Approved',
    'type_or[0]': 'Video',
    'type_or[1]': 'Scene',
    'rating_or[0]': 'Everyone',
    'rating_or[1]': 'Questionable',
    'genre_or[0]': 'Anime',
    'genre_or[1]': 'Nature',
  }, { steamDataSource: 'community' });

  assert.equal(requests.length, 1);
  assert.equal(detailRequests, 0);
  const query = new URL(requests[0]);
  assert.deepEqual(query.searchParams.getAll('requiredtags[]'), ['Wallpaper', 'Approved']);
  assert.deepEqual(query.searchParams.getAll('excludedtags[]'), [
    ...WORKSHOP_TYPE_TAG_LIST.filter(tag => !['Video', 'Scene'].includes(tag)),
    ...CONTENT_RATING_TAG_LIST.filter(tag => !['Everyone', 'Questionable'].includes(tag)),
    ...WORKSHOP_GENRE_TAG_LIST.filter(tag => !['Anime', 'Nature'].includes(tag)),
    ...WORKSHOP_CATEGORY_TAG_LIST.filter(tag => tag !== 'Wallpaper'),
  ]);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['101']);
  assert.equal(result.diagnostics.pageLoadMode, 'community-html-single-page');
});

test('Community resolution multi-select sends one excluded-tag complement query', async () => {
  const requests = [];
  const service = createNormalService({
    get: async (url) => {
      requests.push(url);
      return Buffer.from('<div class="workshopItem" data-publishedfileid="101"><div class="workshopItemTitle">Steam exclusion result</div></div>');
    },
  });

  const result = await service.search({
    appid: 431960,
    page: 1,
    numperpage: 30,
    community_tag_filter: 1,
    'requiredtags[0]': 'Everyone',
    'requiredtags[1]': 'Video',
    'resolution_or[0]': '2560 x 1080',
    'resolution_or[1]': '3440 x 1440',
  }, { steamDataSource: 'community' });

  assert.equal(requests.length, 1);
  const query = new URL(requests[0]);
  assert.deepEqual(query.searchParams.getAll('requiredtags[]'), ['Wallpaper']);
  assert.deepEqual(
    query.searchParams.getAll('excludedtags[]'),
    [
      ...WORKSHOP_TYPE_TAG_LIST.filter(tag => tag !== 'Video'),
      ...CONTENT_RATING_TAG_LIST.filter(tag => tag !== 'Everyone'),
      ...STEAM_RESOLUTION_TAG_LIST.filter(tag => ![
        'Ultrawide 2560 x 1080',
        'Ultrawide 3440 x 1440',
      ].includes(tag)),
      ...WORKSHOP_CATEGORY_TAG_LIST.filter(tag => tag !== 'Wallpaper'),
    ],
  );
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['101']);
  assert.equal(result.diagnostics.pageLoadMode, 'community-html-single-page');
});

test('Community exact phrase option preserves the official single-page search semantics', async () => {
  const requests = [];
  let detailRequests = 0;
  const service = createNormalService({
    get: async (url) => {
      requests.push(url);
      return Buffer.from(['101', '202'].map(id => `<div class="workshopItem" data-publishedfileid="${id}"></div>`).join(''));
    },
    getFileDetailsSafe: async () => {
      detailRequests += 1;
      return [];
    },
  });

  const result = await service.search({
    appid: 431960,
    page: 1,
    numperpage: 2,
    query_type: 0,
    search_text: '"city rain"',
  }, { steamDataSource: 'community' });

  assert.equal(requests.length, 1);
  assert.equal(detailRequests, 0);
  assert.equal(new URL(requests[0]).searchParams.get('searchtext'), '"city rain"');
  assert.equal(new URL(requests[0]).searchParams.get('browsesort'), 'toprated');
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['101', '202']);
  assert.equal(result.diagnostics.pageLoadMode, 'community-html-single-page');
});

test('Mature-only empty results retry once with Questionable allowed', async () => {
  const queries = [];
  const service = createNormalService({
    get: async () => { throw new Error('Steam Community should not be requested'); },
    querySteamKitWorkshop: async (query) => {
      queries.push(query);
      if (queries.length === 1) return { ids: [], totalCount: 0, details: [] };
      return {
        ids: ['101'],
        totalCount: 1,
        details: [{ result: 1, publishedfileid: '101', title: 'Relaxed rating result', tags: [{ tag: 'Questionable' }] }],
      };
    },
  });

  const result = await service.search({
    appid: 431960,
    page: 1,
    numperpage: 30,
    'rating_or[0]': 'Mature',
  }, { steamDataSource: 'cm', steamKitQueryAvailable: true });

  assert.equal(queries.length, 2);
  assert.ok(queries[0].excludedtags.includes('Everyone'));
  assert.ok(queries[0].excludedtags.includes('Questionable'));
  assert.ok(queries[1].excludedtags.includes('Everyone'));
  assert.equal(queries[1].excludedtags.includes('Questionable'), false);
  assert.deepEqual(result.diagnostics, { upstreamRequests: 2, ratingFallback: 'allow-questionable' });
});

test('unrelated empty results do not trigger rating fallback', async () => {
  const queries = [];
  const service = createNormalService({
    get: async () => { throw new Error('Steam Community should not be requested'); },
    querySteamKitWorkshop: async (query) => {
      queries.push(query);
      return { ids: [], totalCount: 0, details: [] };
    },
  });

  const result = await service.search({
    appid: 431960,
    page: 1,
    numperpage: 30,
    'rating_or[0]': 'Everyone',
  }, { steamDataSource: 'cm', steamKitQueryAvailable: true });

  assert.equal(queries.length, 1);
  assert.deepEqual(result.diagnostics, { upstreamRequests: 1 });
});

test('Community public queries preserve the official Steam SSR page limit', async () => {
  const service = createNormalService({
    get: async () => Buffer.from([
      '<div class="workshopItem" data-publishedfileid="123456"><div class="workshopItemTitle">SSR item</div></div>',
      '<script>window.__SSR__="{\\\"total_pages\\\":1000,\\\"total_count\\\":2597084,\\\"results\\\":[]}";</script>',
    ].join('')),
  });

  const result = await service.search(
    { appid: 431960, page: 1, numperpage: 50 },
    { steamDataSource: 'community' },
  );

  assert.equal(result.response.total, 2597084);
  assert.equal(result.response.totalPages, 1000);
  assert.equal(result.totalPages, 1000);
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
    { steamKitQueryAvailable: true, steamDataSource: 'webapi' },
  );

  const requested = new URL(requests[0].url);
  const input = JSON.parse(requested.searchParams.get('input_json'));
  assert.equal(requested.host, 'api.steampowered.com');
  assert.equal(requested.searchParams.get('key'), 'test-key');
  assert.equal(input.search_text, '极客湾');
  assert.equal(requests[0].headers['x-webapi-key'], 'test-key');
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.title), ['Web API item']);
});

test('Community source ignores a configured Web API key', async () => {
  const requests = [];
  const service = createNormalService({
    getSteamApiKey: () => 'test-key',
    get: async (url) => {
      requests.push(url);
      return Buffer.from('<div class="workshopItem" data-publishedfileid="101"><div class="workshopItemTitle">Community item</div></div>');
    },
  });

  await service.search(
    { appid: 431960, page: 1, numperpage: 1, 'requiredtags[0]': 'Video' },
    { steamDataSource: 'community' },
  );

  assert.deepEqual(requests.map(url => new URL(url).host), ['steamcommunity.com']);
});

test('Steam CM source queries public Workshop search through QueryFiles', async () => {
  let cmQuery;
  const service = createNormalService({
    get: async () => {
      throw new Error('Steam Community should not be requested');
    },
    querySteamKitWorkshop: async (query) => {
      cmQuery = query;
      return {
        ids: ['101'],
        totalCount: 1,
        details: [{ result: 1, publishedfileid: '101', title: 'CM item', tags: [{ tag: 'Video' }] }],
      };
    },
  });

  const result = await service.search(
    { appid: 431960, page: 1, numperpage: 1, search_text: 'video', days: 7 },
    { steamDataSource: 'cm', steamKitQueryAvailable: true },
  );

  assert.equal(cmQuery.operation, 'query-files');
  assert.equal(cmQuery.query_type, 3);
  assert.equal(cmQuery.search_text, 'video');
  assert.equal(cmQuery.days, 7);
  assert.equal(result.source, 'steam-cm');
  assert.equal(result.fallbackUsed, undefined);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.title), ['CM item']);
});

test('Steam CM reports the complete upstream total while keeping the browse page limit', async () => {
  let cmQuery;
  const service = createNormalService({
    get: async () => { throw new Error('Steam Community should not be requested'); },
    querySteamKitWorkshop: async (query) => {
      cmQuery = query;
      return {
        ids: ['101'],
        totalCount: 1067749,
        details: [{ result: 1, publishedfileid: '101', title: 'CM item', tags: [{ tag: 'Video' }, { tag: 'Everyone' }] }],
      };
    },
  });

  const result = await service.search({
    appid: 431960,
    query_type: 1,
    days: 30,
    page: 1,
    numperpage: 50,
    'requiredtags[0]': 'Video',
    'requiredtags[1]': 'Everyone',
  }, { steamDataSource: 'cm', steamKitQueryAvailable: true });

  assert.equal(cmQuery.days, 30);
  assert.equal(Object.hasOwn(cmQuery, 'include_recent_votes_only'), false);
  assert.equal(result.response.total, 1067749);
  assert.equal(result.response.totalPages, 1000);
  assert.equal(result.totalPages, 1000);
});

test('Steam CM legacy multi-select parameters become one complement query', async () => {
  const queries = [];
  const service = createNormalService({
    get: async () => { throw new Error('Steam Community should not be requested'); },
    querySteamKitWorkshop: async (query) => {
      queries.push(query);
      return {
        ids: ['101'],
        totalCount: 1,
        details: [
          { result: 1, publishedfileid: '101', title: 'Match all', tags: [{ tag: 'Scene' }, { tag: 'Anime' }, { tag: 'Nature' }, { tag: 'Approved' }] },
        ],
      };
    },
  });

  const result = await service.search({
    appid: 431960,
    page: 1,
    numperpage: 10,
    'requiredtags[0]': 'Approved',
    'genre_or[0]': 'Anime',
    'genre_or[1]': 'Nature',
  }, { steamDataSource: 'cm', steamKitQueryAvailable: true });

  assert.equal(queries.length, 1);
  assert.deepEqual(queries[0].requiredtags, ['Wallpaper', 'Approved']);
  assert.deepEqual(queries[0].excludedtags, [
    ...WORKSHOP_GENRE_TAG_LIST.filter(tag => !['Anime', 'Nature'].includes(tag)),
    ...WORKSHOP_CATEGORY_TAG_LIST.filter(tag => tag !== 'Wallpaper'),
  ]);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['101']);
});

test('Steam CM sends one Wallpaper Engine-style resolution exclusion query', async () => {
  const queries = [];
  let activeQueries = 0;
  let maximumActiveQueries = 0;
  const service = createNormalService({
    get: async () => { throw new Error('Steam Community should not be requested'); },
    querySteamKitWorkshop: async (query) => {
      queries.push(query);
      activeQueries += 1;
      maximumActiveQueries = Math.max(maximumActiveQueries, activeQueries);
      await new Promise(resolve => setTimeout(resolve, 5));
      activeQueries -= 1;
      return {
        ids: ['101'],
        totalCount: 1,
        details: [
          { result: 1, publishedfileid: '101', title: 'Expected', tags: [{ tag: 'Everyone' }, { tag: 'Video' }, { tag: 'Ultrawide 3440 x 1440' }] },
        ],
      };
    },
  });

  const result = await service.search({
    appid: 431960,
    page: 1,
    numperpage: 10,
    'requiredtags[0]': 'Everyone',
    'requiredtags[1]': 'Video',
    'resolution_or[0]': 'Ultrawide',
    'resolution_or[1]': '2560 x 1080',
    'resolution_or[2]': '3440 x 1440',
  }, { steamDataSource: 'cm', steamKitQueryAvailable: true });

  assert.equal(queries.length, 1);
  assert.equal(maximumActiveQueries, 1);
  assert.equal(queries[0].match_all_tags, true);
  assert.equal(queries[0].numperpage, 10);
  assert.deepEqual(queries[0].requiredtags, ['Wallpaper']);
  assert.deepEqual(queries[0].excludedtags, [
    ...WORKSHOP_TYPE_TAG_LIST.filter(tag => tag !== 'Video'),
    ...CONTENT_RATING_TAG_LIST.filter(tag => tag !== 'Everyone'),
    ...STEAM_RESOLUTION_TAG_LIST.filter(tag => ![
      'Ultrawide Standard Definition',
      'Ultrawide 2560 x 1080',
      'Ultrawide 3440 x 1440',
    ].includes(tag)),
    ...WORKSHOP_CATEGORY_TAG_LIST.filter(tag => tag !== 'Wallpaper'),
  ]);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['101']);
  assert.deepEqual(result.diagnostics, { upstreamRequests: 1 });
});

test('Steam Web API sends one Wallpaper Engine-style resolution exclusion query', async () => {
  const requests = [];
  const service = createNormalService({
    getSteamApiKey: () => 'test-key',
    get: async (url) => {
      requests.push(url);
      return Buffer.from(JSON.stringify({ response: {
        total: 1,
        publishedfiledetails: [
          { result: 1, publishedfileid: '101', title: 'Expected', tags: [{ tag: 'Everyone' }, { tag: 'Video' }, { tag: 'Ultrawide 3440 x 1440' }] },
        ],
      } }));
    },
  });

  const result = await service.search({
    appid: 431960,
    page: 1,
    numperpage: 10,
    'requiredtags[0]': 'Everyone',
    'requiredtags[1]': 'Video',
    'resolution_or[0]': '2560 x 1080',
    'resolution_or[1]': '3440 x 1440',
  }, { steamDataSource: 'webapi' });

  assert.equal(requests.length, 1);
  const query = new URL(requests[0]);
  const input = JSON.parse(query.searchParams.get('input_json'));
  assert.equal(input.match_all_tags, true);
  assert.equal(input.numperpage, 10);
  assert.deepEqual(input.requiredtags, ['Wallpaper']);
  assert.deepEqual(query.searchParams.getAll('requiredtags[]'), []);
  assert.equal(query.searchParams.get('requiredtags[0]'), null);
  assert.deepEqual(
    input.excludedtags,
    [
      ...WORKSHOP_TYPE_TAG_LIST.filter(tag => tag !== 'Video'),
      ...CONTENT_RATING_TAG_LIST.filter(tag => tag !== 'Everyone'),
      ...STEAM_RESOLUTION_TAG_LIST.filter(tag => ![
        'Ultrawide 2560 x 1080',
        'Ultrawide 3440 x 1440',
      ].includes(tag)),
      ...WORKSHOP_CATEGORY_TAG_LIST.filter(tag => tag !== 'Wallpaper'),
    ],
  );
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['101']);
  assert.deepEqual(result.diagnostics, { upstreamRequests: 1 });
});

test('large resolution groups remain one request and retain typed wallpaper items', async () => {
  const queries = [];
  let activeQueries = 0;
  let maximumActiveQueries = 0;
  const service = createNormalService({
    get: async () => { throw new Error('Steam Community should not be requested'); },
    querySteamKitWorkshop: async (query) => {
      queries.push(query);
      activeQueries += 1;
      maximumActiveQueries = Math.max(maximumActiveQueries, activeQueries);
      await new Promise(resolve => setTimeout(resolve, 5));
      activeQueries -= 1;
      const id = String(1000 + queries.indexOf(query));
      const detail = {
        result: 1,
        publishedfileid: id,
        title: `Item ${id}`,
        tags: [...query.requiredtags, 'Video'].map(tag => ({ tag })),
      };
      return { ids: [id], totalCount: 1, details: [detail] };
    },
  });

  const result = await service.search({
    appid: 431960,
    page: 1,
    numperpage: 30,
    'requiredtags[0]': 'Everyone',
    'requiredtags[1]': 'Video',
    'resolution_or[0]': 'Ultrawide',
    'resolution_or[1]': '2560 x 1080',
    'resolution_or[2]': '3440 x 1440',
    'resolution_or[3]': '3840 x 1080',
    'resolution_or[4]': '5120 x 1440',
  }, { steamDataSource: 'cm', steamKitQueryAvailable: true });

  assert.equal(queries.length, 1);
  assert.equal(maximumActiveQueries, 1);
  assert.equal(queries[0].page, 1);
  assert.equal(queries[0].numperpage, 30);
  assert.equal(queries[0].match_all_tags, true);
  assert.deepEqual(queries[0].requiredtags, ['Wallpaper']);
  assert.equal(queries[0].excludedtags.length, (WORKSHOP_TYPE_TAG_LIST.length - 1) + (CONTENT_RATING_TAG_LIST.length - 1) + STEAM_RESOLUTION_TAG_LIST.length - 5 + 1);
  assert.equal(result.response.publishedfiledetails.length, 1);
  assert.equal(result.response.total, 1);
  assert.deepEqual(result.diagnostics, { upstreamRequests: 1 });
});

test('an invalid Web API key fails without Community fallback', async () => {
  const requests = [];
  const service = createNormalService({
    getSteamApiKey: () => 'test-key',
    get: async (url) => {
      requests.push(url);
      if (new URL(url).host === 'api.steampowered.com') throw new Error('HTTP 403 api.steampowered.com');
      return Buffer.from('<div class="workshopItem" data-publishedfileid="101"><div class="workshopItemTitle">Community item</div></div>');
    },
  });

  await assert.rejects(
    () => service.search(
      { appid: 431960, page: 1, numperpage: 1, 'requiredtags[0]': 'Video' },
      { steamDataSource: 'webapi' },
    ),
    error => error && error.code === 'STEAM_WEB_API_KEY_INVALID',
  );

  assert.deepEqual(requests.map(url => new URL(url).host), ['api.steampowered.com']);
});

test('Steam Web API mode fails before querying when API key is missing', async () => {
  const service = createNormalService();
  await assert.rejects(
    () => service.search(
      { appid: 431960, page: 1, numperpage: 1 },
      { steamDataSource: 'webapi' },
    ),
    error => error && error.code === 'STEAM_WEB_API_KEY_REQUIRED' && error.statusCode === 400,
  );
});

test('Steam CM mode fails without a usable remembered session', async () => {
  const service = createNormalService({ querySteamKitWorkshop: async () => ({}) });
  await assert.rejects(
    () => service.search(
      { appid: 431960, page: 1, numperpage: 1 },
      { steamDataSource: 'cm', steamKitQueryAvailable: false },
    ),
    error => error && error.code === 'STEAM_CM_LOGIN_REQUIRED' && error.statusCode === 401,
  );
});

test('direct Workshop IDs use public details without requiring Web API or CM credentials', async () => {
  for (const steamDataSource of ['webapi', 'cm']) {
    let detailRequests = 0;
    const service = createNormalService({
      get: async () => { throw new Error('A list source should not be requested'); },
      getFileDetailsSafe: async (ids) => {
        detailRequests += 1;
        return ids.map(id => ({ result: 1, publishedfileid: id, title: 'Direct item', tags: [{ tag: 'Video' }] }));
      },
    });

    const result = await service.search(
      { appid: 431960, page: 1, numperpage: 1, search_text: 'https://steamcommunity.com/sharedfiles/filedetails/?id=123456' },
      { steamDataSource, steamKitQueryAvailable: false },
    );

    assert.equal(detailRequests, 1);
    assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['123456']);
  }
});

test('strict sources report direct Workshop detail failures instead of returning an empty result', async () => {
  for (const steamDataSource of ['webapi', 'cm']) {
    const service = createNormalService({
      getFileDetailsSafe: async () => { throw new Error('details unavailable'); },
    });

    await assert.rejects(
      () => service.search(
        { appid: 431960, page: 1, numperpage: 1, workshop_id: '123456' },
        { steamDataSource, steamKitQueryAvailable: false },
      ),
      error => error && error.code === 'STEAM_WORKSHOP_DETAILS_FAILED' && error.statusCode === 502,
    );
  }
});

test('strict sources report list detail enrichment failures instead of returning an empty result', async () => {
  const cases = [
    {
      steamDataSource: 'webapi',
      overrides: {
        getSteamApiKey: () => 'test-key',
        get: async () => Buffer.from(JSON.stringify({ response: { total: 1, publishedfileids: ['123456'] } })),
      },
      runOptions: { steamDataSource: 'webapi' },
    },
    {
      steamDataSource: 'cm',
      overrides: {
        querySteamKitWorkshop: async () => ({ ids: ['123456'], totalCount: 1, details: [] }),
      },
      runOptions: { steamDataSource: 'cm', steamKitQueryAvailable: true },
    },
  ];

  for (const testCase of cases) {
    const service = createNormalService(Object.assign({}, testCase.overrides, {
      getFileDetailsSafe: async () => { throw new Error(`${testCase.steamDataSource} details unavailable`); },
    }));
    await assert.rejects(
      () => service.search({ appid: 431960, page: 1, numperpage: 1 }, testCase.runOptions),
      error => error && error.code === 'STEAM_WORKSHOP_DETAILS_FAILED' && error.statusCode === 502,
    );
  }
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
