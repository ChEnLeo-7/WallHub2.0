import * as React from 'react';

const COMPATIBILITY_CONTROLS_HIDE_MS = 2400;

export function useVideoControlVisibility(isPlaying: boolean, isSeeking: boolean) {
  const [controlsVisible, setControlsVisible] = React.useState(true);
  const controlsHideTimerRef = React.useRef<number | null>(null);
  const controlsHoverRef = React.useRef(false);
  const controlsFocusRef = React.useRef(false);
  const playingRef = React.useRef(false);
  const seekingRef = React.useRef(false);

  const clearControlsHideTimer = React.useCallback(() => {
    if (controlsHideTimerRef.current == null) return;
    window.clearTimeout(controlsHideTimerRef.current);
    controlsHideTimerRef.current = null;
  }, []);
  const scheduleControlsHide = React.useCallback(() => {
    clearControlsHideTimer();
    if (!playingRef.current || seekingRef.current || controlsHoverRef.current || controlsFocusRef.current) return;
    controlsHideTimerRef.current = window.setTimeout(() => {
      controlsHideTimerRef.current = null;
      setControlsVisible(false);
    }, COMPATIBILITY_CONTROLS_HIDE_MS);
  }, [clearControlsHideTimer]);
  const showControls = React.useCallback(() => {
    setControlsVisible(true);
    scheduleControlsHide();
  }, [scheduleControlsHide]);
  const resetControlVisibility = React.useCallback(() => {
    setControlsVisible(true);
    clearControlsHideTimer();
  }, [clearControlsHideTimer]);

  React.useEffect(() => {
    playingRef.current = isPlaying;
    if (!isPlaying) {
      clearControlsHideTimer();
      setControlsVisible(true);
      return;
    }
    scheduleControlsHide();
  }, [clearControlsHideTimer, isPlaying, scheduleControlsHide]);
  React.useEffect(() => {
    seekingRef.current = isSeeking;
    if (isSeeking) {
      clearControlsHideTimer();
      setControlsVisible(true);
    } else scheduleControlsHide();
  }, [clearControlsHideTimer, isSeeking, scheduleControlsHide]);
  React.useEffect(() => clearControlsHideTimer, [clearControlsHideTimer]);

  return {
    clearControlsHideTimer,
    controlsFocusRef,
    controlsHoverRef,
    controlsVisible,
    resetControlVisibility,
    scheduleControlsHide,
    showControls,
  };
}
