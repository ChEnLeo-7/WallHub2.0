'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCommunityWorkshopBrowseUrl,
  buildSteamCmQueryInput,
  buildSteamApiQueryInput,
  buildSteamApiQueryUrl,
  buildSteamUserFilesInput,
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

test('Community all-time popularity follows the Steam page by switching to top rated', () => {
  for (const days of [0, -1]) {
    const parsed = new URL(buildCommunityWorkshopBrowseUrl({
      appid: 431960,
      query_type: 1,
      page: 1,
      numperpage: 30,
      days,
    }));

    assert.equal(parsed.searchParams.get('browsesort'), 'toprated');
    assert.equal(parsed.searchParams.has('days'), false);
    assert.equal(parsed.searchParams.has('actualsort'), false);
  }
});

test('Community text searches use the Steam page relevance sort without legacy parameters', () => {
  const parsed = new URL(buildCommunityWorkshopBrowseUrl({
    appid: 431960,
    browsesort: 'textsearch',
    search_text: 'city rain',
    page: 1,
    numperpage: 30,
  }));

  assert.equal(parsed.searchParams.get('browsesort'), 'textsearch');
  assert.equal(parsed.searchParams.get('searchtext'), 'city rain');
  assert.equal(parsed.searchParams.has('actualsort'), false);
});

test('Community trend text searches preserve the selected time window', () => {
  const parsed = new URL(buildCommunityWorkshopBrowseUrl({
    appid: 431960,
    query_type: 1,
    search_text: 'city rain',
    page: 1,
    numperpage: 30,
    days: 7,
  }));

  assert.equal(parsed.searchParams.get('browsesort'), 'trend');
  assert.equal(parsed.searchParams.get('searchtext'), 'city rain');
  assert.equal(parsed.searchParams.get('days'), '7');
});

test('community browse URL maps the complete selected tag list into one Steam request', () => {
  const url = buildCommunityWorkshopBrowseUrl({
    appid: 431960,
    query_type: 1,
    page: 4,
    numperpage: 50,
    days: 30,
    'requiredtags[0]': 'Everyone',
    'requiredtags[1]': 'Video',
    'requiredtags[2]': 'Scene',
    'requiredtags[3]': 'Questionable',
    'requiredtags[4]': 'Anime',
    'requiredtags[5]': 'Nature',
    'requiredtags[6]': 'Approved',
    'requiredtags[7]': 'HDR',
    'requiredtags[8]': '1920 x 1080',
    'requiredtags[9]': '3440 x 1440',
  });
  const parsed = new URL(url);

  assert.equal(parsed.searchParams.get('num_per_page'), '50');
  assert.equal(parsed.searchParams.get('numperpage'), null);
  assert.equal(parsed.searchParams.get('p'), '4');
  assert.deepEqual(parsed.searchParams.getAll('requiredtags[]'), [
    'Everyone', 'Video', 'Scene', 'Questionable', 'Anime', 'Nature', 'Approved', 'HDR', '1920 x 1080', '3440 x 1440',
  ]);
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
  assert.equal(parsed.searchParams.has('actualsort'), false);
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
    'excludedtags[0]': 'Standard Definition',
  });
  const parsed = new URL(url);

  assert.equal(parsed.pathname, '/my/myworkshopfiles/');
  assert.equal(parsed.searchParams.get('browsefilter'), 'mysubscriptions');
  assert.equal(parsed.searchParams.get('numperpage'), '30');
  assert.deepEqual(parsed.searchParams.getAll('requiredtags[]'), ['Video']);
  assert.deepEqual(parsed.searchParams.getAll('excludedtags[]'), ['Standard Definition']);
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

test('buildSteamApiQueryInput preserves the trend window without narrowing candidates to recent votes', () => {
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
  assert.equal(input.match_all_tags, true);
  assert.equal(input.days, 30);
  assert.equal(Object.hasOwn(input, 'include_recent_votes_only'), false);
  assert.deepEqual(input.requiredtags, ['Everyone']);
  assert.equal(input.return_metadata, true);
  assert.equal(input.return_vote_data, true);
});

test('Steam QueryFiles forwards an explicit match-any tag request', () => {
  const input = buildSteamApiQueryInput({
    appid: 431960,
    match_all_tags: false,
    'requiredtags[0]': 'Ultrawide 2560 x 1080',
    'requiredtags[1]': 'Ultrawide 3440 x 1440',
  });
  const url = new URL(buildSteamApiQueryUrl('test-key', {
    appid: 431960,
    match_all_tags: false,
    'requiredtags[0]': 'Ultrawide 2560 x 1080',
    'requiredtags[1]': 'Ultrawide 3440 x 1440',
  }));

  assert.equal(input.match_all_tags, false);
  assert.equal(JSON.parse(url.searchParams.get('input_json')).match_all_tags, false);
});

test('title-only mobile queries carry the official target and KV tag through Web API and CM', () => {
  const params = {
    appid: 431960,
    search_text: 'city rain',
    search_text_target: 1,
    mobile_compatible: 1,
  };
  const cm = buildSteamCmQueryInput(params);
  const url = new URL(buildSteamApiQueryUrl('test-key', params));
  const input = JSON.parse(url.searchParams.get('input_json'));

  assert.equal(cm.search_text_target, 1);
  assert.deepEqual(cm.required_kv_tags, [{ key: 'app_workshop_eula_version', value: '3' }]);
  assert.equal(input.search_text_target, 1);
  assert.deepEqual(input.required_kv_tags, [{ key: 'app_workshop_eula_version', value: '3' }]);
  assert.equal(url.searchParams.get('required_kv_tags[0][key]'), null);
});

test('friend and followed filters map to official QueryFiles query types', () => {
  assert.equal(buildSteamApiQueryInput({ special_filter: 2 }).query_type, 4);
  assert.equal(buildSteamApiQueryInput({ special_filter: 3 }).query_type, 5);
  assert.equal(buildSteamApiQueryInput({ special_filter: 4 }).query_type, 7);

  const url = new URL(buildSteamApiQueryUrl('test-key', { appid: 431960, special_filter: 4 }));
  assert.equal(JSON.parse(url.searchParams.get('input_json')).query_type, 7);
  assert.equal(url.searchParams.has('special_filter'), false);
});

test('Steam CM public queries preserve the selected ranking, trend window, search, and tags', () => {
  const input = buildSteamCmQueryInput({
    appid: 431960,
    query_type: 1,
    page: 2,
    numperpage: 50,
    search_text: 'city rain',
    days: 7,
    language: 'schinese',
    'requiredtags[0]': 'Video',
    'excludedtags[0]': 'Mature',
  });

  assert.equal(input.operation, 'query-files');
  assert.equal(input.query_type, 3);
  assert.equal(input.search_text, 'city rain');
  assert.equal(input.days, 7);
  assert.equal(input.language, 6);
  assert.deepEqual(input.requiredtags, ['Video']);
  assert.deepEqual(input.excludedtags, ['Mature']);
});

test('Steam search text does not replace non-trend ranking choices', () => {
  assert.equal(buildSteamCmQueryInput({ query_type: 0, search_text: 'city' }).query_type, 0);
  assert.equal(buildSteamCmQueryInput({ query_type: 2, search_text: 'city' }).query_type, 1);
  assert.equal(buildSteamCmQueryInput({ query_type: 11, search_text: 'city' }).query_type, 11);
  assert.equal(buildSteamCmQueryInput({ query_type: 16, search_text: 'city' }).query_type, 9);
});

test('Steam query language falls back to English for unknown values', () => {
  assert.equal(buildSteamCmQueryInput({ language: 'english' }).language, 0);
  assert.equal(buildSteamCmQueryInput({ language: 'unsupported' }).language, 0);
});

test('Steam CM author queries use GetUserFiles for the requested SteamID', () => {
  const input = buildSteamCmQueryInput({
    appid: 431960,
    creator: '76561198000000001',
    page: 3,
    numperpage: 30,
    sortmethod: 'creationorder',
    'requiredtags[0]': 'Scene',
  });

  assert.equal(input.operation, 'user-files');
  assert.equal(input.steamid, '76561198000000001');
  assert.equal(input.type, 'myfiles');
  assert.equal(input.sortmethod, 'creationorder');
  assert.deepEqual(input.requiredtags, ['Scene']);
});

test('Steam user list queries map subscriptions, favorites, and votes without a fake SteamID', () => {
  for (const browsefilter of ['mysubscriptions', 'myfavorites', 'myvotes']) {
    const input = buildSteamUserFilesInput({ appid: 431960, browsefilter });
    assert.equal(input.operation, 'user-files');
    assert.equal(input.type, browsefilter);
    assert.equal(Object.hasOwn(input, 'steamid'), false);
  }
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
  const input = JSON.parse(parsed.searchParams.get('input_json'));
  assert.equal(parsed.host, 'api.steampowered.com');
  assert.equal(parsed.searchParams.get('key'), 'test-key');
  assert.equal(input.query_type, 3);
  assert.equal(input.search_text, '极客湾');
  assert.equal(requests[0].headers['x-webapi-key'], 'test-key');
  assert.deepEqual(result.ids, ['100000']);
});

test('Steam Web API ignores removed legacy fan-in arguments', async () => {
  const requests = [];
  const result = await queryWorkshopBySteamApi('test-key', {
    appid: 431960,
    query_type: 1,
    page: 1,
    numperpage: 30,
    'requiredtags[0]': 'Approved',
    'genre_or[0]': 'Anime',
    'genre_or[1]': 'Nature',
  }, ['anime', 'nature'], {
    logger: { log() {}, warn() {} },
    get: async (url) => {
      requests.push(url);
      return Buffer.from(JSON.stringify({ response: {
        total: 3,
        publishedfiledetails: [
          { result: 1, publishedfileid: '202', title: 'Nature' },
          { result: 1, publishedfileid: '303', title: 'Sports' },
          { result: 1, publishedfileid: '101', title: 'Anime' },
        ],
      } }));
    },
  });

  assert.equal(requests.length, 1);
  const parsed = new URL(requests[0]);
  const input = JSON.parse(parsed.searchParams.get('input_json'));
  assert.equal(input.match_all_tags, true);
  assert.deepEqual(input.requiredtags, ['Approved']);
  assert.deepEqual(result.ids, ['202', '303', '101']);
  assert.equal(result.totalCount, 3);
});
