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
  assert.deepEqual(getVideoKeyboardAction({ key: 'f', targetTagName: 'VIDEO' }), { type: 'toggle-fullscreen' });
  assert.deepEqual(getVideoKeyboardAction({ key: 'F', targetTagName: 'BUTTON' }), { type: 'toggle-fullscreen' });
  assert.equal(getVideoKeyboardAction({ key: 'f', targetTagName: 'VIDEO', ctrlKey: true }), null);
  assert.equal(getVideoKeyboardAction({ key: 'f', targetTagName: 'INPUT', targetInputType: 'text' }), null);
  assert.deepEqual(getVideoKeyboardAction({ key: 'ArrowRight', targetTagName: 'INPUT', targetInputType: 'range' }), { type: 'seek', seconds: 5 });
  assert.equal(getVideoKeyboardAction({ key: 'ArrowRight', targetTagName: 'INPUT', targetInputType: 'text' }), null);
  assert.equal(getVideoKeyboardAction({ key: 'ArrowLeft', targetTagName: 'BUTTON' }), null);
  assert.deepEqual(getVideoKeyboardAction({ key: 'ArrowRight', targetTagName: 'BUTTON', isPlayerControl: true }), { type: 'seek', seconds: 5 });
  assert.equal(getVideoKeyboardAction({ key: ' ', targetTagName: 'BUTTON', isPlayerControl: true }), null);
  assert.equal(getVideoKeyboardAction({ key: ' ', isContentEditable: true }), null);
});

test('video long press uses two-times playback only while held', async () => {
  const {
    VIDEO_PLAYBACK_RATE_MAX,
    VIDEO_PLAYBACK_RATE_MIN,
    getLongPressPlaybackRate,
    getRestoredPlaybackRate,
    normalizeVideoPlaybackRate,
  } = await import('./videoControls.mjs');
  assert.equal(getLongPressPlaybackRate(false), 1);
  assert.equal(getLongPressPlaybackRate(true), 2);
  assert.equal(getRestoredPlaybackRate(1.5), 1.5);
  assert.equal(getRestoredPlaybackRate(Number.NaN), 1);
  assert.equal(VIDEO_PLAYBACK_RATE_MIN, 0.5);
  assert.equal(VIDEO_PLAYBACK_RATE_MAX, 3);
  assert.equal(normalizeVideoPlaybackRate(0.5), 0.5);
  assert.equal(normalizeVideoPlaybackRate(2.75), 2.75);
  assert.equal(normalizeVideoPlaybackRate(4), 3);
  assert.equal(normalizeVideoPlaybackRate(0), 0.5);
  assert.equal(normalizeVideoPlaybackRate(Number.NaN), 1);
});

test('video player mode defaults to native and only accepts compatibility mode', async () => {
  const { DEFAULT_VIDEO_PLAYER_MODE, normalizeVideoPlayerMode } = await import('./videoControls.mjs');
  assert.equal(DEFAULT_VIDEO_PLAYER_MODE, 'native');
  assert.equal(normalizeVideoPlayerMode('compatibility'), 'compatibility');
  assert.equal(normalizeVideoPlayerMode('native'), 'native');
  assert.equal(normalizeVideoPlayerMode('legacy'), 'native');
  assert.equal(normalizeVideoPlayerMode(null), 'native');
});

test('video time formatting handles invalid, minute, and hour durations', async () => {
  const { formatVideoTime } = await import('./videoControls.mjs');
  assert.equal(formatVideoTime(Number.NaN), '0:00');
  assert.equal(formatVideoTime(-1), '0:00');
  assert.equal(formatVideoTime(65.9), '1:05');
  assert.equal(formatVideoTime(3661), '1:01:01');
});
