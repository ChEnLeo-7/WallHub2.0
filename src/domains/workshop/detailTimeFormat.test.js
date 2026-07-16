'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fmtTime } = require('./text');

test('backend detail time keeps the clock portion needed by the frontend formatter', () => {
  assert.match(
    fmtTime(1_784_432_645),
    /^\d{4} 年 \d{2} 月 \d{2} 日 (?:上午|下午) \d{2}:\d{2}:\d{2}$/,
  );
});
