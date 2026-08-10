import * as React from 'react';

export function useVideoAudio(videoRef: React.RefObject<HTMLVideoElement>) {
  const [volume, setVolume] = React.useState(1);
  const [muted, setMuted] = React.useState(false);
  const lastAudibleVolumeRef = React.useRef(1);

  const syncVideoAudio = React.useCallback((element: HTMLVideoElement) => {
    setVolume(element.volume);
    setMuted(element.muted);
    if (element.volume > 0) lastAudibleVolumeRef.current = element.volume;
  }, []);
  const onVolumeChange = React.useCallback((event: React.SyntheticEvent<HTMLVideoElement>) => {
    syncVideoAudio(event.currentTarget);
  }, [syncVideoAudio]);
  const setVideoVolume = React.useCallback((value: number) => {
    const player = videoRef.current;
    if (!player) return;
    const nextVolume = Math.min(1, Math.max(0, value));
    player.volume = nextVolume;
    if (nextVolume > 0) lastAudibleVolumeRef.current = nextVolume;
    if (player.volume > 0) player.muted = false;
  }, [videoRef]);
  const toggleMute = React.useCallback(() => {
    const player = videoRef.current;
    if (!player) return;
    if (player.muted || player.volume === 0) {
      if (player.volume === 0) player.volume = lastAudibleVolumeRef.current || 1;
      player.muted = false;
      return;
    }
    lastAudibleVolumeRef.current = player.volume;
    player.muted = true;
  }, [videoRef]);

  return { muted, onVolumeChange, setVideoVolume, syncVideoAudio, toggleMute, volume };
}
