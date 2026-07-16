'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildCommunityWorkshopBrowseUrl,
  buildWorkshopBrowseUrl,
  buildSteamApiQueryInput,
  buildSteamApiQueryUrl,
  normalizeSteamWebApiBaseUrl,
  queryWorkshopBySteamApi,
} = require('./query');

test('top rated sort maps to Steam query type 0 and browse sort', () => {
  const input = buildSteamApiQueryInput({
    appid: 431960,
    query_type: 0,
    page: 1,
    numperpage: 30,
  });
  const url = buildWorkshopBrowseUrl({
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

test('community URL routes account favorites through my workshop files', () => {
  const url = buildCommunityWorkshopBrowseUrl({ appid: 431960, page: 2, numperpage: 50, path: 'myfiles', browsefilter: 'myfavorites' });
  const parsed = new URL(url);

  assert.equal(parsed.pathname, '/my/myworkshopfiles/');
  assert.equal(parsed.searchParams.get('appid'), '431960');
  assert.equal(parsed.searchParams.get('p'), '2');
  assert.equal(parsed.searchParams.get('numperpage'), '50');
  assert.equal(parsed.searchParams.get('browsefilter'), 'myfavorites');
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

test('buildSteamApiQueryInput uses official service fields', () => {
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
});

test('buildSteamApiQueryUrl uses compatible flat QueryFiles params', () => {
  const url = buildSteamApiQueryUrl('test-key', {
    appid: 431960,
    query_type: 1,
    page: 1,
    numperpage: 30,
    days: 30,
    'requiredtags[0]': 'Everyone',
  });

  const parsed = new URL(url);
  assert.equal(parsed.pathname, '/IPublishedFileService/QueryFiles/v1/');
  assert.equal(parsed.searchParams.get('key'), 'test-key');
  assert.equal(parsed.searchParams.get('input_json'), null);
  assert.equal(parsed.searchParams.get('creator_appid'), '431960');
  assert.equal(parsed.searchParams.get('appid'), '431960');
  assert.equal(parsed.searchParams.get('filetype'), '0');
  assert.equal(parsed.searchParams.get('days'), '30');
  assert.equal(parsed.searchParams.get('requiredtags[0]'), 'Everyone');
});

test('buildSteamApiQueryUrl supports custom WebAPI base URL', () => {
  const httpUrl = buildSteamApiQueryUrl('test-key', { appid: 431960 }, '', '', 'http://api.steampowered.com');
  assert.equal(new URL(httpUrl).origin, 'http://api.steampowered.com');
  assert.equal(normalizeSteamWebApiBaseUrl('ftp://bad'), 'https://api.steampowered.com');
});

test('queryWorkshopBySteamApi sends key and flat QueryFiles params', async () => {
  let capturedUrl = '';
  let capturedHeaders = null;
  const result = await queryWorkshopBySteamApi('test-key', {
    appid: 431960,
    query_type: 1,
    page: 1,
    numperpage: 30,
    'requiredtags[0]': 'Everyone',
  }, [], {
    get: async (url, headers) => {
      capturedUrl = url;
      capturedHeaders = headers;
      return Buffer.from(JSON.stringify({
        response: {
          total: 1,
          publishedfiledetails: [{ result: 1, publishedfileid: '123' }],
        },
      }));
    },
  });

  const parsed = new URL(capturedUrl);
  assert.equal(parsed.pathname, '/IPublishedFileService/QueryFiles/v1/');
  assert.equal(parsed.searchParams.get('key'), 'test-key');
  assert.equal(parsed.searchParams.get('input_json'), null);
  assert.equal(capturedHeaders['x-webapi-key'], 'test-key');
  assert.equal(parsed.searchParams.get('creator_appid'), '431960');
  assert.equal(parsed.searchParams.get('requiredtags[0]'), 'Everyone');
  assert.deepEqual(result.ids, ['123']);
});
