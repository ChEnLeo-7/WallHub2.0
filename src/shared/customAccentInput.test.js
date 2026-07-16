'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isCompleteCustomAccentColor } = require('./customAccentInput');

test('custom accent HEX input accepts incomplete drafts without treating them as committed colors', () => {
  assert.equal(isCompleteCustomAccentColor('#'), false);
  assert.equal(isCompleteCustomAccentColor('#5'), false);
  assert.equal(isCompleteCustomAccentColor('#5e8c'), false);
  assert.equal(isCompleteCustomAccentColor('#5e8cff'), true);
});
