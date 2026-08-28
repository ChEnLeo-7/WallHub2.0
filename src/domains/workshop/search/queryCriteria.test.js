'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createQueryCriteria } = require('./queryCriteria');

function item(id, tags) {
  return { publishedfileid: id, tags: tags.map(tag => ({ tag })) };
}

test('public wallpaper filtering rejects assets and entries without a recognized wallpaper type', () => {
  const criteria = createQueryCriteria({ 'requiredtags[0]': 'Wallpaper' }, true);
  const items = criteria.applyWallpaperPostFilters([
    item('video', ['Wallpaper', 'Video']),
    item('asset', ['Asset', 'Particle', 'Everyone']),
    item('unknown', ['Wallpaper', 'Everyone']),
  ]);

  assert.deepEqual(items.map(entry => entry.publishedfileid), ['video']);
});

test('public wallpaper filtering requires a selected type and keeps direct filtering unchanged', () => {
  const criteria = createQueryCriteria({
    'requiredtags[0]': 'Wallpaper',
    'excludedtags[0]': 'Scene',
    'excludedtags[1]': 'Web',
    'excludedtags[2]': 'Application',
  }, true);
  const candidates = [
    item('video', ['Wallpaper', 'Video']),
    item('scene', ['Wallpaper', 'Scene']),
  ];

  assert.deepEqual(criteria.applyWallpaperPostFilters(candidates).map(entry => entry.publishedfileid), ['video']);
  assert.deepEqual(criteria.applyPostFilters(candidates).map(entry => entry.publishedfileid), ['video', 'scene']);
});
