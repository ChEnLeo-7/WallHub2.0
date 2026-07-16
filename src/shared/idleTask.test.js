'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { scheduleIdleTask } = require('./idleTask');

test('scheduleIdleTask runs through idle callback when available', () => {
  let callback;
  let ran = 0;
  const cancel = scheduleIdleTask(() => { ran += 1; }, {
    requestIdleCallback(fn) { callback = fn; return 7; },
    cancelIdleCallback() {},
  });
  assert.equal(ran, 0);
  callback({ didTimeout: false, timeRemaining: () => 8 });
  assert.equal(ran, 1);
  cancel();
});

test('scheduleIdleTask cancellation prevents a scheduled fallback from running', () => {
  let callback;
  let ran = 0;
  const cancel = scheduleIdleTask(() => { ran += 1; }, {
    setTimeout(fn) { callback = fn; return 9; },
    clearTimeout() {},
  });
  cancel();
  callback();
  assert.equal(ran, 0);
});
