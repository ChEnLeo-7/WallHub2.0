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

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
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

test('SteamKit query bridge sends a PublishedFile Workshop query through the same process', async () => {
  const inputLines = [];
  const child = createChild();
  child.stdin.on('data', chunk => inputLines.push(...String(chunk).split(/\r?\n/).filter(Boolean)));
  const bridge = createSteamKitQueryBridge({
    ensureDepotDownloaderReady: async () => 'DepotDownloader.exe',
    depotCommandFor: () => ({ command: 'DepotDownloader.exe', argsPrefix: [] }),
    makeDepotLoginId: seed => `login-${seed}`,
    ensureDir() {},
    configDir: 'account',
    spawnProcess: () => child,
    logger: { log() {} },
  });

  const queryPromise = bridge.queryWorkshop({ operation: 'query-files', appid: 431960, search_text: 'video' }, { username: 'tester' });
  child.stdout.write(`${WALLHUB_STEAM_QUERY_BRIDGE_READY}\n`);
  await waitFor(() => inputLines.length === 1);
  const request = JSON.parse(inputLines[0]);
  assert.equal(request.operation, 'workshop-query');
  assert.equal(request.query.search_text, 'video');
  child.stdout.write(`${WALLHUB_STEAM_QUERY_BRIDGE_MARKER}${JSON.stringify({ id: request.id, ok: true, response: { total: 0, ids: [] } })}\n`);
  assert.deepEqual(await queryPromise, { total: 0, ids: [] });
  bridge.shutdown('test complete');
});

test('SteamKit query bridge shutdown while starting rejects the request without spawning', async () => {
  const ready = deferred();
  let spawnCount = 0;
  let readinessCalls = 0;
  const bridge = createSteamKitQueryBridge({
    ensureDepotDownloaderReady() {
      readinessCalls += 1;
      return ready.promise;
    },
    depotCommandFor: () => ({ command: 'DepotDownloader.exe', argsPrefix: [] }),
    makeDepotLoginId: seed => `login-${seed}`,
    spawnProcess() {
      spawnCount += 1;
      return createChild();
    },
    logger: { log() {} },
  });

  const request = bridge.getUserFiles('mysubscriptions', { username: 'tester' });
  await waitFor(() => readinessCalls === 1);
  bridge.shutdown('test shutdown');
  await assert.rejects(request, /test shutdown/);
  ready.resolve('DepotDownloader.exe');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(spawnCount, 0);
});

test('SteamKit query bridge shutdown rejects an active request and clears abort listeners', async () => {
  const inputLines = [];
  const child = createChild();
  child.stdin.on('data', chunk => inputLines.push(...String(chunk).split(/\r?\n/).filter(Boolean)));
  const signalController = new AbortController();
  let abortListeners = 0;
  const addEventListener = signalController.signal.addEventListener.bind(signalController.signal);
  const removeEventListener = signalController.signal.removeEventListener.bind(signalController.signal);
  signalController.signal.addEventListener = (...args) => {
    abortListeners += 1;
    return addEventListener(...args);
  };
  signalController.signal.removeEventListener = (...args) => {
    abortListeners -= 1;
    return removeEventListener(...args);
  };
  const bridge = createSteamKitQueryBridge({
    ensureDepotDownloaderReady: async () => 'DepotDownloader.exe',
    depotCommandFor: () => ({ command: 'DepotDownloader.exe', argsPrefix: [] }),
    makeDepotLoginId: seed => `login-${seed}`,
    spawnProcess: () => child,
    logger: { log() {} },
  });

  const request = bridge.getUserFiles('mysubscriptions', {
    username: 'tester',
    signal: signalController.signal,
  });
  child.stdout.write(`${WALLHUB_STEAM_QUERY_BRIDGE_READY}\n`);
  await waitFor(() => inputLines.length === 1 && abortListeners === 1);
  bridge.shutdown('active shutdown');
  await assert.rejects(request, /active shutdown/);
  assert.equal(abortListeners, 0);
  assert.equal(child.stdin.writableEnded, true);
  bridge.shutdown('duplicate shutdown');
});

test('SteamKit query bridge shutdown rejects queued tasks and does not revive the old generation', async () => {
  const ready = deferred();
  let spawnCount = 0;
  const signalController = new AbortController();
  let abortListeners = 0;
  const addEventListener = signalController.signal.addEventListener.bind(signalController.signal);
  const removeEventListener = signalController.signal.removeEventListener.bind(signalController.signal);
  signalController.signal.addEventListener = (...args) => {
    abortListeners += 1;
    return addEventListener(...args);
  };
  signalController.signal.removeEventListener = (...args) => {
    abortListeners -= 1;
    return removeEventListener(...args);
  };
  const bridge = createSteamKitQueryBridge({
    ensureDepotDownloaderReady: () => ready.promise,
    depotCommandFor: () => ({ command: 'DepotDownloader.exe', argsPrefix: [] }),
    makeDepotLoginId: seed => `login-${seed}`,
    spawnProcess() {
      spawnCount += 1;
      return createChild();
    },
    logger: { log() {} },
  });

  const active = bridge.getUserFiles('mysubscriptions', { username: 'tester' });
  const queued = bridge.queryWorkshop({}, { username: 'tester', signal: signalController.signal });
  await waitFor(() => abortListeners === 1);
  bridge.shutdown('queue shutdown');
  await Promise.all([
    assert.rejects(active, /queue shutdown/),
    assert.rejects(queued, /queue shutdown/),
  ]);
  assert.equal(abortListeners, 0);
  ready.resolve('DepotDownloader.exe');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(spawnCount, 0);
});

test('SteamKit query bridge starts a new generation for requests after shutdown', async () => {
  const firstReady = deferred();
  const children = [];
  let readinessCalls = 0;
  const bridge = createSteamKitQueryBridge({
    ensureDepotDownloaderReady() {
      readinessCalls += 1;
      return readinessCalls === 1 ? firstReady.promise : Promise.resolve('DepotDownloader.exe');
    },
    depotCommandFor: () => ({ command: 'DepotDownloader.exe', argsPrefix: [] }),
    makeDepotLoginId: seed => `login-${seed}`,
    spawnProcess() {
      const child = createChild();
      children.push(child);
      return child;
    },
    logger: { log() {} },
  });

  const oldRequest = bridge.getUserFiles('mysubscriptions', { username: 'old-user' });
  bridge.shutdown('replace generation');
  await assert.rejects(oldRequest, /replace generation/);

  const newRequest = bridge.getUserFiles('mysubscriptions', { username: 'new-user' });
  await waitFor(() => children.length === 1);
  children[0].stdout.write(`${WALLHUB_STEAM_QUERY_BRIDGE_READY}\n`);
  let requestBody;
  children[0].stdin.on('data', chunk => {
    requestBody = JSON.parse(String(chunk).trim());
  });
  await waitFor(() => requestBody);
  children[0].stdout.write(`${WALLHUB_STEAM_QUERY_BRIDGE_MARKER}${JSON.stringify({
    id: requestBody.id,
    ok: true,
    response: { total: 1, ids: ['new'] },
  })}\n`);
  assert.deepEqual(await newRequest, { total: 1, ids: ['new'] });

  firstReady.resolve('DepotDownloader.exe');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(children.length, 1);
  bridge.shutdown('test complete');
});

test('SteamKit query bridge account switch cancels the old start without spawning it later', async () => {
  const oldReady = deferred();
  const children = [];
  let readinessCalls = 0;
  const bridge = createSteamKitQueryBridge({
    ensureDepotDownloaderReady() {
      readinessCalls += 1;
      return readinessCalls === 1 ? oldReady.promise : Promise.resolve('DepotDownloader.exe');
    },
    depotCommandFor: () => ({ command: 'DepotDownloader.exe', argsPrefix: [] }),
    makeDepotLoginId: seed => `login-${seed}`,
    spawnProcess() {
      const child = createChild();
      children.push(child);
      return child;
    },
    logger: { log() {} },
  });

  const oldWarm = bridge.warm('old-user');
  await waitFor(() => readinessCalls === 1);
  const newWarm = bridge.warm('new-user');
  await assert.rejects(oldWarm, /account changed/);
  await waitFor(() => children.length === 1);
  children[0].stdout.write(`${WALLHUB_STEAM_QUERY_BRIDGE_READY}\n`);
  const state = await newWarm;
  assert.equal(state.username, 'new-user');

  oldReady.resolve('DepotDownloader.exe');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(children.length, 1);
  bridge.shutdown('test complete');
});
