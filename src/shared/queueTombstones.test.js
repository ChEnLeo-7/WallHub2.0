'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

test('a delete tombstone hides an older queue snapshot but not an immediate same-id re-download', async () => {
  const { filterQueueTasksAfterDelete } = await import('../../frontend/src/lib/queueTombstones.mjs');
  const tombstones = new Map([
    ['3750175441', { deletedAt: 10_000, expiresAt: 25_000 }],
  ]);
  const staleTask = { id: '3750175441', addTime: 9_999, status: 'downloading' };
  const sameTickRequeuedTask = { id: '3750175441', addTime: 10_000, status: 'pending' };
  const requeuedTask = { id: '3750175441', addTime: 10_001, status: 'downloading' };

  assert.deepEqual(filterQueueTasksAfterDelete([staleTask], tombstones, 10_002), []);
  assert.deepEqual(filterQueueTasksAfterDelete([sameTickRequeuedTask], tombstones, 10_002), [sameTickRequeuedTask]);
  assert.deepEqual(filterQueueTasksAfterDelete([requeuedTask], tombstones, 10_002), [requeuedTask]);
});
