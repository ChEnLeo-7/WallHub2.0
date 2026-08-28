import * as React from 'react';

export function useVideoPlayback(
  videoRef: React.RefObject<HTMLVideoElement>,
  reportUserPlaybackIntent?: (video: HTMLVideoElement, willPause: boolean) => void,
) {
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [playbackStarted, setPlaybackStarted] = React.useState(false);

  const togglePlayback = React.useCallback(() => {
    const player = videoRef.current;
    if (!player) return;
    reportUserPlaybackIntent?.(player, !player.paused);
    if (player.paused) void player.play().catch(() => {});
    else player.pause();
  }, [reportUserPlaybackIntent, videoRef]);
  const resetVideoPlayback = React.useCallback(() => {
    setIsPlaying(false);
    setPlaybackStarted(false);
  }, []);

  return {
    isPlaying,
    playbackStarted,
    resetVideoPlayback,
    setIsPlaying,
    setPlaybackStarted,
    togglePlayback,
  };
}
