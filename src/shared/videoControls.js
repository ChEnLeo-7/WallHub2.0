const VIDEO_SEEK_SECONDS = 5;
exports.VIDEO_SEEK_SECONDS = VIDEO_SEEK_SECONDS;

exports.getVideoKeyboardAction = function getVideoKeyboardAction({ key, targetTagName, isContentEditable } = {}) {
  if (isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON|A)$/i.test(String(targetTagName || ''))) return null;
  if (key === 'ArrowLeft') return { type: 'seek', seconds: -VIDEO_SEEK_SECONDS };
  if (key === 'ArrowRight') return { type: 'seek', seconds: VIDEO_SEEK_SECONDS };
  if (key === ' ' || key === 'Spacebar') return { type: 'toggle-play' };
  return null;
};

exports.getLongPressPlaybackRate = function getLongPressPlaybackRate(isHolding) {
  return isHolding ? 2 : 1;
};
