'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStartupOnboardingSession } = require('../../domains/onboarding/session');
const { createOnboardingHandlers } = require('./onboarding');

function createResponse() {
  return {
    headers: {},
    statusCode: 0,
    body: null,
    setHeader(name, value) { this.headers[name] = value; },
  };
}

function createHandlers(overrides = {}) {
  const session = overrides.session || createStartupOnboardingSession({ instanceId: 'server-a', now: () => 200 });
  const options = {
    jsonRes(res, statusCode, value) {
      res.statusCode = statusCode;
      res.body = value;
    },
    readBody: async req => req.body || '',
    isReadAllowed: () => true,
    isMutationAllowed: () => true,
    getSession: () => session,
    getSettings: () => ({}),
    getSteamAccessExperimental: () => ({}),
    hostsUpdater: { fetchAndMaybeSave: async () => ({}) },
    requestDirect: async () => Buffer.from('<html>Steam Community Workshop</html>'),
    userAgent: 'WallHub-Test',
    getCachedUsername: () => '',
    isLoginUsable: () => false,
    checkAppOwnership: async () => ({ status: 'owned' }),
    normalizeLoginError: error => error,
    setAppOwnership() {},
    persistCompletion() {},
    clearGateway() {},
    clearWorkshopCaches() {},
    scheduleHostsUpdate() {},
    logger: { warn() {} },
    ...overrides,
  };
  delete options.session;
  return { session, handlers: createOnboardingHandlers(options) };
}

test('onboarding status uses read trust independently and keeps denied responses non-cacheable', async () => {
  let mutationChecks = 0;
  const { handlers } = createHandlers({
    isReadAllowed: () => false,
    isMutationAllowed: () => { mutationChecks += 1; return true; },
  });
  const res = createResponse();

  await handlers.handleServerOnboardingStatus({ headers: {} }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'ONBOARDING_ORIGIN_DENIED');
  assert.equal(res.headers['Cache-Control'], 'no-store');
  assert.equal(mutationChecks, 0);
});

test('onboarding mutations continue to use mutation trust independently', async () => {
  let readChecks = 0;
  const { handlers } = createHandlers({
    isReadAllowed: () => { readChecks += 1; return true; },
    isMutationAllowed: () => false,
  });
  const res = createResponse();

  await handlers.handleServerOnboardingNetworkCheck({ body: '{}' }, res);

  assert.equal(res.statusCode, 403);
  assert.equal(res.body.code, 'ONBOARDING_ORIGIN_DENIED');
  assert.equal(readChecks, 0);
});

test('direct onboarding network checks update the injected session', async () => {
  const { session, handlers } = createHandlers();
  const res = createResponse();

  await handlers.handleServerOnboardingNetworkCheck({
    body: JSON.stringify({ instanceId: 'server-a', enableEnhance: false }),
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'connected');
  assert.equal(res.body.route, 'direct');
  assert.equal(session.snapshot().network.checkId, res.body.checkId);
  assert.equal(session.snapshot().networkProgress.active, false);
});

test('onboarding network checks stop at the overall deadline and report poor connectivity', async () => {
  let requestAborted = false;
  const { session, handlers } = createHandlers({
    networkCheckTimeoutMs: 20,
    requestDirect: (url, options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        requestAborted = true;
        reject(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }));
      }, { once: true });
    }),
  });
  const res = createResponse();

  await handlers.handleServerOnboardingNetworkCheck({
    body: JSON.stringify({ instanceId: 'server-a', enableEnhance: false }),
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.status, 'unreachable');
  assert.match(res.body.error, /connection quality is poor/);
  assert.ok(res.body.latencyMs < 200);
  assert.equal(requestAborted, true);
  assert.equal(session.snapshot().networkProgress.active, false);
});

test('onboarding actions reject non-object JSON without leaving the response open', async () => {
  const { handlers } = createHandlers();
  const res = createResponse();

  await handlers.handleServerOnboardingNetworkCheck({ body: 'null' }, res);

  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'ONBOARDING_INSTANCE_CHANGED');
});

test('onboarding completion persists before committing the session', async () => {
  const events = [];
  const { session, handlers } = createHandlers({
    persistCompletion() {
      events.push('persist');
      assert.equal(session.snapshot().completed, false);
    },
    clearGateway: () => events.push('clear-gateway'),
    clearWorkshopCaches: () => events.push('clear-workshop'),
    scheduleHostsUpdate: () => events.push('schedule-hosts'),
  });
  const checkId = session.beginNetworkCheck();
  session.completeNetworkCheck(checkId, { status: 'connected', route: 'direct' });
  const res = createResponse();

  await handlers.handleServerOnboardingComplete({
    body: JSON.stringify({
      instanceId: 'server-a',
      steamDecision: 'skip',
      networkDecision: 'connected',
      networkCheckId: checkId,
    }),
  }, res);

  assert.equal(res.statusCode, 200);
  assert.equal(res.body.completed, true);
  assert.deepEqual(events, ['persist', 'clear-gateway', 'clear-workshop', 'schedule-hosts']);
});

test('failed onboarding persistence leaves the session incomplete', async () => {
  const { session, handlers } = createHandlers({
    persistCompletion() {
      const error = new Error('save failed');
      error.statusCode = 500;
      throw error;
    },
  });
  const checkId = session.beginNetworkCheck();
  session.completeNetworkCheck(checkId, { status: 'connected', route: 'direct' });
  const res = createResponse();

  await handlers.handleServerOnboardingComplete({
    body: JSON.stringify({
      instanceId: 'server-a',
      steamDecision: 'skip',
      networkDecision: 'connected',
      networkCheckId: checkId,
    }),
  }, res);

  assert.equal(res.statusCode, 500);
  assert.equal(res.body.error, 'save failed');
  assert.equal(session.snapshot().completed, false);
});
