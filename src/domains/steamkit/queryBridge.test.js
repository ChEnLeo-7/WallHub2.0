'use strict';

const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WALLHUB_STEAM_QUERY_BRIDGE_READY,
  WALLHUB_STEAM_QUERY_BRIDGE_MARKER,
  createSteamKitQueryBridge,
} = require('./queryBridge');

function createChild() {
  const child = new EventEmitter();
  child.stdin = new PassThrough();
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.killed = false;
  child.kill = () => {
    child.killed = true;
    child.emit('close', 0);
    return true;
  };
  return child;
}

function waitFor(check) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + 1000;
    const timer = setInterval(() => {
      if (check()) {
        clearInterval(timer);
        resolve();
      } else if (Date.now() >= deadline) {
        clearInterval(timer);
        reject(new Error('timed out waiting for bridge test event'));
      }
    }, 2);
  });
}

test('SteamKit query bridge starts one process for GetUserFiles', async () => {
  const spawned = [];
  const inputLines = [];
  const child = createChild();
  child.stdin.on('data', chunk => {
    inputLines.push(...String(chunk).split(/\r?\n/).filter(Boolean));
  });
  const bridge = createSteamKitQueryBridge({
    ensureDepotDownloaderReady: async () => 'DepotDownloader.exe',
    depotCommandFor: () => ({ command: 'DepotDownloader.exe', argsPrefix: [] }),
    buildDepotDotnetEnv: () => ({ DOTNET_CLI_HOME: 'test-home' }),
    buildSteamAuthEnv: env => Object.assign({}, env, { WALLHUB_TEST_PROXY: '1' }),
    makeDepotLoginId: seed => `login-${seed}`,
    ensureDir() {},
    configDir: 'account',
    spawnProcess(command, args, options) {
      spawned.push({ command, args, options });
      return child;
    },
    logger: { log() {} },
  });

  const userFilesPromise = bridge.getUserFiles('mysubscriptions', {
    username: 'tester',
    appId: 431960,
    page: 2,
    numperpage: 30,
    sortmethod: 'creationorder',
  });
  await waitFor(() => spawned.length === 1);
  child.stdout.write(`${WALLHUB_STEAM_QUERY_BRIDGE_READY}\n`);
  await waitFor(() => inputLines.length === 1);
  const userFilesRequest = JSON.parse(inputLines[0]);
  assert.equal(userFilesRequest.operation, 'user-files');
  assert.equal(userFilesRequest.listType, 'mysubscriptions');
  assert.equal(userFilesRequest.page, 2);
  assert.equal(userFilesRequest.sortmethod, 'creationorder');
  child.stdout.write(`${WALLHUB_STEAM_QUERY_BRIDGE_MARKER}${JSON.stringify({
    id: userFilesRequest.id,
    ok: true,
    response: { total: 1, ids: ['100000'] },
  })}\n`);
  assert.deepEqual(await userFilesPromise, { total: 1, ids: ['100000'] });

  assert.equal(spawned.length, 1);
  assert.deepEqual(spawned[0].args, [
    '-wallhub-query-bridge',
    '-username', 'tester',
    '-remember-password',
    '-max-downloads', '1',
    '-loginid', 'login-query-bridge:tester',
  ]);
  assert.equal(spawned[0].options.env.WALLHUB_TEST_PROXY, '1');
  bridge.shutdown('test complete');
});
