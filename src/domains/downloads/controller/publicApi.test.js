'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createDownloadsController } = require('../controller');

test('downloads controller preserves its public handler API after extraction', () => {
  const controller = createDownloadsController();

  assert.deepEqual(Object.keys(controller), [
    'handlePreparedDownload',
    'handleMpkgDownload',
    'handleMpkgPreparationStart',
    'handleMpkgPreparationStatus',
    'handleClientDownload',
    'handleQueueItemDownload',
    'handleDownload',
    'listQueueItems',
    'handleQueueAction',
  ]);
  assert.equal(Object.values(controller).every(handler => typeof handler === 'function'), true);
});
