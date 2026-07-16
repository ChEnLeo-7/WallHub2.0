'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createInFlightCoalescer } = require('./inFlight');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test('aborting one joined caller does not cancel shared in-flight work', async () => {
  const gate = deferred();
  let executeCalls = 0;
  let executeSignal;
  const coalescer = createInFlightCoalescer({
    label: '[test]',
    logger: { log() {} },
    execute: async (_key, options) => {
      executeCalls += 1;
      executeSignal = options.signal;
      return gate.promise;
    },
  });

  const first = new AbortController();
  const second = new AbortController();
  const p1 = coalescer.run('same-key', { signal: first.signal });
  const p2 = coalescer.run('same-key', { signal: second.signal });

  first.abort();
  await assert.rejects(p1, /aborted/i);
  assert.equal(executeCalls, 1);
  assert.equal(executeSignal.aborted, false);

  gate.resolve('ok');
  assert.equal(await p2, 'ok');
});

test('clear aborts shared in-flight work and bumps generation', async () => {
  let executeCalls = 0;
  const coalescer = createInFlightCoalescer({
    label: '[test]',
    logger: { log() {} },
    execute: async (_key, options) => {
      executeCalls += 1;
      await new Promise((resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(Object.assign(new Error('internal aborted'), { code: 'ABORT_ERR' })), { once: true });
      });
    },
  });

  const pending = coalescer.run('same-key', {});
  await Promise.resolve();
  coalescer.clear();
  await assert.rejects(pending, /internal aborted/);

  const next = coalescer.run('same-key', {}).catch(() => {});
  await Promise.resolve();
  assert.equal(executeCalls, 2);
  coalescer.clear();
  await next;
});

test('result cache is LRU bounded and promotes a cache hit', async () => {
  let calls = 0;
  const coalescer = createInFlightCoalescer({
    resultTtlMs: 60 * 1000,
    resultCacheMaxEntries: 2,
    execute: async (key) => ({ key, call: ++calls }),
    logger: { log() {} },
  });

  await coalescer.run('first');
  await coalescer.run('second');
  await coalescer.run('first');
  await coalescer.run('third');
  const first = await coalescer.run('first');
  const second = await coalescer.run('second');

  assert.equal(first.call, 1, 'a cache hit should promote first ahead of second');
  assert.equal(second.call, 4, 'the least-recently-used entry should be evicted');
});
