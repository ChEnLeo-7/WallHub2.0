'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkshopSearchService } = require('./search');

function createService(overrides = {}) {
  return createWorkshopSearchService(Object.assign({
    getSteamApiKey: () => '',
    useSteamApi: () => false,
    useCommunityBrowseOrder: () => true,
    nsfwEnabled: () => true,
    logger: { log() {}, warn() {} },
    getFileDetailsSafe: async (ids) => ids.map(id => ({
      result: 1,
      publishedfileid: id,
      title: `Detail ${id}`,
      preview_url: `https://img/full/${id}.jpg`,
      tags: [{ tag: 'Everyone' }],
    })),
  }, overrides));
}

function communityJsonPage(ids, page = 1, total = 50000) {
  const html = JSON.stringify({
    results: ids.map(id => ({ publishedfileid: id, title: `Community ${id}`, preview_url: `https://img/community/${id}.jpg` })),
    total_count: total,
    total_pages: Math.max(1, Math.ceil(total / Math.max(1, ids.length || 1))),
    page,
  });
  return Buffer.from(`<script type="application/json">${html}</script>`);
}

function communityHtmlPage(ids, page = 1, totalPages = 35) {
  const items = ids.map(id => [
    `<div class="workshopItem" data-publishedfileid="${id}">`,
    `<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=${id}">`,
    `<img class="workshopItemPreviewImage" src="https://img/${id}.jpg" alt="Item ${id}">`,
    `<div class="workshopItemTitle">Item ${id}</div>`,
    '</a>',
    '</div>',
  ].join('')).join('');
  return Buffer.from([
    '<div id="workshopBrowseItems">',
    items,
    '</div>',
    '<div class="workshopBrowsePaging">',
    `<a href="?appid=431960&p=${Math.max(1, page - 1)}">&lt;</a>`,
    `<a href="?appid=431960&p=${totalPages}">${totalPages}</a>`,
    '</div>',
  ].join(''));
}

function communityReactQueryPage(ids, page = 1, totalPages = 35, totalCount = 1732) {
  const dehydrated = {
    queries: [{
      state: {
        data: {
          current_page: page,
          total_pages: totalPages,
          total_count: totalCount,
          results: ids.map(id => ({ publishedfileid: id, title: `Community ${id}`, preview_url: `https://img/community/${id}.jpg` })),
        },
      },
      queryKey: ['workshop_browse', { appid: 431960, page, num_per_page: ids.length, required_tags: ['Everyone', 'Video', 'Approved'] }],
    }],
  };
  return Buffer.from(`<script>window.SSR = { renderContext: JSON.parse(${JSON.stringify(JSON.stringify({ dehydrated }))}) };</script>`);
}

test('community order mode returns exact Steam page order with enriched details', async () => {
  let detailsCalls = 0;
  const service = createService({
    get: async () => communityJsonPage(['333', '111', '222']),
    getFileDetailsSafe: async (ids) => {
      detailsCalls += 1;
      return ids.slice().reverse().map(id => ({
        result: 1,
        publishedfileid: id,
        title: `Detail ${id}`,
        preview_url: `https://img/full/${id}.jpg`,
      }));
    },
  });

  const result = await service.search({ appid: 431960, query_type: 1, page: 1, numperpage: 3 });
  const ids = result.response.publishedfiledetails.map(item => item.publishedfileid);

  assert.deepEqual(ids, ['333', '111', '222']);
  assert.equal(result.response.publishedfiledetails[0].preview_url, 'https://img/full/333.jpg');
  assert.equal(result.diagnostics.pageLoadMode, 'community-sequence-page');
  assert.equal(result.diagnostics.detailMode, 'blocking-for-preview');
  assert.equal(detailsCalls, 1);
});

test('community order mode reports unavailable instead of falling back to alternate order', async () => {
  const service = createService({
    get: async () => Buffer.from('<html><body>captcha</body></html>'),
  });

  const result = await service.search({ appid: 431960, query_type: 1, page: 1, numperpage: 30 });

  assert.equal(result.source, 'community-order-unavailable');
  assert.equal(result.warningCode, 'COMMUNITY_ORDER_UNAVAILABLE');
  assert.deepEqual(result.response.publishedfiledetails, []);
});

test('community order mode fills UI page size from Steam community page sequence', async () => {
  const requestedUrls = [];
  const service = createService({
    get: async (url) => {
      requestedUrls.push(url);
      const page = Number(new URL(url).searchParams.get('p'));
      const start = (page - 1) * 50;
      const ids = Array.from({ length: 50 }, (_, index) => String(start + index + 1));
      return communityJsonPage(ids, page);
    },
  });

  const result = await service.search({ appid: 431960, query_type: 1, page: 1, numperpage: 50, days: 30, 'requiredtags[0]': 'Video', 'requiredtags[1]': 'Everyone' });
  const parsedUrls = requestedUrls.map(url => new URL(url));

  assert.deepEqual(parsedUrls.map(url => url.searchParams.get('p')), ['1']);
  assert.deepEqual(parsedUrls.map(url => url.searchParams.get('num_per_page')), ['50']);
  assert.deepEqual(parsedUrls[0].searchParams.getAll('requiredtags[]'), ['Video', 'Everyone']);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), Array.from({ length: 50 }, (_, index) => String(index + 1)));
  assert.equal(result.response.publishedfiledetails.length, 50);
  assert.equal(result.diagnostics.requestedCommunityPage, 1);
  assert.equal(result.diagnostics.requestedCommunityPageSize, 50);
  assert.equal(result.diagnostics.effectiveCommunityPageSize, 50);
  assert.equal(result.diagnostics.firstCommunityPage, 1);
  assert.equal(result.diagnostics.firstCommunitySkip, 0);
});

test('community order mode maps following UI pages without overlap', async () => {
  const requestedPages = [];
  const service = createService({
    get: async (url) => {
      const page = Number(new URL(url).searchParams.get('p'));
      requestedPages.push(page);
      const start = (page - 1) * 50;
      return communityJsonPage(Array.from({ length: 50 }, (_, index) => String(start + index + 1)), page);
    },
  });

  const result = await service.search({ appid: 431960, query_type: 1, page: 2, numperpage: 50, days: 30 });

  assert.deepEqual(requestedPages, [2]);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), Array.from({ length: 50 }, (_, index) => String(index + 51)));
  assert.equal(result.diagnostics.firstCommunityPage, 2);
  assert.equal(result.diagnostics.firstCommunitySkip, 0);
});

test('community order mode uses Steam num_per_page for 50-card UI pages', async () => {
  const requestedPageSizes = [];
  const service = createService({
    get: async (url) => {
      const page = Number(new URL(url).searchParams.get('p'));
      requestedPageSizes.push(Number(new URL(url).searchParams.get('num_per_page')));
      const start = (page - 1) * 50;
      return communityJsonPage(Array.from({ length: 50 }, (_, index) => String(start + index + 1)), page);
    },
  });

  await service.search({ appid: 431960, query_type: 1, page: 1, numperpage: 50 });

  assert.deepEqual(requestedPageSizes, [50]);
});

test('community order mode uses Steam community page count instead of accessible cap', async () => {
  const service = createService({
    get: async () => communityHtmlPage(Array.from({ length: 50 }, (_, index) => String(index + 1)), 1, 35),
  });

  const result = await service.search({ appid: 431960, query_type: 1, page: 1, numperpage: 50, days: 30, 'requiredtags[0]': 'Video', 'requiredtags[1]': 'Everyone' });

  assert.equal(result.totalPages, 35);
  assert.equal(result.response.totalPages, 35);
});

test('community order mode reads Steam React Query total_pages before DOM fallback', async () => {
  const service = createService({
    get: async () => communityReactQueryPage(Array.from({ length: 50 }, (_, index) => String(index + 1)), 1, 35),
  });

  const result = await service.search({ appid: 431960, query_type: 1, page: 1, numperpage: 50, days: 30, 'requiredtags[0]': 'Video', 'requiredtags[1]': 'Everyone', 'requiredtags[2]': 'Approved' });

  assert.equal(result.totalPages, 35);
  assert.equal(result.total, 1732);
  assert.equal(result.response.publishedfiledetails.length, 50);
});

test('community order mode keeps detail tag mismatches shown on the community page', async () => {
  const service = createService({
    get: async () => communityJsonPage(['3297052752', '12021']),
    getFileDetailsSafe: async (ids) => ids.map(id => ({
      result: 1,
      publishedfileid: id,
      title: `Detail ${id}`,
      tags: id === '3297052752' ? [{ tag: 'Application' }, { tag: 'Everyone' }] : [{ tag: 'Video' }, { tag: 'Everyone' }],
    })),
  });

  const result = await service.search({ appid: 431960, query_type: 1, page: 1, numperpage: 2, 'requiredtags[0]': 'Video', 'requiredtags[1]': 'Everyone' });

  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['3297052752', '12021']);
});

test('community order mode does not fold similar same-author items', async () => {
  const service = createService({
    get: async () => communityJsonPage(['3742539656', '3742539657', '3742539658']),
    getFileDetailsSafe: async (ids) => ids.map(id => ({
      result: 1,
      publishedfileid: id,
      creator: 'same-author',
      title: id === '3742539656' ? 'LOVE ME UMAMUSUME (Orchestral Version)' : 'LOVE ME [UMAMUSUME]',
      preview_url: `https://img/full/${id}.jpg`,
      tags: [{ tag: 'Everyone' }],
    })),
  });

  const result = await service.search({ appid: 431960, query_type: 1, page: 1, numperpage: 3, 'requiredtags[0]': 'Everyone' });

  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['3742539656', '3742539657', '3742539658']);
});

test('community order mode does not apply local rating_or filtering', async () => {
  const service = createService({
    get: async () => communityJsonPage(['100', '200']),
    getFileDetailsSafe: async (ids) => ids.map(id => ({
      result: 1,
      publishedfileid: id,
      title: `Detail ${id}`,
      tags: id === '100' ? [{ tag: 'Everyone' }] : [{ tag: 'Mature' }],
    })),
  });

  const result = await service.search({ appid: 431960, query_type: 1, page: 1, numperpage: 2, 'rating_or[0]': 'Everyone' });

  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['100', '200']);
  assert.equal(result.diagnostics.localFilterApplied, false);
});

test('multi-genre tag filtering follows the official Community URL and returns its ordered cards without blocking detail lookups', async () => {
  const requestedUrls = [];
  let detailsCalls = 0;
  const service = createService({
    get: async (url) => {
      requestedUrls.push(url);
      return communityJsonPage(['101', '102'], 1, 197387);
    },
    getFileDetailsSafe: async () => {
      detailsCalls += 1;
      return [];
    },
  });

  const result = await service.search({
    appid: 431960,
    query_type: 1,
    page: 1,
    numperpage: 2,
    community_tag_filter: 1,
    'requiredtags[0]': 'Everyone',
    'requiredtags[1]': 'Video',
    'genre_or[0]': 'Abstract',
    'genre_or[1]': 'Cartoon',
  });
  const parsed = new URL(requestedUrls[0]);

  assert.deepEqual(parsed.searchParams.getAll('requiredtags[]'), ['Everyone', 'Video']);
  assert.deepEqual(parsed.searchParams.getAll('excludedtags[]'), [
    'Animal', 'Anime', 'CGI', 'Cyberpunk', 'Fantasy', 'Game', 'Girls', 'Guys',
    'Landscape', 'Medieval', 'Memes', 'MMD', 'Music', 'Nature', 'Pixel art',
    'Relaxing', 'Retro', 'Sci-Fi', 'Sports', 'Technology', 'Television', 'Vehicle', 'Unspecified',
  ]);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['101', '102']);
  assert.equal(result.response.total, 197387);
  assert.equal(requestedUrls.length, 1);
  assert.equal(detailsCalls, 0);
  assert.equal(result.diagnostics.localFilterApplied, false);
});

test('tag filtering forces the official Community URL path even when Community order mode is disabled', async () => {
  const requestedUrls = [];
  const service = createService({
    useCommunityBrowseOrder: () => false,
    get: async (url) => {
      requestedUrls.push(url);
      return communityJsonPage(['901'], 1, 1);
    },
  });

  const result = await service.search({
    appid: 431960,
    query_type: 1,
    page: 1,
    numperpage: 1,
    community_tag_filter: 1,
    'requiredtags[0]': 'Everyone',
    'excludedtags[0]': 'Anime',
  });

  assert.equal(new URL(requestedUrls[0]).pathname, '/workshop/browse/');
  assert.deepEqual(new URL(requestedUrls[0]).searchParams.getAll('excludedtags[]'), ['Anime']);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['901']);
});

test('community order mode cache clearing does not reference removed boundary cache', () => {
  const service = createService();

  assert.doesNotThrow(() => service.clearInFlight());
  assert.doesNotThrow(() => service.clearCaches());
  assert.doesNotThrow(() => service.invalidateCaches());
});

test('normal scrape mode uses broad query for large genre OR sets instead of one request per tag', async () => {
  const requestedUrls = [];
  const service = createService({
    useCommunityBrowseOrder: () => false,
    get: async (url) => {
      requestedUrls.push(url);
      return communityHtmlPage(['101', '102', '103'], 1, 1);
    },
    getFileDetailsSafe: async (ids) => ids.map(id => ({
      result: 1,
      publishedfileid: id,
      title: `Detail ${id}`,
      preview_url: `https://img/full/${id}.jpg`,
      tags: id === '101' ? [{ tag: 'Abstract' }, { tag: 'Everyone' }] : [{ tag: 'Nature' }, { tag: 'Everyone' }],
    })),
  });

  const params = { appid: 431960, query_type: 1, page: 1, numperpage: 3, 'requiredtags[0]': 'Everyone' };
  ['Abstract', 'Cartoon', 'CGI', 'Cyberpunk', 'Game', 'Girls', 'Nature'].forEach((tag, index) => {
    params[`genre_or[${index}]`] = tag;
  });
  const result = await service.search(params);
  const parsed = new URL(requestedUrls[0]);

  assert.equal(requestedUrls.length, 1);
  assert.deepEqual(parsed.searchParams.getAll('requiredtags[]'), ['Everyone']);
  assert.deepEqual(result.response.publishedfiledetails.map(item => item.publishedfileid), ['101', '102', '103']);
});

test('normal scrape mode ignores Steam community cookie for public homepage', async () => {
  const requestedHeaders = [];
  const service = createService({
    useCommunityBrowseOrder: () => false,
    get: async (url, headers) => {
      requestedHeaders.push(headers || {});
      return Buffer.from([
        '<div id="workshopBrowseItems">',
        '<div class="workshopItem" data-publishedfileid="101">',
        '<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=101">',
        '<img class="workshopItemPreviewImage" src="https://img/101.jpg" alt="Item 101">',
        '<div class="workshopItemTitle">Item 101</div>',
        '</a>',
        '</div>',
        '</div>'
      ].join(''));
    },
  });

  const result = await service.search(
    { appid: 431960, query_type: 1, page: 1, numperpage: 1, 'requiredtags[0]': 'Everyone' },
    { steamCommunityCookie: 'steamLoginSecure=stale; sessionid=stale' }
  );

  assert.equal(result.response.publishedfiledetails.length, 1);
  assert.equal(requestedHeaders.length, 1);
  assert.equal(requestedHeaders[0].Cookie, undefined);
});

test('account dependent community filters require a Steam web session', async () => {
  const service = createService();

  await assert.rejects(
    () => service.search({ appid: 431960, page: 1, numperpage: 30, path: 'myfiles', browsefilter: 'myfavorites' }),
    (error) => error && error.code === 'STEAM_WEB_LOGIN_REQUIRED' && error.requiresSteamLogin === true
  );
  await assert.rejects(
    () => service.search({ appid: 431960, page: 1, numperpage: 30, special_filter: 2 }),
    (error) => error && error.code === 'STEAM_WEB_LOGIN_REQUIRED' && error.requiresSteamLogin === true
  );
  await assert.rejects(
    () => service.search({ appid: 431960, page: 1, numperpage: 30, path: 'votingqueue' }),
    (error) => error && error.code === 'STEAM_WEB_LOGIN_REQUIRED' && error.requiresSteamLogin === true
  );
});

test('account dependent community filters reuse provided Steam web session cookie', async () => {
  const requested = [];
  const service = createService({
    get: async (url, headers) => {
      requested.push({ url, headers });
      return communityJsonPage(['901'], 1, 1);
    },
  });

  const result = await service.search(
    { appid: 431960, page: 1, numperpage: 1, path: 'myfiles', browsefilter: 'myfavorites' },
    { steamCommunityCookie: 'steamLoginSecure=valid; sessionid=valid' }
  );

  assert.equal(result.response.publishedfiledetails[0].publishedfileid, '901');
  assert.equal(new URL(requested[0].url).pathname, '/my/myworkshopfiles/');
  assert.equal(requested[0].headers.Cookie, 'steamLoginSecure=valid; sessionid=valid');
});

test('account dependent special filters use Steam community pages even when Steam API is enabled', async () => {
  const requested = [];
  const service = createService({
    getSteamApiKey: () => 'test-key',
    useSteamApi: () => true,
    useCommunityBrowseOrder: () => false,
    get: async (url, headers) => {
      requested.push({ url, headers });
      assert.equal(new URL(url).hostname, 'steamcommunity.com');
      return communityJsonPage(['902'], 1, 1);
    },
  });

  const result = await service.search(
    { appid: 431960, query_type: 1, page: 1, numperpage: 1, special_filter: 2, 'requiredtags[0]': 'Video' },
    { steamCommunityCookie: 'steamLoginSecure=valid; sessionid=valid' }
  );

  assert.equal(result.response.publishedfiledetails[0].publishedfileid, '902');
  assert.equal(requested.length, 1);
  const url = new URL(requested[0].url);
  assert.equal(url.pathname, '/workshop/browse/');
  assert.equal(url.searchParams.get('special_filter'), '2');
  assert.equal(requested[0].headers.Cookie, 'steamLoginSecure=valid; sessionid=valid');
  assert.deepEqual(requested[0].headers.steamAccessRouteOptions, {
    requireApplicationProbe: true,
    connectionReuse: false,
    backgroundRefresh: true,
    maxAgeMs: 5 * 60 * 1000,
  });
});

test('account-dependent Community login redirect is reported as structured Steam web login expiry', async () => {
  const service = createService({
    get: async () => Buffer.from('<html><head><meta http-equiv="refresh" content="0;url=https://steamcommunity.com/login/home/"></head><body>Sign In</body></html>'),
  });

  await assert.rejects(
    () => service.search(
      { appid: 431960, page: 1, numperpage: 30, path: 'myfiles', browsefilter: 'myfavorites' },
      { steamCommunityCookie: 'steamLoginSecure=expired; sessionid=expired' }
    ),
    error => error && error.code === 'STEAM_WEB_LOGIN_REQUIRED' && error.requiresSteamLogin === true
  );
});
