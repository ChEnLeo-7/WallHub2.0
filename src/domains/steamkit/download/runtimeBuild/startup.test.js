'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRuntimeStartup } = require('./startup');

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

function createStartup(overrides = {}) {
  const updates = [];
  const warnings = [];
  const warmup = deferred();
  const startup = createRuntimeStartup({
    env: {},
    logger: { warn: (...args) => warnings.push(args) },
    STEAMKIT_ROOT: 'SteamKit',
    DOWNLOADS_DIR: 'Downloads',
    updateRuntimeSetup: update => updates.push(update),
    runtimeSetupSnapshot: () => updates.at(-1) || {},
    ensureSteamConfigDir() {},
    reconcileCachedSteamLogin: async () => {},
    warmupSteamKitQueryBridge: () => warmup.promise,
    ...overrides,
  }, {
    cleanupLegacyDepotJsonProgressDir() {},
  }, {
    ensureDepotDownloaderReady: async () => 'DepotDownloader.exe',
    warmupDepotStreamDownloader() {},
  });
  return { startup, updates, warnings, warmup };
}

test('runtime startup begins CM bridge warmup after readiness without waiting for it', async () => {
  const calls = [];
  const { startup, updates, warmup } = createStartup({
    warmupSteamKitQueryBridge(reason) {
      calls.push(reason);
      return warmup.promise;
    },
  });

  await startup.prepareRuntimeOnStartup();

  assert.deepEqual(calls, ['startup']);
  assert.equal(updates.at(-1).status, 'ready');
  warmup.resolve();
});

test('runtime startup keeps the ready state when background CM bridge warmup fails', async () => {
  const { startup, updates, warnings } = createStartup({
    warmupSteamKitQueryBridge: async () => { throw new Error('Steam CM unavailable'); },
  });

  await startup.prepareRuntimeOnStartup();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(updates.at(-1).status, 'ready');
  assert.equal(warnings.some(args => args.join(' ').includes('Steam CM unavailable')), true);
});

test('runtime startup keeps the ready state when CM bridge warmup throws synchronously', async () => {
  const { startup, updates, warnings } = createStartup({
    warmupSteamKitQueryBridge() { throw new Error('warmup construction failed'); },
  });

  await startup.prepareRuntimeOnStartup();
  await new Promise(resolve => setImmediate(resolve));

  assert.equal(updates.at(-1).status, 'ready');
  assert.equal(warnings.some(args => args.join(' ').includes('warmup construction failed')), true);
});
