'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { normalizeMpkgId, normalizeMpkgTextureProfile } = require('./normalizers');
const { createMpkgPreparationService } = require('./preparation');

test('MPKG id and texture profile normalization is shared by preparation jobs', async () => {
  const calls = [];
  const service = createMpkgPreparationService({
    prepareDownloadFile: async (id, title, profile) => {
      calls.push({ id, title, profile });
      return { filePath: '/private/demo.mpkg', fileName: 'demo.mpkg' };
    },
  });

  const job = service.start('wallpaper-3750175441', 'Demo', ' COMPACT ');
  await job.promise;

  assert.equal(normalizeMpkgId('wallpaper-3750175441'), '3750175441');
  assert.equal(normalizeMpkgTextureProfile(' COMPACT '), 'compact');
  assert.equal(normalizeMpkgTextureProfile('unknown'), 'fast');
  assert.deepEqual(calls, [{ id: '3750175441', title: 'Demo', profile: 'compact' }]);
  assert.equal(service.get('3750175441', 'compact'), job);
});
