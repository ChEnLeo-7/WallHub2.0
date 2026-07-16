'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { pruneWorkshopCache } = require('./workshopCache');

test('pruneWorkshopCache removes expired entries before enforcing its bounded capacity', () => {
  const cache = new Map([
    ['expired', { cachedAt: 1 }],
    ['oldest', { cachedAt: 900 }],
    ['middle', { cachedAt: 950 }],
    ['newest', { cachedAt: 990 }],
  ]);

  pruneWorkshopCache(cache, { now: 1_000, ttlMs: 50, maxEntries: 2 });

  assert.deepEqual([...cache.keys()], ['middle', 'newest']);
});

test('pruneWorkshopCache does not evict fresh entries below capacity', () => {
  const cache = new Map([
    ['first', { cachedAt: 990 }],
    ['second', { cachedAt: 995 }],
  ]);

  pruneWorkshopCache(cache, { now: 1_000, ttlMs: 50, maxEntries: 2 });

  assert.deepEqual([...cache.keys()], ['first', 'second']);
});
