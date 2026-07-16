'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { cacheControlForStaticPath, etagForStat } = require('./static');

test('static cache policy keeps the HTML shell revalidatable and hashes immutable', () => {
  assert.equal(cacheControlForStaticPath('/index.html'), 'no-cache');
  assert.equal(cacheControlForStaticPath('/assets/index-abc123.js'), 'public, max-age=31536000, immutable');
  assert.equal(cacheControlForStaticPath('/favicon.svg'), 'public, max-age=3600');
});

test('static ETags are stable for a file stat snapshot', () => {
  assert.equal(etagForStat({ size: 4096, mtimeMs: 12345.9 }), 'W/"1000-3039"');
});
