'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { requestWorkshopWithRetry } = require('./workshopRetry');

test('Workshop retry reports attempts and succeeds on a later request', async () => {
  const attempts = [];
  const failures = [];
  const result = await requestWorkshopWithRetry(async ({ attempt }) => {
    if (attempt < 3) throw new Error(`failed-${attempt}`);
    return 'ok';
  }, {
    maxAttempts: 3,
    timeoutMs: 1000,
    onAttempt: value => attempts.push(value),
    onFailure: value => failures.push(value),
  });

  assert.equal(result, 'ok');
  assert.deepEqual(attempts.map(item => item.attempt), [1, 2, 3]);
  assert.deepEqual(failures.map(item => item.willRetry), [true, true]);
});

test('Workshop retry aborts each timed-out request and reports exhausted attempts', async () => {
  let aborted = 0;
  await assert.rejects(() => requestWorkshopWithRetry(({ signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => {
      aborted += 1;
      reject(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' }));
    }, { once: true });
  }), {
    maxAttempts: 2,
    timeoutMs: 10,
  }), error => error.code === 'ONBOARDING_WORKSHOP_TIMEOUT' && error.attempts === 2);
  assert.equal(aborted, 2);
});

test('Workshop retry stops immediately when the overall network check is aborted', async () => {
  const parent = new AbortController();
  let attempts = 0;
  const pending = requestWorkshopWithRetry(({ signal }) => new Promise((resolve, reject) => {
    attempts += 1;
    signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { code: 'ABORT_ERR' })), { once: true });
  }), {
    maxAttempts: 3,
    timeoutMs: 1000,
    signal: parent.signal,
  });
  parent.abort();

  await assert.rejects(pending, { code: 'ONBOARDING_NETWORK_TIMEOUT' });
  assert.equal(attempts, 1);
});
