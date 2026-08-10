'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
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

test('cache settings snapshot exposes the configured Steam data source', () => {
  const store = createCacheSettingsStore({
    settingsFile: '',
    logger: { log() {}, warn() {} },
  });
  assert.equal(store.snapshot().steamDataSource, 'community');
  store.setState({ steamDataSource: 'cm' });
  assert.equal(store.snapshot().steamDataSource, 'cm');
});

test('cache settings store replaces persisted settings without leaving temporary files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-settings-store-'));
  const settingsFile = path.join(root, 'cache-settings.json');
  const store = createCacheSettingsStore({ settingsFile, logger: { log() {}, warn() {} } });

  store.setState({ wallhubOnboardingCompletedAt: 100 });
  assert.equal(store.save(), true);
  store.setState({ wallhubOnboardingCompletedAt: 200 });
  assert.equal(store.save(), true);

  assert.equal(JSON.parse(fs.readFileSync(settingsFile, 'utf8')).wallhubOnboardingCompletedAt, 200);
  assert.deepEqual(fs.readdirSync(root), ['cache-settings.json']);
  fs.rmSync(root, { recursive: true, force: true });
});

test('cache settings store recovers a backup left by an interrupted replacement', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-settings-recovery-'));
  const settingsFile = path.join(root, 'cache-settings.json');
  fs.writeFileSync(`${settingsFile}.bak`, JSON.stringify({ wallhubOnboardingCompletedAt: 300 }));
  const store = createCacheSettingsStore({ settingsFile, logger: { log() {}, warn() {} } });

  assert.equal(store.load().wallhubOnboardingCompletedAt, 300);
  assert.equal(fs.existsSync(settingsFile), true);
  assert.equal(fs.existsSync(`${settingsFile}.bak`), false);
  fs.rmSync(root, { recursive: true, force: true });
});
