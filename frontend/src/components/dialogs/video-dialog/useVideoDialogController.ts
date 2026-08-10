import * as React from 'react';
import { useReducedMotion } from 'motion/react';

import { useText } from '@/lib/text';
import type { VideoDialogProps } from './types';
import { useVideoAudio } from './useVideoAudio';
import { useVideoControlVisibility } from './useVideoControlVisibility';
import { useVideoFullscreen } from './useVideoFullscreen';
import { useVideoInteraction } from './useVideoInteraction';
import { useVideoKeyboard } from './useVideoKeyboard';
import { useVideoLayout } from './useVideoLayout';
import { useVideoLongPressRate } from './useVideoLongPressRate';
import { useVideoPlayback } from './useVideoPlayback';
import { useVideoReadiness } from './useVideoReadiness';
import { useVideoSeek } from './useVideoSeek';

export { VIDEO_READY_POLL_MS } from './useVideoReadiness';

export function useVideoDialogController({ video, playerMode, onOpenChange }: VideoDialogProps) {
  const text = useText();
  const reduceMotion = useReducedMotion();
  const compatibilityMode = playerMode === 'compatibility';
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const playerShellRef = React.useRef<HTMLDivElement | null>(null);
  const controlsRef = React.useRef<HTMLDivElement | null>(null);
  const [videoSize, setVideoSize] = React.useState<{ width: number; height: number } | null>(null);
  const { checking, readySrc } = useVideoReadiness(video);
  const seek = useVideoSeek(videoRef);
  const playback = useVideoPlayback(videoRef);
  const controlVisibility = useVideoControlVisibility(compatibilityMode, playback.isPlaying, seek.isSeeking);
  const longPressRate = useVideoLongPressRate({ compatibilityMode, videoRef });
  const audio = useVideoAudio(videoRef);
  const layout = useVideoLayout(videoSize);

  const fullscreen = useVideoFullscreen({
    playerMode,
    playerShellRef,
    readySrc,
    showControls: controlVisibility.showControls,
    videoRef,
  });
  const interaction = useVideoInteraction({
    compatibilityMode,
    desktopVideoInteraction: layout.desktopVideoInteraction,
    playbackRateMenuDismissedRef: longPressRate.playbackRateMenuDismissedRef,
    playbackRateMenuOpen: longPressRate.playbackRateMenuOpen,
    playbackRateMenuOpenRef: longPressRate.playbackRateMenuOpenRef,
    showControls: controlVisibility.showControls,
    suppressVideoClickRef: longPressRate.suppressVideoClickRef,
    togglePlayback: playback.togglePlayback,
  });

  useVideoKeyboard({
    controlsRef,
    finishKeyboardLongPress: longPressRate.finishKeyboardLongPress,
    keyboardLongPressActiveRef: longPressRate.keyboardLongPressActiveRef,
    readySrc,
    seekVideo: seek.seekVideo,
    startKeyboardLongPress: longPressRate.startKeyboardLongPress,
    toggleFullscreen: fullscreen.toggleFullscreen,
    togglePlayback: playback.togglePlayback,
  });

  React.useEffect(() => {
    setVideoSize(null);
  }, [video?.src, video?.status]);
  React.useEffect(() => {
    seek.resetVideoSeek();
    playback.resetVideoPlayback();
    longPressRate.resetPlaybackRate();
    controlVisibility.resetControlVisibility();
  }, [
    controlVisibility.resetControlVisibility,
    longPressRate.resetPlaybackRate,
    playback.resetVideoPlayback,
    playerMode,
    readySrc,
    seek.resetVideoSeek,
  ]);

  const handleDialogOpenChange = React.useCallback((open: boolean) => {
    if (!open && fullscreen.fullscreenActive) void fullscreen.leaveFullscreen();
    onOpenChange(open);
  }, [fullscreen.fullscreenActive, fullscreen.leaveFullscreen, onOpenChange]);
  const onLoadedMetadata = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    const element = event.currentTarget;
    if (element.videoWidth && element.videoHeight) setVideoSize({ width: element.videoWidth, height: element.videoHeight });
    if (!compatibilityMode) return;
    seek.setDuration(Number.isFinite(element.duration) ? element.duration : 0);
    seek.setCurrentTime(element.currentTime || 0);
    audio.syncVideoAudio(element);
  }, [audio.syncVideoAudio, compatibilityMode, seek.setCurrentTime, seek.setDuration]);

  return {
    beginVideoSeek: seek.beginVideoSeek,
    cancelVideoSeek: seek.cancelVideoSeek,
    checking,
    clearControlsHideTimer: controlVisibility.clearControlsHideTimer,
    compatibilityMode,
    controlsFocusRef: controlVisibility.controlsFocusRef,
    controlsHoverRef: controlVisibility.controlsHoverRef,
    controlsRef,
    controlsVisible: controlVisibility.controlsVisible,
    desktopVideoInteraction: layout.desktopVideoInteraction,
    displayedVideoTime: seek.displayedVideoTime,
    duration: seek.duration,
    fallbackFullscreen: fullscreen.fallbackFullscreen,
    finishLongPress: longPressRate.finishLongPress,
    finishVideoSeek: seek.finishVideoSeek,
    fittedVideoSize: layout.fittedVideoSize,
    fullscreenActive: fullscreen.fullscreenActive,
    handleDialogOpenChange,
    handleMobileVideoDoubleClick: interaction.handleMobileVideoDoubleClick,
    handlePlaybackRateMenuOpenChange: longPressRate.handlePlaybackRateMenuOpenChange,
    handleVideoClick: interaction.handleVideoClick,
    isPlaying: playback.isPlaying,
    keyboardLongPressActive: longPressRate.keyboardLongPressActive,
    longPressActive: longPressRate.longPressActive,
    muted: audio.muted,
    onLoadedMetadata,
    onVolumeChange: audio.onVolumeChange,
    playbackRate: longPressRate.playbackRate,
    playbackStarted: playback.playbackStarted,
    playerShellRef,
    previewVideoPosition: seek.previewVideoPosition,
    readySrc,
    reduceMotion,
    scheduleControlsHide: controlVisibility.scheduleControlsHide,
    setCurrentTime: seek.setCurrentTime,
    setDuration: seek.setDuration,
    setIsPlaying: playback.setIsPlaying,
    setPlaybackStarted: playback.setPlaybackStarted,
    setVideoPlaybackRate: longPressRate.setVideoPlaybackRate,
    setVideoVolume: audio.setVideoVolume,
    showControls: controlVisibility.showControls,
    startLongPress: longPressRate.startLongPress,
    text,
    toggleFullscreen: fullscreen.toggleFullscreen,
    toggleMute: audio.toggleMute,
    togglePlayback: playback.togglePlayback,
    videoRef,
    volume: audio.volume,
  };
}

export type VideoDialogController = ReturnType<typeof useVideoDialogController>;
