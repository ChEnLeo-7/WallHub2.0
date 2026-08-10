import * as React from 'react';

import type { VideoState } from './types';

export const VIDEO_READY_POLL_MS = 1500;

export function useVideoReadiness(video: VideoState | null) {
  const [readySrc, setReadySrc] = React.useState('');
  const [checking, setChecking] = React.useState(false);

  React.useEffect(() => {
    setReadySrc(video?.status === 'ready' && video.src ? video.src : '');
    if (!video?.src || video.status === 'ready') return;
    let cancelled = false;
    let controller: AbortController | null = null;
    const check = async () => {
      controller?.abort();
      controller = new AbortController();
      setChecking(true);
      try {
        const response = await fetch(video.src || '', {
          method: 'GET',
          headers: { Range: 'bytes=0-0' },
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!cancelled && (response.ok || response.status === 206)) setReadySrc(video.src || '');
      } catch (error) {
        if ((error as Error)?.name !== 'AbortError') {
          // Keep the loading state until the next poll.
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    };
    void check();
    const timer = window.setInterval(check, VIDEO_READY_POLL_MS);
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [video?.src, video?.status]);

  return { checking, readySrc };
}
