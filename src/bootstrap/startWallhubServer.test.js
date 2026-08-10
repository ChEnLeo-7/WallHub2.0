'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { startWallhubServer } = require('./startWallhubServer');

function createHarness(overrides = {}) {
  const calls = [];
  let requestHandler;
  const server = {};
  const lifecycle = {
    installProcessExitHook: () => calls.push('install-exit-hook'),
    installWorkerStopMessageHandler: () => calls.push('install-stop-handler'),
    installServerErrorHandler: () => calls.push('install-error-handler'),
    buildDepotRuntimeAndExit: () => calls.push('build-runtime'),
    shouldRunSupervisorParent: () => false,
    startSupervisorParent: () => calls.push('start-supervisor'),
    startHttpServer: () => calls.push('start-http'),
    isDockerLikeEnv: () => false,
    restartServer: async () => ({}),
    shutdownServer: async () => ({}),
  };
  const options = Object.assign({
    http: {
      createServer(handler) {
        requestHandler = handler;
        return server;
      },
    },
    cors: res => { res.corsApplied = true; },
    handleHttpRequest: async () => { calls.push('handle-request'); },
    createServerLifecycle: received => {
      assert.equal(received.server, server);
      return lifecycle;
    },
    argv: ['node', 'server.js'],
  }, overrides);
  const expectedArgv = options.argv;
  const createLifecycle = options.createServerLifecycle;
  options.createServerLifecycle = received => {
    assert.equal(received.argv, expectedArgv);
    return createLifecycle(received);
  };

  return {
    calls,
    lifecycle,
    options,
    request: (...args) => requestHandler(...args),
  };
}

test('OPTIONS applies CORS and ends with 204 without routing the request', async () => {
  const harness = createHarness();
  startWallhubServer(harness.options);
  const responseCalls = [];
  const res = {
    writeHead: code => responseCalls.push(['writeHead', code]),
    end: () => responseCalls.push(['end']),
  };

  await harness.request({ method: 'OPTIONS' }, res);

  assert.equal(res.corsApplied, true);
  assert.deepEqual(responseCalls, [['writeHead', 204], ['end']]);
  assert.equal(harness.calls.includes('handle-request'), false);
});

test('non-OPTIONS requests apply CORS before entering the HTTP handler', async () => {
  const order = [];
  const harness = createHarness({
    cors: () => order.push('cors'),
    handleHttpRequest: async () => order.push('handler'),
  });
  startWallhubServer(harness.options);

  await harness.request({ method: 'GET' }, {});

  assert.deepEqual(order, ['cors', 'handler']);
});

test('build flag takes precedence over supervisor and HTTP startup', () => {
  const harness = createHarness({ argv: ['node', 'server.js', '--build-depot-runtime'] });
  harness.lifecycle.shouldRunSupervisorParent = () => true;

  startWallhubServer(harness.options);

  assert.deepEqual(harness.calls, [
    'install-exit-hook',
    'install-stop-handler',
    'install-error-handler',
    'build-runtime',
  ]);
});

test('startup selects the supervisor or HTTP branch from lifecycle policy', () => {
  const supervisorHarness = createHarness();
  supervisorHarness.lifecycle.shouldRunSupervisorParent = () => true;
  startWallhubServer(supervisorHarness.options);
  assert.equal(supervisorHarness.calls.at(-1), 'start-supervisor');

  const httpHarness = createHarness();
  startWallhubServer(httpHarness.options);
  assert.equal(httpHarness.calls.at(-1), 'start-http');
});
