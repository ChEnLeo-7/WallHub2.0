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
