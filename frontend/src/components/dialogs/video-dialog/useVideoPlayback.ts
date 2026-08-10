import * as React from 'react';

export function useVideoPlayback(videoRef: React.RefObject<HTMLVideoElement>) {
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [playbackStarted, setPlaybackStarted] = React.useState(false);

  const togglePlayback = React.useCallback(() => {
    const player = videoRef.current;
    if (!player) return;
    if (player.paused) void player.play().catch(() => {});
    else player.pause();
  }, [videoRef]);
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
