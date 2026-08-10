'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createStartupOnboardingSession } = require('./session');

test('startup onboarding remains required until both choices are explicitly completed', () => {
  let current = 100;
  const session = createStartupOnboardingSession({ instanceId: 'server-a', now: () => current });

  assert.equal(session.snapshot().required, true);
  assert.equal(session.snapshot().required, true);
  const checkId = session.beginNetworkCheck();
  session.completeNetworkCheck(checkId, { status: 'connected', route: 'direct' });
  current = 200;
  const completed = session.complete({
    instanceId: 'server-a',
    steamDecision: 'skip',
    networkDecision: 'connected',
    networkCheckId: checkId,
  });

  assert.equal(completed.required, false);
  assert.equal(completed.completedAt, 200);
  assert.equal(session.complete({ instanceId: 'server-a' }).completedAt, 200);
});

test('startup onboarding validates server instance and required checks', () => {
  const session = createStartupOnboardingSession({ instanceId: 'server-a' });

  assert.throws(
    () => session.complete({ instanceId: 'server-b', steamDecision: 'skip', networkDecision: 'continue' }),
    error => error.code === 'ONBOARDING_INSTANCE_CHANGED'
  );
  assert.throws(
    () => session.complete({ instanceId: 'server-a', steamDecision: 'skip', networkDecision: 'continue' }),
    error => error.code === 'ONBOARDING_NETWORK_CHECK_REQUIRED'
  );
});

test('startup onboarding stays completed after a simulated restart with the persisted timestamp', () => {
  let current = 100;
  const first = createStartupOnboardingSession({ instanceId: 'server-a', now: () => current });
  const checkId = first.beginNetworkCheck();
  first.completeNetworkCheck(checkId, { status: 'unreachable', route: 'direct' });
  current = 200;
  first.complete({ instanceId: 'server-a', steamDecision: 'skip', networkDecision: 'continue', networkCheckId: checkId });

  const restarted = createStartupOnboardingSession({
    instanceId: 'server-b',
    completedAt: first.snapshot().completedAt,
  });
  assert.equal(first.snapshot().required, false);
  assert.equal(restarted.snapshot().required, false);
  assert.equal(restarted.snapshot().completedAt, 200);
});

test('startup onboarding validates before persistence and commits only after saving', () => {
  const session = createStartupOnboardingSession({ instanceId: 'server-a', now: () => 200 });
  const checkId = session.beginNetworkCheck({ route: 'enhanced' });
  session.completeNetworkCheck(checkId, { status: 'connected', route: 'enhanced' }, {
    wallhubSteamAccessMode: 'resolver',
    wallhubSteamAccessResolverProtocol: 'doh',
  });
  const validated = session.validateCompletion({
    instanceId: 'server-a',
    steamDecision: 'skip',
    networkDecision: 'enhanced',
    networkCheckId: checkId,
  });

  assert.equal(validated.completedAt, 200);
  assert.equal(session.snapshot().completed, false);
  assert.equal(Object.hasOwn(session.snapshot(), 'pendingNetworkSettings'), false);
  assert.deepEqual(session.testedNetworkSettings(), {
    wallhubSteamAccessMode: 'resolver',
    wallhubSteamAccessResolverProtocol: 'doh',
  });
  assert.equal(session.commitCompletion(validated.completedAt).completed, true);
});

test('startup onboarding rejects a decision that does not match the latest network check', () => {
  const session = createStartupOnboardingSession({ instanceId: 'server-a' });
  const checkId = session.beginNetworkCheck({ route: 'enhanced' });
  session.completeNetworkCheck(checkId, { status: 'connected', route: 'enhanced' });

  assert.throws(
    () => session.validateCompletion({ instanceId: 'server-a', steamDecision: 'skip', networkDecision: 'continue', networkCheckId: checkId }),
    error => error.code === 'ONBOARDING_NETWORK_DECISION_MISMATCH'
  );
});

test('startup onboarding rejects login-required and stale account checks', () => {
  const session = createStartupOnboardingSession({ instanceId: 'server-a' });
  const checkId = session.beginNetworkCheck();
  session.completeNetworkCheck(checkId, { status: 'connected', route: 'direct' });
  session.recordAccount({ status: 'login-required', username: 'alice' });
  assert.throws(
    () => session.validateCompletion({
      instanceId: 'server-a',
      steamDecision: 'login',
      networkDecision: 'connected',
      networkCheckId: checkId,
      currentUsername: 'alice',
      loginUsable: true,
    }),
    error => error.code === 'ONBOARDING_ACCOUNT_CHECK_REQUIRED'
  );

  session.recordAccount({ status: 'owned', username: 'alice' });
  assert.throws(
    () => session.validateCompletion({
      instanceId: 'server-a',
      steamDecision: 'login',
      networkDecision: 'connected',
      networkCheckId: checkId,
      currentUsername: 'bob',
      loginUsable: true,
    }),
    error => error.code === 'ONBOARDING_ACCOUNT_CHANGED'
  );
});

test('startup onboarding tracks only the latest network check progress', () => {
  let current = 100;
  const session = createStartupOnboardingSession({ instanceId: 'server-a', now: () => current });
  const firstId = session.beginNetworkCheck({ route: 'enhanced', phase: 'saving-settings', progress: 5 });

  current = 150;
  assert.equal(session.updateNetworkProgress(firstId, {
    phase: 'warming-routes',
    progress: 40,
    completedHosts: 1,
    totalHosts: 3,
    availableRoutes: 1,
  }), true);
  assert.deepEqual(session.snapshot().networkProgress, {
    checkId: firstId,
    active: true,
    route: 'enhanced',
    phase: 'warming-routes',
    progress: 40,
    startedAt: 100,
    updatedAt: 150,
    completedHosts: 1,
    totalHosts: 3,
    availableRoutes: 1,
    workshopAttempt: 0,
    workshopMaxAttempts: 3,
    workshopRetryCount: 0,
    workshopLastError: '',
  });

  current = 200;
  const secondId = session.beginNetworkCheck({ route: 'direct', progress: 20 });
  assert.equal(session.updateNetworkProgress(firstId, { progress: 90 }), false);
  assert.equal(session.finishNetworkCheck(secondId, { phase: 'complete', progress: 100 }), true);
  assert.equal(session.snapshot().networkProgress.active, false);
  assert.equal(session.snapshot().networkProgress.progress, 100);
  assert.equal(session.snapshot().networkProgress.startedAt, 200);
});

test('a newer network result replaces private tested settings', () => {
  const session = createStartupOnboardingSession({ instanceId: 'server-a' });
  const firstId = session.beginNetworkCheck({ route: 'enhanced' });
  session.completeNetworkCheck(firstId, { status: 'connected', route: 'enhanced' }, {
    wallhubSteamAccessMode: 'hosts',
    wallhubSteamAccessHosts: '1.2.3.4 steamcommunity.com',
  });
  const secondId = session.beginNetworkCheck({ route: 'enhanced' });
  session.completeNetworkCheck(secondId, { status: 'unreachable', route: 'enhanced' });

  assert.equal(session.testedNetworkSettings(), null);
  assert.equal(JSON.stringify(session.snapshot()).includes('1.2.3.4'), false);
});

test('a new check invalidates the previous result and completion binds to the latest check id', () => {
  const session = createStartupOnboardingSession({ instanceId: 'server-a' });
  const firstId = session.beginNetworkCheck();
  assert.equal(session.completeNetworkCheck(firstId, { status: 'connected', route: 'direct' }), true);
  const secondId = session.beginNetworkCheck({ route: 'enhanced' });

  assert.throws(
    () => session.validateCompletion({
      instanceId: 'server-a',
      steamDecision: 'skip',
      networkDecision: 'connected',
      networkCheckId: firstId,
    }),
    error => error.code === 'ONBOARDING_NETWORK_CHECK_ACTIVE'
  );
  assert.equal(session.completeNetworkCheck(firstId, { status: 'connected', route: 'direct' }), false);
  assert.equal(session.completeNetworkCheck(secondId, { status: 'connected', route: 'enhanced' }, { wallhubSteamAccessMode: 'resolver' }), true);
  assert.throws(
    () => session.validateCompletion({
      instanceId: 'server-a',
      steamDecision: 'skip',
      networkDecision: 'enhanced',
      networkCheckId: firstId,
    }),
    error => error.code === 'ONBOARDING_NETWORK_CHECK_CHANGED'
  );
  assert.equal(session.validateCompletion({
    instanceId: 'server-a',
    steamDecision: 'skip',
    networkDecision: 'enhanced',
    networkCheckId: secondId,
  }).completed, true);
});
