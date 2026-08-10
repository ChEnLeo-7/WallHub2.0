'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createServerLifecycle } = require('./lifecycle');

function createLifecycle(overrides = {}) {
  return createServerLifecycle(Object.assign({
    server: { close() {}, listen() {}, on() {} },
    port: 3090,
    env: {},
    argv: ['node', 'server.js'],
  }, overrides));
}

test('supervisor parent runs by default', () => {
  assert.equal(createLifecycle().shouldRunSupervisorParent(), true);
});

test('supervisor parent is disabled for child processes and explicit opt-outs', () => {
  assert.equal(createLifecycle({ isSupervisorChild: true }).shouldRunSupervisorParent(), false);
  assert.equal(createLifecycle({ isRestartChild: true }).shouldRunSupervisorParent(), false);
  assert.equal(createLifecycle({ env: { WALLHUB_SUPERVISOR: '0' } }).shouldRunSupervisorParent(), false);
  assert.equal(createLifecycle({ argv: ['node', 'server.js', '--NO-SUPERVISOR'] }).shouldRunSupervisorParent(), false);
});

test('shutdown asks the supervisor to stop after local workers are marked stopping', async () => {
  const calls = [];
  const lifecycle = createLifecycle({
    isSupervisorChild: true,
    canSendProcessMessage: () => true,
    markServerStopping: () => calls.push('mark'),
    stopAllDepotStreamWorkers: reason => calls.push(reason),
    sendProcessMessage: message => calls.push(message),
  });

  const result = await lifecycle.shutdownServer();

  assert.deepEqual(result, { mode: 'supervisor' });
  assert.deepEqual(calls, [
    'mark',
    'server-shutdown',
    { type: 'wallhub:shutdown' },
  ]);
});

test('shutdown without a supervisor schedules process exit', async () => {
  const exits = [];
  const timers = [];
  const lifecycle = createLifecycle({
    exit: code => exits.push(code),
    scheduleTimeout(callback, delay) {
      timers.push(delay);
      callback();
      return { unref() {} };
    },
  });

  const result = await lifecycle.shutdownServer();

  assert.deepEqual(result, { mode: 'exit' });
  assert.deepEqual(timers, [800]);
  assert.deepEqual(exits, [0]);
});
