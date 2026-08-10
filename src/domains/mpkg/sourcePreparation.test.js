'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { createMpkgSourcePreparation } = require('./sourcePreparation');

test('MPKG source preparation preserves queue authentication errors', async () => {
  const sourcePreparation = createMpkgSourcePreparation({
    findDownloadedItemPath: () => '',
    createWorkshopQueueTask: async () => ({
      status: 'error',
      errorMsg: 'Steam Guard required',
      errorCode: 'STEAM_GUARD_REQUIRED',
      requiresSteamGuard: true,
    }),
    sleep: async () => {},
  });

  await assert.rejects(
    sourcePreparation.ensureDownloadedItem('123', 'Demo'),
    error => {
      assert.equal(error.message, 'Steam Guard required');
      assert.equal(error.statusCode, 401);
      assert.equal(error.code, 'STEAM_GUARD_REQUIRED');
      assert.equal(error.requiresSteamLogin, false);
      assert.equal(error.requiresSteamGuard, true);
      return true;
    },
  );
});
