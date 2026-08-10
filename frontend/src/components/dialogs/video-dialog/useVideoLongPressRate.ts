import * as React from 'react';

import {
  getLongPressPlaybackRate,
  getRestoredPlaybackRate,
  normalizeVideoPlaybackRate,
} from '@/lib/videoControls.mjs';

type VideoLongPressRateOptions = {
  compatibilityMode: boolean;
  videoRef: React.RefObject<HTMLVideoElement>;
};

export function useVideoLongPressRate({ compatibilityMode, videoRef }: VideoLongPressRateOptions) {
  const [longPressActive, setLongPressActive] = React.useState(false);
  const [keyboardLongPressActive, setKeyboardLongPressActive] = React.useState(false);
  const [playbackRate, setPlaybackRate] = React.useState(1);
  const [playbackRateMenuOpen, setPlaybackRateMenuOpen] = React.useState(false);
  const longPressTimerRef = React.useRef<number | null>(null);
  const longPressActiveRef = React.useRef(false);
  const playbackRateBeforeLongPressRef = React.useRef(1);
  const keyboardLongPressActiveRef = React.useRef(false);
  const keyboardPlaybackRateBeforeLongPressRef = React.useRef(1);
  const suppressVideoClickRef = React.useRef(false);
  const playbackRateMenuOpenRef = React.useRef(false);
  const playbackRateMenuDismissedRef = React.useRef(false);

  const stopLongPress = React.useCallback(() => {
    if (longPressTimerRef.current != null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    if (!longPressActiveRef.current) return;
    longPressActiveRef.current = false;
    if (videoRef.current) videoRef.current.playbackRate = getRestoredPlaybackRate(playbackRateBeforeLongPressRef.current);
    playbackRateBeforeLongPressRef.current = 1;
    setLongPressActive(false);
  }, [videoRef]);
  const startLongPress = React.useCallback((event: React.PointerEvent<HTMLVideoElement>) => {
    if (!playbackRateMenuOpenRef.current) playbackRateMenuDismissedRef.current = false;
    if (playbackRateMenuOpenRef.current || event.button !== 0 || longPressTimerRef.current != null || longPressActiveRef.current) return;
    if (!compatibilityMode || event.pointerType !== 'mouse') event.currentTarget.setPointerCapture?.(event.pointerId);
    suppressVideoClickRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      const player = videoRef.current;
      if (!player) return;
      playbackRateBeforeLongPressRef.current = getRestoredPlaybackRate(player.playbackRate);
      player.playbackRate = getLongPressPlaybackRate(true);
      longPressActiveRef.current = true;
      suppressVideoClickRef.current = true;
      setLongPressActive(true);
    }, 350);
  }, [compatibilityMode, videoRef]);
  const finishLongPress = React.useCallback(() => {
    const shouldSuppressClick = longPressActiveRef.current;
    stopLongPress();
    if (shouldSuppressClick) window.setTimeout(() => { suppressVideoClickRef.current = false; }, 0);
  }, [stopLongPress]);
  const startKeyboardLongPress = React.useCallback(() => {
    const player = videoRef.current;
    if (!player) return false;
    keyboardPlaybackRateBeforeLongPressRef.current = getRestoredPlaybackRate(player.playbackRate);
    player.playbackRate = getLongPressPlaybackRate(true);
    keyboardLongPressActiveRef.current = true;
    setKeyboardLongPressActive(true);
    return true;
  }, [videoRef]);
  const finishKeyboardLongPress = React.useCallback(() => {
    const wasLongPress = keyboardLongPressActiveRef.current;
    if (wasLongPress) {
      const player = videoRef.current;
      if (player) player.playbackRate = getRestoredPlaybackRate(keyboardPlaybackRateBeforeLongPressRef.current);
      keyboardLongPressActiveRef.current = false;
    }
    keyboardPlaybackRateBeforeLongPressRef.current = 1;
    setKeyboardLongPressActive(false);
    return wasLongPress;
  }, [videoRef]);
  const setVideoPlaybackRate = React.useCallback((value: number) => {
    const rate = normalizeVideoPlaybackRate(value);
    setPlaybackRate(rate);
    if (longPressActiveRef.current) {
      playbackRateBeforeLongPressRef.current = rate;
      return;
    }
    if (keyboardLongPressActiveRef.current) {
      keyboardPlaybackRateBeforeLongPressRef.current = rate;
      return;
    }
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, [videoRef]);
  const handlePlaybackRateMenuOpenChange = React.useCallback((open: boolean) => {
    if (playbackRateMenuOpenRef.current && !open) playbackRateMenuDismissedRef.current = true;
    playbackRateMenuOpenRef.current = open;
    setPlaybackRateMenuOpen(open);
  }, []);
  const resetPlaybackRate = React.useCallback(() => {
    setPlaybackRate(1);
    playbackRateMenuOpenRef.current = false;
    playbackRateMenuDismissedRef.current = false;
    setPlaybackRateMenuOpen(false);
    if (videoRef.current) videoRef.current.playbackRate = 1;
  }, [videoRef]);

  React.useEffect(() => () => {
    stopLongPress();
    finishKeyboardLongPress();
  }, [finishKeyboardLongPress, stopLongPress]);

  return {
    finishKeyboardLongPress,
    finishLongPress,
    handlePlaybackRateMenuOpenChange,
    keyboardLongPressActiveRef,
    keyboardLongPressActive,
    longPressActive,
    playbackRate,
    playbackRateMenuDismissedRef,
    playbackRateMenuOpen,
    playbackRateMenuOpenRef,
    resetPlaybackRate,
    setVideoPlaybackRate,
    startKeyboardLongPress,
    startLongPress,
    suppressVideoClickRef,
  };
}
