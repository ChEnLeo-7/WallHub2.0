'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const { createConfigurationState } = require('./createConfigurationState');

test('info logging remains visible while debug logging is disabled', () => {
  const projectRoot = path.resolve(__dirname, '../../..');
  const rootRequire = request => require(path.resolve(projectRoot, request));
  const scope = createConfigurationState({ rootRequire, projectRoot });
  const infoLogs = [];
  const debugLogs = [];
  const originalInfo = console.info;
  const originalLog = console.log;

  scope.state.videoCacheSettings.wallhubLogLevel = 'info';
  console.info = (...args) => infoLogs.push(args);
  console.log = (...args) => debugLogs.push(args);
  try {
    scope.debugLogger.info('core status');
    scope.debugLogger.log('debug detail');
  } finally {
    console.info = originalInfo;
    console.log = originalLog;
  }

  assert.deepEqual(infoLogs, [['core status']]);
  assert.deepEqual(debugLogs, []);
});
