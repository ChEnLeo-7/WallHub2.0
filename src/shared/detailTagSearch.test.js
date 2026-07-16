'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const detailTagSearchPromise = import('../../frontend/src/lib/detailTagSearch.mjs');

test('detail tag search serializes a deduplicated tag selection into a visible query', async () => {
  const detailTagSearch = await detailTagSearchPromise;
  assert.equal(
    detailTagSearch.encodeDetailTagSearch([' Anime ', 'Video', 'Anime', '', 'Audio responsive']),
    'tag:Anime|Video|Audio responsive',
  );
});

test('detail tag search parses only the explicit tag query form and preserves multi-tag AND semantics', async () => {
  const detailTagSearch = await detailTagSearchPromise;
  assert.deepEqual(detailTagSearch.parseDetailTagSearch('tag:Anime|Video|Anime'), ['Anime', 'Video']);
  assert.deepEqual(detailTagSearch.parseDetailTagSearch('TAG: Audio responsive | 4K '), ['Audio responsive', '4K']);
  assert.deepEqual(detailTagSearch.parseDetailTagSearch('anime wallpaper'), []);
});
