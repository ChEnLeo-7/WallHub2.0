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

test('cache settings snapshot retains the configured Steam Web API key', () => {
  const store = createCacheSettingsStore({
    settingsFile: '',
    logger: { log() {}, warn() {} },
  });
  store.setState({ steamApiKey: 'test-key' });

  assert.equal(store.snapshot().steamApiKey, 'test-key');
});

test('cache settings store ignores the removed remote subscription experiment flag', () => {
  const store = createCacheSettingsStore({
    settingsFile: '',
    logger: { log() {}, warn() {} },
  });

  store.applyPatch({ steamRemoteSubscribeEnabled: true });

  assert.equal(Object.hasOwn(store.snapshot(), 'steamRemoteSubscribeEnabled'), false);
});

test('cache settings store discards removed Workshop query settings', () => {
  const store = createCacheSettingsStore({
    settingsFile: '',
    logger: { log() {}, warn() {} },
  });
  store.setState({ workshopQueryMode: 'steamkit-first', workshopHtmlOrderMode: true });

  assert.equal(Object.hasOwn(store.snapshot(), 'workshopQueryMode'), false);
  assert.equal(Object.hasOwn(store.snapshot(), 'workshopHtmlOrderMode'), false);
});
