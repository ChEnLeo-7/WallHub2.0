export const VIDEO_SEEK_SECONDS = 5;
export const VIDEO_PLAYBACK_RATE_MIN = 0.5;
export const VIDEO_PLAYBACK_RATE_MAX = 3;

export function formatVideoTime(value) {
  const totalSeconds = Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

export function normalizeVideoPlaybackRate(value) {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return 1;
  return Math.min(VIDEO_PLAYBACK_RATE_MAX, Math.max(VIDEO_PLAYBACK_RATE_MIN, rate));
}

export function getVideoKeyboardAction({
  key,
  targetTagName,
  targetInputType,
  isContentEditable,
  isPlayerControl,
  ctrlKey,
  altKey,
  metaKey,
} = {}) {
  const tagName = String(targetTagName || '');
  const inputType = String(targetInputType || '').toLowerCase();
  const isTextEntry = isContentEditable
    || /^(TEXTAREA|SELECT)$/i.test(tagName)
    || (tagName.toUpperCase() === 'INPUT' && inputType !== 'range');
  if (String(key || '').toLowerCase() === 'f') {
    if (isTextEntry || ctrlKey || altKey || metaKey) return null;
    return { type: 'toggle-fullscreen' };
  }
  const isPlayerControlArrow = !!isPlayerControl && (key === 'ArrowLeft' || key === 'ArrowRight');
  if (isTextEntry || (/^(BUTTON|A)$/i.test(tagName) && !isPlayerControlArrow)) return null;
  if (key === 'ArrowLeft') return { type: 'seek', seconds: -VIDEO_SEEK_SECONDS };
  if (key === 'ArrowRight') return { type: 'seek', seconds: VIDEO_SEEK_SECONDS };
  if (key === ' ' || key === 'Spacebar') return { type: 'toggle-play' };
  return null;
}

export function getLongPressPlaybackRate(isHolding) {
  return isHolding ? 2 : 1;
}

export function getKeyboardLongPressPlaybackRate(currentRate) {
  return normalizeVideoPlaybackRate(getRestoredPlaybackRate(currentRate) + 1);
}

export function getRestoredPlaybackRate(previousRate) {
  return Number.isFinite(previousRate) && previousRate > 0 ? previousRate : 1;
}
