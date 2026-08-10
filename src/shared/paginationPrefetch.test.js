const test = require('node:test');
const assert = require('node:assert/strict');

test('next-page prefetch is disabled unless the experimental option is enabled', async () => {
  const { getNextPagePrefetchPlan } = await import('../../frontend/src/lib/paginationPrefetch.mjs');
  assert.equal(getNextPagePrefetchPlan({ enabled: false, page: 1, totalPages: 3, alreadyCached: false }), null);
});

test('next-page prefetch plans only the immediate uncached following page', async () => {
  const { getNextPagePrefetchPlan } = await import('../../frontend/src/lib/paginationPrefetch.mjs');
  assert.deepEqual(
    getNextPagePrefetchPlan({ enabled: true, page: 2, totalPages: 5, alreadyCached: false }),
    { page: 3 },
  );
  assert.equal(getNextPagePrefetchPlan({ enabled: true, page: 5, totalPages: 5, alreadyCached: false }), null);
  assert.equal(getNextPagePrefetchPlan({ enabled: true, page: 2, totalPages: 5, alreadyCached: true }), null);
});
