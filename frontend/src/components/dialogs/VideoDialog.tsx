import * as React from 'react';
import { Loader2, X } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useText } from '@/lib/text';
import { cn } from '@/lib/utils';
import { getLongPressPlaybackRate, getRestoredPlaybackRate, getVideoKeyboardAction } from '../../../../src/shared/videoControls.mjs';

export const VIDEO_READY_POLL_MS = 1500;

type VideoState = {
  id?: string;
  title: string;
  src?: string;
  status?: 'loading' | 'ready';
  message?: string;
  cdnWatchSince?: number;
};

export type { VideoState };

export function VideoDialog({
  video,
  onOpenChange,
}: {
  video: VideoState | null;
  onOpenChange: (open: boolean) => void;
}) {
  const text = useText();
  const [readySrc, setReadySrc] = React.useState('');
  const [checking, setChecking] = React.useState(false);
  const [videoSize, setVideoSize] = React.useState<{ width: number; height: number } | null>(null);
  const [viewportSize, setViewportSize] = React.useState(() => ({
    width: typeof window === 'undefined' ? 1024 : window.innerWidth,
    height: typeof window === 'undefined' ? 768 : window.innerHeight,
  }));
  const [longPressActive, setLongPressActive] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const longPressTimerRef = React.useRef<number | null>(null);
  const longPressActiveRef = React.useRef(false);
  const playbackRateBeforeLongPressRef = React.useRef(1);
  const keyboardFastForwardDelayRef = React.useRef<number | null>(null);
  const keyboardFastForwardTimerRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    setVideoSize(null);
    setReadySrc(video?.status === 'ready' && video.src ? video.src : '');
    if (!video?.src || video.status === 'ready') return;
    let cancelled = false;
    let controller: AbortController | null = null;
    const check = async () => {
      controller?.abort();
      controller = new AbortController();
      setChecking(true);
      try {
        const res = await fetch(video.src || '', { method: 'GET', headers: { Range: 'bytes=0-0' }, cache: 'no-store', signal: controller.signal });
        if (!cancelled && (res.ok || res.status === 206)) setReadySrc(video.src || '');
      } catch (e) {
        if ((e as Error)?.name !== 'AbortError') {
          // Keep the loading state until the next poll.
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    };
    check();
    const timer = window.setInterval(check, VIDEO_READY_POLL_MS);
    return () => {
      cancelled = true;
      controller?.abort();
      window.clearInterval(timer);
    };
  }, [video?.src, video?.status]);

  React.useEffect(() => {
    const update = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

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
  }, []);

  const startLongPress = React.useCallback((event: React.PointerEvent<HTMLVideoElement>) => {
    if (event.button !== 0 || longPressTimerRef.current != null || longPressActiveRef.current) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      const player = videoRef.current;
      if (!player) return;
      playbackRateBeforeLongPressRef.current = getRestoredPlaybackRate(player.playbackRate);
      player.playbackRate = getLongPressPlaybackRate(true);
      longPressActiveRef.current = true;
      setLongPressActive(true);
    }, 350);
  }, []);

  const seekVideo = React.useCallback((seconds: number) => {
    const player = videoRef.current;
    if (!player || !Number.isFinite(player.duration)) return;
    player.currentTime = Math.min(player.duration, Math.max(0, player.currentTime + seconds));
  }, []);

  const stopKeyboardFastForward = React.useCallback(() => {
    if (keyboardFastForwardDelayRef.current != null) {
      window.clearTimeout(keyboardFastForwardDelayRef.current);
      keyboardFastForwardDelayRef.current = null;
    }
    if (keyboardFastForwardTimerRef.current != null) {
      window.clearInterval(keyboardFastForwardTimerRef.current);
      keyboardFastForwardTimerRef.current = null;
    }
  }, []);

  React.useEffect(() => {
    if (!readySrc) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const action = getVideoKeyboardAction({
        key: event.key,
        targetTagName: target?.tagName,
        isContentEditable: !!target?.isContentEditable,
      });
      if (!action) return;
      event.preventDefault();
      if (action.type === 'toggle-play') {
        const player = videoRef.current;
        if (!player) return;
        if (player.paused) void player.play().catch(() => {});
        else player.pause();
        return;
      }
      seekVideo(action.seconds);
      if (action.seconds > 0 && !event.repeat && keyboardFastForwardDelayRef.current == null && keyboardFastForwardTimerRef.current == null) {
        keyboardFastForwardDelayRef.current = window.setTimeout(() => {
          keyboardFastForwardDelayRef.current = null;
          keyboardFastForwardTimerRef.current = window.setInterval(() => seekVideo(action.seconds), 180);
        }, 350);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight') stopKeyboardFastForward();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      stopKeyboardFastForward();
    };
  }, [readySrc, seekVideo, stopKeyboardFastForward]);

  React.useEffect(() => () => stopLongPress(), [stopLongPress]);

  const fittedVideoSize = React.useMemo(() => {
    if (!videoSize) return null;
    const desktop = viewportSize.width >= 640;
    const shellPadding = desktop ? 32 : 16;
    const headerHeight = desktop ? 64 : 56;
    const controlsReserve = desktop ? 34 : 42;
    const maxDialogHeight = Math.min(viewportSize.height - shellPadding, viewportSize.height * 0.92);
    const maxWidth = Math.max(240, viewportSize.width - shellPadding);
    const maxHeight = Math.max(180, maxDialogHeight - headerHeight - controlsReserve);
    const scale = Math.min(maxWidth / videoSize.width, maxHeight / videoSize.height, 1);
    return {
      width: Math.max(1, Math.round(videoSize.width * scale)),
      height: Math.max(1, Math.round(videoSize.height * scale)),
    };
  }, [videoSize, viewportSize.height, viewportSize.width]);

  return (
    <Dialog
      open={!!video}
      onOpenChange={onOpenChange}
      fixedHeight={false}
      bare
      title={video?.title || text.videoPlayer}
      fitContent={!!readySrc}
      className={cn(
        'max-h-[calc(100dvh-1rem)] border border-border bg-popover/95 text-popover-foreground shadow-panel backdrop-blur sm:max-h-[calc(100dvh-2rem)]',
        readySrc ? 'max-w-[calc(100vw-1rem)] sm:max-w-[calc(100vw-2rem)]' : 'w-full max-w-2xl',
      )}
    >
      {video ? (
        <div
          className="overflow-hidden rounded-2xl"
          style={
            readySrc && fittedVideoSize
              ? {
                  width: `${fittedVideoSize.width}px`,
                }
              : undefined
          }
        >
          <div className="flex min-h-14 items-center justify-between gap-4 border-b border-border/50 px-4 py-3 sm:px-5 sm:py-4">
            <div className="min-w-0 truncate text-base font-semibold tracking-tight">{video.title || text.videoPlayer}</div>
            <Button variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} aria-label={text.close}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          {readySrc ? (
            <div className="relative">
              <video
                ref={videoRef}
                className="block w-full shrink-0 bg-black"
                style={fittedVideoSize ? { height: `${fittedVideoSize.height}px` } : undefined}
                src={readySrc}
                controls
                autoPlay
                loop
                onPointerDown={startLongPress}
                onPointerUp={stopLongPress}
                onPointerCancel={stopLongPress}
                onPointerLeave={stopLongPress}
                onLostPointerCapture={stopLongPress}
                onContextMenu={(event) => {
                  if (longPressActive) event.preventDefault();
                }}
                onLoadedMetadata={(event) => {
                  const el = event.currentTarget;
                  if (el.videoWidth && el.videoHeight) setVideoSize({ width: el.videoWidth, height: el.videoHeight });
                }}
              />
              {longPressActive ? (
                <div className="pointer-events-none absolute left-1/2 top-1/2 rounded-full bg-black/70 px-4 py-2 text-sm font-semibold text-white shadow-lg -translate-x-1/2 -translate-y-1/2">
                  2×
                </div>
              ) : null}
            </div>
          ) : (
            <div className="grid min-h-[220px] place-items-center bg-black px-6 py-12 text-center text-white sm:min-h-[420px]">
              <div>
                <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-white/80" />
                <div className="text-sm font-medium">{text.videoLoading}</div>
                <div className="mt-1 text-xs text-white/60">{video.message || (checking ? text.videoPreparing : text.videoQueued)}</div>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}
