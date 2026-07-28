'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCommunityWorkshopBrowseUrl,
  buildSteamApiQueryInput,
  buildSteamApiQueryUrl,
  queryWorkshopBySteamApi,
  scrapeWorkshopIds,
  normalizePersonalSortMethod,
} = require('./query');

test('top rated sort maps to Steam query type 0 and browse sort', () => {
  const input = buildSteamApiQueryInput({
    appid: 431960,
    query_type: 0,
    page: 1,
    numperpage: 30,
  });
  const url = buildCommunityWorkshopBrowseUrl({
    appid: 431960,
    query_type: 0,
    page: 1,
    numperpage: 30,
  });

  assert.equal(input.query_type, 0);
  assert.equal(new URL(url).searchParams.get('browsesort'), 'toprated');
  assert.equal(new URL(url).searchParams.get('num_per_page'), '30');
  assert.equal(new URL(url).searchParams.get('numperpage'), null);
});

test('community browse URL uses Steam num_per_page parameter', () => {
  const url = buildCommunityWorkshopBrowseUrl({
    appid: 431960,
    query_type: 1,
    page: 1,
    numperpage: 50,
    days: 30,
    'requiredtags[0]': 'Everyone',
    'requiredtags[1]': 'Video',
  });
  const parsed = new URL(url);

  assert.equal(parsed.searchParams.get('num_per_page'), '50');
  assert.equal(parsed.searchParams.get('numperpage'), null);
  assert.deepEqual(parsed.searchParams.getAll('requiredtags[]'), ['Everyone', 'Video']);
});

test('public Workshop scrape retries transient curl failures through the native HTTP path', async () => {
  const attempts = [];
  const result = await scrapeWorkshopIds({ appid: 431960, page: 1, numperpage: 30 }, {
    logger: { log() {}, warn() {} },
    get: async (_url, headers) => {
      attempts.push(headers);
      if (attempts.length === 1) throw new Error('curl: (56) Failure when receiving data from the peer');
      return Buffer.from('<div class="workshopItem" data-publishedfileid="100000"><div class="workshopItemTitle">One</div></div>');
    },
  });

  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].wallhubDisableCurlProxy, undefined);
  assert.equal(attempts[1].wallhubDisableCurlProxy, true);
  assert.deepEqual(result.ids, ['100000']);
});

test('community URL routes account favorites through my workshop files', () => {
  const url = buildCommunityWorkshopBrowseUrl({ appid: 431960, page: 2, numperpage: 50, path: 'myfiles', browsefilter: 'myfavorites', sortmethod: 'alpha' });
  const parsed = new URL(url);

  assert.equal(parsed.pathname, '/my/myworkshopfiles/');
  assert.equal(parsed.searchParams.get('appid'), '431960');
  assert.equal(parsed.searchParams.get('p'), '2');
  assert.equal(parsed.searchParams.get('numperpage'), '50');
  assert.equal(parsed.searchParams.get('browsefilter'), 'myfavorites');
  assert.equal(parsed.searchParams.get('sortmethod'), 'alpha');
});

test('personal sort methods are restricted to Steam-supported values', () => {
  assert.equal(normalizePersonalSortMethod(' CREATIONORDER '), 'creationorder');
  assert.equal(normalizePersonalSortMethod('unknown'), 'lastupdated');

  const url = buildCommunityWorkshopBrowseUrl({ appid: 431960, page: 1, numperpage: 30, special_filter: 4, sortmethod: 'creationorder' });
  const parsed = new URL(url);
  assert.equal(parsed.searchParams.get('browsesort'), 'creationorder');
  assert.equal(parsed.searchParams.get('actualsort'), 'creationorder');
});

test('community URL routes voted filter through my workshop files votes list', () => {
  const url = buildCommunityWorkshopBrowseUrl({ appid: 431960, page: 3, numperpage: 30, path: 'myfiles', browsefilter: 'myvotes' });
  const parsed = new URL(url);

  assert.equal(parsed.pathname, '/my/myworkshopfiles/');
  assert.equal(parsed.searchParams.get('appid'), '431960');
  assert.equal(parsed.searchParams.get('p'), '3');
  assert.equal(parsed.searchParams.get('browsefilter'), 'myvotes');
});

test('community URL keeps friend and followed account filters as special_filter', () => {
  const url = buildCommunityWorkshopBrowseUrl({ appid: 431960, query_type: 1, page: 1, numperpage: 30, special_filter: 4 });
  const parsed = new URL(url);

  assert.equal(parsed.pathname, '/workshop/browse/');
  assert.equal(parsed.searchParams.get('special_filter'), '4');
});

test('community URL routes personal subscriptions to the authenticated workshop list', () => {
  const url = buildCommunityWorkshopBrowseUrl({
    appid: 431960,
    page: 2,
    numperpage: 30,
    path: 'myfiles',
    browsefilter: 'mysubscriptions',
    'requiredtags[0]': 'Video',
  });
  const parsed = new URL(url);

  assert.equal(parsed.pathname, '/my/myworkshopfiles/');
  assert.equal(parsed.searchParams.get('browsefilter'), 'mysubscriptions');
  assert.equal(parsed.searchParams.get('numperpage'), '30');
  assert.deepEqual(parsed.searchParams.getAll('requiredtags[]'), ['Video']);
});

test('community URL uses the signed-in Steam profile for personal subscriptions when available', () => {
  const url = buildCommunityWorkshopBrowseUrl({
    appid: 431960,
    page: 1,
    numperpage: 30,
    path: 'myfiles',
    browsefilter: 'mysubscriptions',
    steamid: '76561198000000001',
  });
  const parsed = new URL(url);

  assert.equal(parsed.pathname, '/profiles/76561198000000001/myworkshopfiles/');
  assert.equal(parsed.searchParams.get('browsefilter'), 'mysubscriptions');
});

test('buildSteamApiQueryInput uses the legacy Web API fields', () => {
  const input = buildSteamApiQueryInput({
    appid: 431960,
    query_type: 1,
    page: 1,
    numperpage: 30,
    days: 30,
    'requiredtags[0]': 'Everyone',
  });

  assert.equal(input.query_type, 3);
  assert.equal(input.creator_appid, 431960);
  assert.equal(input.appid, 431960);
  assert.equal(input.filetype, 0);
  assert.equal(input.days, 30);
  assert.equal(input.include_recent_votes_only, true);
  assert.deepEqual(input.requiredtags, ['Everyone']);
  assert.equal(input.return_metadata, true);
  assert.equal(input.return_vote_data, true);
});

test('Steam Web API query includes the configured key and does not need Community browsing', async () => {
  const requests = [];
  const result = await queryWorkshopBySteamApi('test-key', {
    appid: 431960,
    query_type: 1,
    page: 1,
    numperpage: 30,
    search_text: '极客湾',
  }, [], {
    get: async (url, headers) => {
      requests.push({ url, headers });
      return Buffer.from(JSON.stringify({ response: {
        total: 1,
        publishedfiledetails: [{ result: 1, publishedfileid: '100000', title: 'Geekwan' }],
      } }));
    },
  });

  const parsed = new URL(requests[0].url);
  assert.equal(parsed.host, 'api.steampowered.com');
  assert.equal(parsed.searchParams.get('key'), 'test-key');
  assert.equal(parsed.searchParams.get('query_type'), '12');
  assert.equal(parsed.searchParams.get('search_text'), '极客湾');
  assert.equal(requests[0].headers['x-webapi-key'], 'test-key');
  assert.deepEqual(result.ids, ['100000']);
});
