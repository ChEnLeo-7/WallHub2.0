'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSteamKitLoginService } = require('./login');

function createService(overrides = {}) {
  return createSteamKitLoginService(Object.assign({
    ensureDepotDownloaderReady: async () => 'DepotDownloader.exe',
    ensureDir() {},
    depotCommandFor: executable => ({ command: executable, argsPrefix: [] }),
    runProcess: async () => ({ out: '', err: '' }),
    buildDepotDotnetEnv: () => ({}),
    makeDepotLoginId: seed => `login-${seed}`,
    normalizeDepotError: error => error,
    isDepotLoginVerifiedDespiteCanceled: () => false,
    setValidatedPersistentLogin() {},
    getQrCodeModule() { return null; },
    getJsQrModule() { return null; },
    effectiveDownloaderMode: () => 'steamkit',
    configDir: 'account',
    logger: { log() {}, warn() {} },
  }, overrides));
}

test('SteamKit web session output parses community cookies only', () => {
  const service = createService();
  const output = 'noise\nWALLHUB_STEAM_WEB_SESSION:{"cookie":"steamLoginSecure=abc; sessionid=def; clientsessionid=ghi; other=value"}\n';

  assert.equal(
    service.parseWebSessionCookieOutput(output),
    'steamLoginSecure=abc; sessionid=def; clientsessionid=ghi'
  );
});

test('SteamKit web session cookie command uses remembered account and caches result', async () => {
  const calls = [];
  const service = createService({
    runProcess: async (command, args, timeout, options) => {
      calls.push({ command, args, timeout, options });
      return {
        out: 'WALLHUB_STEAM_WEB_SESSION:{"cookies":["steamLoginSecure=secure","sessionid=sid","clientsessionid=cid"]}\n',
        err: '',
      };
    },
  });

  const first = await service.getWebSessionCookie('tester');
  const second = await service.getWebSessionCookie('tester');

  assert.equal(first, 'steamLoginSecure=secure; sessionid=sid; clientsessionid=cid');
  assert.equal(second, first);
  assert.equal(calls.length, 1);
  assert.ok(calls[0].args.includes('-wallhub-web-session'));
  assert.ok(calls[0].args.includes('-remember-password'));
  assert.deepEqual(calls[0].options.cwd, 'account');
});

test('SteamKit password login exposes a phone-confirmation status without exposing process output', async () => {
  let resolveLogin;
  const completed = new Promise((resolve) => { resolveLogin = resolve; });
  const persisted = [];
  const service = createService({
    runProcess: async (_command, _args, _timeout, options) => {
      options.onStdout('Please confirm this login in the Steam Mobile App.');
      await completed;
      return { out: '', err: '' };
    },
    setValidatedPersistentLogin: (username, backend) => persisted.push({ username, backend }),
  });

  const session = service.startPasswordSession('tester', 'secret');
  await Promise.resolve();
  await Promise.resolve();

  const waiting = service.getPasswordSession(session.id);
  assert.equal(waiting.status, 'waiting-phone');
  assert.equal(waiting.requiresPhoneConfirmation, true);
  assert.equal(waiting.message, '需要在 Steam 手机 App 中确认本次登录，请查看手机');
  assert.equal(Object.hasOwn(waiting, 'output'), false);

  resolveLogin();
  const internal = service.sessions.get(session.id);
  await internal.processPromise;
  const success = service.getPasswordSession(session.id);
  assert.equal(success.status, 'success');
  assert.deepEqual(persisted, [{ username: 'tester', backend: 'steamkit' }]);
});

test('SteamKit password login submits a supplied Steam token on the first attempt', async () => {
  let invocation;
  const service = createService({
    runProcess: async (command, args, timeout, options) => {
      invocation = { command, args, timeout, options };
      return { out: '', err: '' };
    },
  });

  const session = service.startPasswordSession('tester', 'secret', 'AB12C');
  await service.sessions.get(session.id).processPromise;

  assert.ok(invocation.args.includes('-no-mobile'));
  assert.deepEqual(invocation.options.inputLines, ['secret', 'AB12C']);
  assert.ok(invocation.args.includes('-wallhub-cm-login'));
  assert.ok(invocation.args.includes('-wallhub-password-stdin'));
  assert.equal(invocation.args.includes('-password'), false);
  assert.equal(invocation.args.includes('secret'), false);
  assert.equal(service.getPasswordSession(session.id).status, 'success');
});

test('SteamKit password login preserves password whitespace through stdin', async () => {
  let inputLines;
  const service = createService({
    runProcess: async (_command, _args, _timeout, options) => {
      inputLines = options.inputLines;
      return { out: '', err: '' };
    },
  });

  const session = service.startPasswordSession('tester', ' secret ');
  await service.sessions.get(session.id).processPromise;

  assert.deepEqual(inputLines, [' secret ']);
  assert.equal(service.getPasswordSession(session.id).status, 'success');
});

test('SteamKit password login keeps an explicit network error ahead of Steam Guard flags', async () => {
  const service = createService({
    runProcess: async () => {
      throw new Error('NoConnection; mobile authenticator may be required');
    },
    normalizeDepotError: () => Object.assign(new Error('Steam network unavailable'), {
      code: 'STEAM_NETWORK_UNREACHABLE',
      statusCode: 504,
      requiresSteamGuard: true,
    }),
  });

  const session = service.startPasswordSession('tester', 'secret');
  await service.sessions.get(session.id).processPromise;
  const failed = service.getPasswordSession(session.id);

  assert.equal(failed.status, 'error');
  assert.equal(failed.code, 'STEAM_NETWORK_UNREACHABLE');
  assert.equal(failed.needsSteamGuard, undefined);
  assert.match(failed.error, /network unavailable/);
});

test('Steam login validation uses a dedicated CM session without requesting an app manifest', async () => {
  let invocation;
  const service = createService({
    runProcess: async (_command, args) => {
      invocation = args;
      return { out: '', err: '' };
    },
  });

  await service.verifyLogin('tester', 'secret', '');

  assert.ok(invocation.includes('-wallhub-cm-login'));
  assert.equal(invocation.includes('-app'), false);
  assert.equal(invocation.includes('-manifest-only'), false);
});

test('Steam remembered-session validation uses the same dedicated CM command', async () => {
  let invocation;
  const service = createService({
    runProcess: async (_command, args) => {
      invocation = args;
      return { out: '', err: '' };
    },
  });

  await service.verifyRememberedSession('tester');

  assert.ok(invocation.includes('-wallhub-cm-login'));
  assert.ok(invocation.includes('-remember-password'));
  assert.equal(invocation.includes('-wallhub-password-stdin'), false);
  assert.equal(invocation.includes('-app'), false);
});

test('Steam QR login establishes a dedicated CM session without an app request', async () => {
  let invocation;
  const persisted = [];
  const service = createService({
    runProcess: (_command, args, _timeout, options) => {
      invocation = { args, options };
      options.onStdout('WALLHUB_STEAM_CM_LOGIN:{"steamid":"76561198000000000","account":"qr-user"}\n');
      return Promise.resolve({ out: '', err: '' });
    },
    setValidatedPersistentLogin: (username, backend) => persisted.push({ username, backend }),
  });

  const session = await service.startQrSession();
  await service.sessions.get(session.id).processPromise;

  assert.ok(invocation.args.includes('-wallhub-cm-login'));
  assert.ok(invocation.args.includes('-qr'));
  assert.equal(invocation.args.includes('-app'), false);
  assert.equal(service.getQrSession(session.id).status, 'success');
  assert.equal(service.getQrSession(session.id).username, 'qr-user');
  assert.deepEqual(persisted, [{ username: 'qr-user', backend: 'steamkit' }]);
});

test('SteamKit ownership check distinguishes app access from a missing license', async () => {
  const calls = [];
  const owned = createService({
    runProcess: async (_command, args) => {
      calls.push(args);
      return { out: '', err: '' };
    },
  });
  assert.deepEqual(await owned.checkAppOwnership('tester', 431960), { status: 'owned', appId: 431960 });
  assert.ok(calls[0].includes('-manifest-only'));
  assert.ok(calls[0].includes('431960'));

  const missing = createService({
    runProcess: async () => { throw new Error('App 431960 is not available from this account; license missing'); },
  });
  assert.deepEqual(await missing.checkAppOwnership('tester', 431960), { status: 'not-owned', appId: 431960 });
});
