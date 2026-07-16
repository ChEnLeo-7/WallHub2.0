const test = require('node:test');
const assert = require('node:assert/strict');

test('video keyboard controls seek, pause, and ignore editable controls', async () => {
  const {
    VIDEO_SEEK_SECONDS,
    getLongPressPlaybackRate,
    getRestoredPlaybackRate,
    getVideoKeyboardAction,
  } = await import('./videoControls.mjs');
  assert.equal(VIDEO_SEEK_SECONDS, 5);
  assert.deepEqual(getVideoKeyboardAction({ key: 'ArrowLeft', targetTagName: 'VIDEO' }), { type: 'seek', seconds: -5 });
  assert.deepEqual(getVideoKeyboardAction({ key: 'ArrowRight', targetTagName: 'VIDEO' }), { type: 'seek', seconds: 5 });
  assert.deepEqual(getVideoKeyboardAction({ key: ' ', targetTagName: 'VIDEO' }), { type: 'toggle-play' });
  assert.equal(getVideoKeyboardAction({ key: 'ArrowRight', targetTagName: 'INPUT' }), null);
  assert.equal(getVideoKeyboardAction({ key: 'ArrowLeft', targetTagName: 'BUTTON' }), null);
  assert.equal(getVideoKeyboardAction({ key: ' ', isContentEditable: true }), null);
});

test('video long press uses two-times playback only while held', async () => {
  const { getLongPressPlaybackRate, getRestoredPlaybackRate } = await import('./videoControls.mjs');
  assert.equal(getLongPressPlaybackRate(false), 1);
  assert.equal(getLongPressPlaybackRate(true), 2);
  assert.equal(getRestoredPlaybackRate(1.5), 1.5);
  assert.equal(getRestoredPlaybackRate(Number.NaN), 1);
});
