'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let formatLocalizedDateTime;
let formatLocalizedDate;
let formatLocalizedCommentTime;
let shouldCompactDateOnlyText;

test.before(async () => {
  ({ formatLocalizedDateTime, formatLocalizedDate, formatLocalizedCommentTime, shouldCompactDateOnlyText } = await import('../../frontend/src/lib/dateDisplay.mjs'));
});

test('same-year timestamps omit the year but retain month, day, period, and time', () => {
  const now = new Date(2026, 6, 15, 12, 0, 0);
  const value = new Date(2026, 6, 5, 9, 4, 3);
  assert.equal(formatLocalizedDateTime(value, now), '07 月 05 日 上午 09:04:03');
});

test('non-current-year timestamps retain the year', () => {
  const now = new Date(2026, 6, 15, 12, 0, 0);
  const value = new Date(2025, 11, 31, 15, 4, 3);
  assert.equal(formatLocalizedDateTime(value, now), '2025 年 12 月 31 日 下午 03:04:03');
});

test('Chinese Steam date strings follow the same current-year rule', () => {
  const now = new Date(2026, 6, 15, 12, 0, 0);
  assert.equal(
    formatLocalizedDateTime('2026 年 7 月 5 日 下午 3:04:03', now),
    '07 月 05 日 下午 03:04:03',
  );
});

test('date-only display keeps month and day complete and shows the year only when needed', () => {
  assert.equal(typeof formatLocalizedDate, 'function');
  const now = new Date(2026, 6, 15, 12, 0, 0);
  assert.equal(formatLocalizedDate(new Date(2026, 6, 11, 9, 4, 3), now), '07 月 11 日');
  assert.equal(formatLocalizedDate(new Date(2025, 6, 11, 9, 4, 3), now), '2025 年 07 月 11 日');
});

test('date-only text uses the normal fact size unless the optional year makes it long', () => {
  assert.equal(typeof shouldCompactDateOnlyText, 'function');
  assert.equal(shouldCompactDateOnlyText('05 月 31 日'), false);
  assert.equal(shouldCompactDateOnlyText('2025 年 05 月 31 日'), true);
  assert.equal(shouldCompactDateOnlyText('未知'), false);
});

test('older comment timestamps hide the current year but preserve a non-current year', () => {
  assert.equal(typeof formatLocalizedCommentTime, 'function');
  const now = new Date(2026, 6, 15, 12, 0, 0);
  const sameYear = { timestamp: new Date(2026, 5, 11, 15, 4, 3).getTime() };
  const priorYear = { timestamp: new Date(2025, 5, 11, 15, 4, 3).getTime() };
  assert.equal(formatLocalizedCommentTime(sameYear, now), '06 月 11 日 下午 03:04:03');
  assert.equal(formatLocalizedCommentTime(priorYear, now), '2025 年 06 月 11 日 下午 03:04:03');
});
