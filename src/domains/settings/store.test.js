'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createCacheSettingsStore } = require('./store');

test('cache settings snapshot exposes the selected MPKG texture profile', () => {
  const store = createCacheSettingsStore({
    settingsFile: '',
    logger: { log() {}, warn() {} },
  });
  store.setState({ mpkgTextureProfile: 'compact' });

  assert.equal(store.snapshot().mpkgTextureProfile, 'compact');
});
