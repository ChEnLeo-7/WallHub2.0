import * as React from 'react';

export function useVideoSeek(videoRef: React.RefObject<HTMLVideoElement>) {
  const [currentTime, setCurrentTime] = React.useState(0);
  const [seekPreviewTime, setSeekPreviewTime] = React.useState<number | null>(null);
  const [duration, setDuration] = React.useState(0);
  const [isSeeking, setIsSeeking] = React.useState(false);
  const seekingRef = React.useRef(false);
  const seekPreviewTimeRef = React.useRef<number | null>(null);

  const resetVideoSeek = React.useCallback(() => {
    setCurrentTime(0);
    seekPreviewTimeRef.current = null;
    setSeekPreviewTime(null);
    seekingRef.current = false;
    setIsSeeking(false);
    setDuration(0);
  }, []);
  const seekVideo = React.useCallback((seconds: number) => {
    const player = videoRef.current;
    if (!player || !Number.isFinite(player.duration)) return;
    player.currentTime = Math.min(player.duration, Math.max(0, player.currentTime + seconds));
  }, [videoRef]);
  const beginVideoSeek = React.useCallback(() => {
    const player = videoRef.current;
    if (!player || !Number.isFinite(player.duration)) return;
    const initialValue = Math.min(player.duration, Math.max(0, player.currentTime));
    seekingRef.current = true;
    seekPreviewTimeRef.current = initialValue;
    setSeekPreviewTime(initialValue);
    setIsSeeking(true);
  }, [videoRef]);
  const previewVideoPosition = React.useCallback((value: number) => {
    const player = videoRef.current;
    if (!player || !Number.isFinite(player.duration)) return;
    const nextValue = Math.min(player.duration, Math.max(0, value));
    if (!seekingRef.current) {
      player.currentTime = nextValue;
      setCurrentTime(nextValue);
      return;
    }
    seekPreviewTimeRef.current = nextValue;
    setSeekPreviewTime(nextValue);
  }, [videoRef]);
  const finishVideoSeek = React.useCallback(() => {
    const pendingValue = seekPreviewTimeRef.current;
    seekPreviewTimeRef.current = null;
    seekingRef.current = false;
    setSeekPreviewTime(null);
    setIsSeeking(false);
    if (pendingValue == null) return;
    const player = videoRef.current;
    if (!player || !Number.isFinite(player.duration)) return;
    const nextValue = Math.min(player.duration, Math.max(0, pendingValue));
    player.currentTime = nextValue;
    setCurrentTime(nextValue);
  }, [videoRef]);
  const cancelVideoSeek = React.useCallback(() => {
    seekPreviewTimeRef.current = null;
    seekingRef.current = false;
    setSeekPreviewTime(null);
    setIsSeeking(false);
  }, []);

  React.useEffect(() => {
    if (!isSeeking) return;
    window.addEventListener('pointerup', finishVideoSeek);
    window.addEventListener('pointercancel', cancelVideoSeek);
    return () => {
      window.removeEventListener('pointerup', finishVideoSeek);
      window.removeEventListener('pointercancel', cancelVideoSeek);
    };
  }, [cancelVideoSeek, finishVideoSeek, isSeeking]);

  return {
    beginVideoSeek,
    cancelVideoSeek,
    currentTime,
    displayedVideoTime: seekPreviewTime ?? currentTime,
    duration,
    finishVideoSeek,
    isSeeking,
    previewVideoPosition,
    resetVideoSeek,
    seekVideo,
    setCurrentTime,
    setDuration,
  };
}
