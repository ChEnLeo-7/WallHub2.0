'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CONTENT_RATING_TAG_LIST,
  STEAM_RESOLUTION_TAG_LIST,
  WORKSHOP_CATEGORY_TAG_LIST,
  WORKSHOP_GENRE_TAG_LIST,
  WORKSHOP_TYPE_TAG_LIST,
} = require('./filterCatalog');
const {
  collectArrayLikeParams,
  sanitizeWorkshopQueryParams,
} = require('./filters');

function tags(params, name) {
  return collectArrayLikeParams(params, name);
}

function groupExclusions(params, catalog) {
  return tags(params, 'excludedtags').filter(tag => catalog.includes(tag));
}

test('official tag groups become fixed-order unselected complements', () => {
  const params = sanitizeWorkshopQueryParams({
    'requiredtags[0]': 'Approved',
    'type_or[0]': 'Scene',
    'type_or[1]': 'Video',
    'rating_or[0]': 'Everyone',
    'rating_or[1]': 'Questionable',
    'genre_or[0]': 'Anime',
    'genre_or[1]': 'Nature',
    'category_or[0]': 'Wallpaper',
    'resolution_or[0]': '2560 x 1080',
    'resolution_or[1]': '3440 x 1440',
  }, true, 'cm');

  assert.deepEqual(tags(params, 'requiredtags'), ['Wallpaper', 'Approved']);
  assert.deepEqual(groupExclusions(params, WORKSHOP_TYPE_TAG_LIST), ['Web', 'Application']);
  assert.deepEqual(groupExclusions(params, CONTENT_RATING_TAG_LIST), ['Mature']);
  assert.deepEqual(groupExclusions(params, WORKSHOP_GENRE_TAG_LIST), WORKSHOP_GENRE_TAG_LIST.filter(tag => !['Anime', 'Nature'].includes(tag)));
  assert.deepEqual(groupExclusions(params, WORKSHOP_CATEGORY_TAG_LIST), ['Preset']);
  assert.deepEqual(groupExclusions(params, STEAM_RESOLUTION_TAG_LIST), STEAM_RESOLUTION_TAG_LIST.filter(tag => ![
    'Ultrawide 2560 x 1080',
    'Ultrawide 3440 x 1440',
  ].includes(tag)));
});

test('complete group selections remain unrestricted while fixed product exclusions remain active', () => {
  const input = { 'excludedtags[0]': 'Application' };
  WORKSHOP_TYPE_TAG_LIST.forEach((tag, index) => { input[`type_or[${index}]`] = tag; });
  CONTENT_RATING_TAG_LIST.forEach((tag, index) => { input[`rating_or[${index}]`] = tag; });
  WORKSHOP_GENRE_TAG_LIST.forEach((tag, index) => { input[`genre_or[${index}]`] = tag; });
  WORKSHOP_CATEGORY_TAG_LIST.forEach((tag, index) => { input[`category_or[${index}]`] = tag; });
  STEAM_RESOLUTION_TAG_LIST.forEach((tag, index) => { input[`resolution_or[${index}]`] = tag; });

  const params = sanitizeWorkshopQueryParams(input, true, 'webapi');

  assert.deepEqual(tags(params, 'requiredtags'), ['Wallpaper']);
  assert.deepEqual(tags(params, 'excludedtags'), ['Application', 'Preset']);
  assert.ok(!Object.keys(params).some(key => /_or(?:\[\d+\])?$/.test(key)));
});

test('legacy required group tags are normalized into the same complement model', () => {
  const params = sanitizeWorkshopQueryParams({
    'requiredtags[0]': 'Everyone',
    'requiredtags[1]': 'Video',
    'requiredtags[2]': '3440 x 1440',
    'requiredtags[3]': 'HDR',
  }, true, 'community');

  assert.deepEqual(tags(params, 'requiredtags'), ['Wallpaper', 'HDR']);
  assert.deepEqual(groupExclusions(params, WORKSHOP_TYPE_TAG_LIST), ['Scene', 'Web', 'Application']);
  assert.deepEqual(groupExclusions(params, CONTENT_RATING_TAG_LIST), ['Questionable', 'Mature']);
  assert.equal(groupExclusions(params, STEAM_RESOLUTION_TAG_LIST).length, STEAM_RESOLUTION_TAG_LIST.length - 1);
  assert.equal(groupExclusions(params, STEAM_RESOLUTION_TAG_LIST).includes('Ultrawide 3440 x 1440'), false);
});

test('explicit Utility exclusions are preserved and deduplicated with complements', () => {
  const params = sanitizeWorkshopQueryParams({
    'resolution_or[0]': '3440 x 1440',
    'excludedtags[0]': 'HDR',
    'excludedtags[1]': 'Standard',
    'excludedtags[2]': 'Standard Definition',
  }, true, 'cm');
  const excluded = tags(params, 'excludedtags');

  assert.equal(excluded.filter(tag => tag === 'Standard Definition').length, 1);
  assert.equal(excluded.includes('HDR'), true);
  assert.equal(excluded.includes('Ultrawide 3440 x 1440'), false);
  assert.equal(groupExclusions(params, STEAM_RESOLUTION_TAG_LIST).length, STEAM_RESOLUTION_TAG_LIST.length - 1);
});

test('Preset requests are normalized back to Wallpaper-only results', () => {
  const params = sanitizeWorkshopQueryParams({ 'category_or[0]': 'Preset' }, true, 'cm');

  assert.deepEqual(groupExclusions(params, WORKSHOP_CATEGORY_TAG_LIST), ['Preset']);
  assert.ok(!Object.keys(params).some(key => /^category_or/.test(key)));
});

test('mobile compatibility is source-aware and keeps title-only search off Community', () => {
  for (const source of ['webapi', 'cm']) {
    const params = sanitizeWorkshopQueryParams({ mobile_compatible: 1, search_text_target: 1 }, true, source);
    assert.equal(params.mobile_compatible, 1);
    assert.equal(params.search_text_target, 1);
    assert.ok(tags(params, 'excludedtags').includes('Application'));
    assert.ok(tags(params, 'excludedtags').includes('Web'));
  }

  const community = sanitizeWorkshopQueryParams({ mobile_compatible: 1, search_text_target: 1 }, true, 'community');
  assert.equal(community.mobile_compatible, undefined);
  assert.equal(community.search_text_target, undefined);
});

test('equivalent Utility selections normalize to identical ordered cache fields', () => {
  const left = sanitizeWorkshopQueryParams({
    'requiredtags[0]': 'HDR',
    'requiredtags[1]': 'Approved',
    'excludedtags[0]': 'Customizable',
    'excludedtags[1]': '3D',
  }, true, 'cm');
  const right = sanitizeWorkshopQueryParams({
    'requiredtags[0]': 'Approved',
    'requiredtags[1]': 'HDR',
    'excludedtags[0]': '3D',
    'excludedtags[1]': 'Customizable',
  }, true, 'cm');

  assert.deepEqual(left, right);
  assert.deepEqual(tags(left, 'requiredtags'), ['Wallpaper', 'Approved', 'HDR']);
  assert.deepEqual(tags(left, 'excludedtags'), ['Preset', '3D', 'Customizable']);
});
