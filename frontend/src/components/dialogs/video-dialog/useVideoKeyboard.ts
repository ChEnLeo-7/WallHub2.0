import * as React from 'react';

import { getVideoKeyboardAction } from '@/lib/videoControls.mjs';

const KEYBOARD_LONG_PRESS_DELAY_MS = 350;

type VideoKeyboardOptions = {
  controlsRef: React.RefObject<HTMLDivElement>;
  finishKeyboardLongPress: () => boolean;
  keyboardLongPressActiveRef: React.RefObject<boolean>;
  readySrc: string;
  seekVideo: (seconds: number) => void;
  startKeyboardLongPress: () => boolean;
  toggleFullscreen: () => void;
  togglePlayback: () => void;
};

export function useVideoKeyboard({
  controlsRef,
  finishKeyboardLongPress,
  keyboardLongPressActiveRef,
  readySrc,
  seekVideo,
  startKeyboardLongPress,
  toggleFullscreen,
  togglePlayback,
}: VideoKeyboardOptions) {
  const keyboardLongPressDelayRef = React.useRef<number | null>(null);
  const keyboardPendingSeekSecondsRef = React.useRef(0);
  const keyboardPendingSeekKeyRef = React.useRef<'ArrowLeft' | 'ArrowRight' | null>(null);

  const stopKeyboardLongPress = React.useCallback((seekOnRelease = false) => {
    const pendingSeekSeconds = keyboardPendingSeekSecondsRef.current;
    if (keyboardLongPressDelayRef.current != null) {
      window.clearTimeout(keyboardLongPressDelayRef.current);
      keyboardLongPressDelayRef.current = null;
    }
    const wasLongPress = finishKeyboardLongPress();
    keyboardPendingSeekSecondsRef.current = 0;
    keyboardPendingSeekKeyRef.current = null;
    if (seekOnRelease && !wasLongPress && pendingSeekSeconds !== 0) seekVideo(pendingSeekSeconds);
  }, [finishKeyboardLongPress, seekVideo]);

  React.useEffect(() => {
    if (!readySrc) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const action = getVideoKeyboardAction({
        key: event.key,
        targetTagName: target?.tagName,
        targetInputType: target instanceof HTMLInputElement ? target.type : '',
        isContentEditable: !!target?.isContentEditable,
        isPlayerControl: !!(target && controlsRef.current?.contains(target)),
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action.type === 'toggle-play') {
        if (!event.repeat) togglePlayback();
        return;
      }
      if (action.type === 'toggle-fullscreen') {
        if (!event.repeat) toggleFullscreen();
        return;
      }
      if (event.repeat) return;
      stopKeyboardLongPress();
      keyboardPendingSeekSecondsRef.current = action.seconds;
      keyboardPendingSeekKeyRef.current = event.key === 'ArrowLeft' ? 'ArrowLeft' : 'ArrowRight';
      if (action.seconds > 0) {
        keyboardLongPressDelayRef.current = window.setTimeout(() => {
          keyboardLongPressDelayRef.current = null;
          if (!startKeyboardLongPress()) {
            keyboardPendingSeekSecondsRef.current = 0;
            keyboardPendingSeekKeyRef.current = null;
            return;
          }
          keyboardPendingSeekSecondsRef.current = 0;
        }, KEYBOARD_LONG_PRESS_DELAY_MS);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== keyboardPendingSeekKeyRef.current) return;
      if (keyboardLongPressDelayRef.current == null && !keyboardLongPressActiveRef.current && keyboardPendingSeekSecondsRef.current === 0) return;
      event.preventDefault();
      event.stopPropagation();
      stopKeyboardLongPress(true);
    };
    const onWindowBlur = () => stopKeyboardLongPress();
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') stopKeyboardLongPress();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopKeyboardLongPress();
    };
  }, [controlsRef, keyboardLongPressActiveRef, readySrc, startKeyboardLongPress, stopKeyboardLongPress, toggleFullscreen, togglePlayback]);
}
