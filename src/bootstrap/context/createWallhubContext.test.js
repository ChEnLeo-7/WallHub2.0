'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { createWallhubContext } = require('./createWallhubContext');

test('WallHub bootstrap context keeps its public key contract', () => {
  const context = createWallhubContext({ projectRoot: path.resolve(__dirname, '../../..') });
  assert.deepEqual(Object.keys(context).sort(), [
    'buildDepotRuntime',
    'cors',
    'createHttpCompositionConfig',
    'isRestartChild',
    'isSupervisorChild',
    'markServerStopping',
    'onHttpListening',
    'port',
    'projectRoot',
    'setRequestUpdateShutdown',
    'stopRuntimeWorkers',
  ]);
});

test('WallHub HTTP composition keeps its handler section contract', () => {
  const context = createWallhubContext({ projectRoot: path.resolve(__dirname, '../../..') });
  const config = context.createHttpCompositionConfig({});
  assert.deepEqual(Object.keys(config), [
    'staticHandler',
    'runtimeHandlers',
    'updateHandlers',
    'onboardingHandlers',
    'steamSessionHandlers',
    'settingsHandlers',
    'downloadVideoHandlers',
    'serverControlHandlers',
    'router',
    'requestHandler',
  ]);
});

test('WallHub HTTP composition injects independent read and mutation trust policies', () => {
  const context = createWallhubContext({ projectRoot: path.resolve(__dirname, '../../..') });
  const config = context.createHttpCompositionConfig({});
  const lanRequest = {
    headers: { host: '192.168.1.20:3090' },
    socket: { remoteAddress: '192.168.1.42' },
  };

  assert.equal(config.onboardingHandlers.isReadAllowed(lanRequest), true);
  assert.equal(config.onboardingHandlers.isMutationAllowed(lanRequest), false);
  assert.equal(config.settingsHandlers.isReadAllowed(lanRequest), true);
  assert.equal(config.settingsHandlers.isMutationAllowed(lanRequest), false);
});
