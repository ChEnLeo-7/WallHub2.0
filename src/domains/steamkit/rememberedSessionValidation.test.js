'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createRememberedSessionValidation } = require('./rememberedSessionValidation');

function deferred() {
  let resolve;
  const promise = new Promise(resolvePromise => { resolve = resolvePromise; });
  return { promise, resolve };
}

test('remembered Steam session validation shares one in-flight check per account', async () => {
  const pending = deferred();
  let calls = 0;
  const validation = createRememberedSessionValidation({
    verify: async () => {
      calls += 1;
      await pending.promise;
    },
    isCurrent: username => username === 'alice',
  });

  const first = validation.validate('alice');
  const second = validation.validate('alice');
  assert.equal(first, second);
  assert.equal(calls, 1);

  pending.resolve();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
});

test('remembered Steam session validation rejects a stale account result', async () => {
  const pending = deferred();
  let currentUser = 'alice';
  const validation = createRememberedSessionValidation({
    verify: async () => pending.promise,
    isCurrent: username => username === currentUser,
  });

  const result = validation.validate('alice');
  currentUser = '';
  pending.resolve();

  await assert.rejects(result, error => error.code === 'STEAM_SESSION_CHANGED');
});
