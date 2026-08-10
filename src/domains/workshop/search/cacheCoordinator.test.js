'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { queryCacheKey } = require('./cacheCoordinator');

test('Workshop cache keys isolate configured Steam data sources', () => {
  const params = { appid: 431960, page: 1 };
  const community = queryCacheKey(params, false, 'community');
  const webapi = queryCacheKey(params, false, 'webapi');
  const cm = queryCacheKey(params, false, 'cm');

  assert.notEqual(community, webapi);
  assert.notEqual(community, cm);
  assert.equal(community.includes('test-key'), false);
});
