import * as React from 'react';

type VideoInteractionOptions = {
  desktopVideoInteraction: boolean;
  playbackRateMenuDismissedRef: React.MutableRefObject<boolean>;
  playbackRateMenuOpen: boolean;
  playbackRateMenuOpenRef: React.MutableRefObject<boolean>;
  showControls: () => void;
  suppressVideoClickRef: React.MutableRefObject<boolean>;
  togglePlayback: () => void;
};

export function useVideoInteraction({
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
  const handleVideoClick = React.useCallback((event: React.MouseEvent<HTMLVideoElement>) => {
    if (suppressVideoClickRef.current || dismissPlaybackRateMenuClick()) return;
    if (!desktopVideoInteraction) {
      event.preventDefault();
      showControls();
      return;
    }
    togglePlayback();
    showControls();
  }, [desktopVideoInteraction, dismissPlaybackRateMenuClick, showControls, suppressVideoClickRef, togglePlayback]);
  const handleMobileVideoDoubleClick = React.useCallback((event: React.MouseEvent<HTMLVideoElement>) => {
    if (desktopVideoInteraction || suppressVideoClickRef.current) return;
    event.preventDefault();
    if (dismissPlaybackRateMenuClick()) return;
    togglePlayback();
    showControls();
  }, [desktopVideoInteraction, dismissPlaybackRateMenuClick, showControls, suppressVideoClickRef, togglePlayback]);

  return { handleMobileVideoDoubleClick, handleVideoClick };
}
