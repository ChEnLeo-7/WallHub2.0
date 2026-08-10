import * as React from 'react';

type VideoInteractionOptions = {
  compatibilityMode: boolean;
  desktopVideoInteraction: boolean;
  playbackRateMenuDismissedRef: React.MutableRefObject<boolean>;
  playbackRateMenuOpen: boolean;
  playbackRateMenuOpenRef: React.MutableRefObject<boolean>;
  showControls: () => void;
  suppressVideoClickRef: React.MutableRefObject<boolean>;
  togglePlayback: () => void;
};

export function useVideoInteraction({
  compatibilityMode,
  desktopVideoInteraction,
  playbackRateMenuDismissedRef,
  playbackRateMenuOpen,
  playbackRateMenuOpenRef,
  showControls,
  suppressVideoClickRef,
  togglePlayback,
}: VideoInteractionOptions) {
  const dismissPlaybackRateMenuClick = React.useCallback(() => {
    if (!playbackRateMenuOpen && !playbackRateMenuOpenRef.current && !playbackRateMenuDismissedRef.current) return false;
    playbackRateMenuDismissedRef.current = false;
    showControls();
    return true;
  }, [playbackRateMenuDismissedRef, playbackRateMenuOpen, playbackRateMenuOpenRef, showControls]);
  const isNativeControlsClick = React.useCallback((event: React.MouseEvent<HTMLVideoElement>) => {
    if (compatibilityMode) return false;
    const bounds = event.currentTarget.getBoundingClientRect();
    return event.clientY >= bounds.bottom - 56;
  }, [compatibilityMode]);
  const handleVideoClick = React.useCallback((event: React.MouseEvent<HTMLVideoElement>) => {
    if (suppressVideoClickRef.current || dismissPlaybackRateMenuClick() || isNativeControlsClick(event)) return;
    if (!desktopVideoInteraction) {
      event.preventDefault();
      showControls();
      return;
    }
    togglePlayback();
    showControls();
  }, [desktopVideoInteraction, dismissPlaybackRateMenuClick, isNativeControlsClick, showControls, suppressVideoClickRef, togglePlayback]);
  const handleMobileVideoDoubleClick = React.useCallback((event: React.MouseEvent<HTMLVideoElement>) => {
    if (desktopVideoInteraction || suppressVideoClickRef.current) return;
    event.preventDefault();
    if (dismissPlaybackRateMenuClick() || isNativeControlsClick(event)) return;
    togglePlayback();
    showControls();
  }, [desktopVideoInteraction, dismissPlaybackRateMenuClick, isNativeControlsClick, showControls, suppressVideoClickRef, togglePlayback]);

  return { handleMobileVideoDoubleClick, handleVideoClick };
}
