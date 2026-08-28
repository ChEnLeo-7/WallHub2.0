import { Maximize, Minimize, Pause, Play, Volume2, VolumeX } from 'lucide-react';

import { Select } from '@/components/ui/select';
import { formatVideoTime } from '@/lib/videoControls.mjs';
import { cn } from '@/lib/utils';
import type { VideoDialogController } from './useVideoDialogController';

const VIDEO_PLAYBACK_RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];
const VIDEO_PLAYBACK_RATE_SELECT_OPTIONS = VIDEO_PLAYBACK_RATE_OPTIONS.map((rate) => ({
  value: String(rate),
  label: `${rate}x`,
}));

export function VideoControls({ controller }: { controller: VideoDialogController }) {
  const {
    beginVideoSeek,
    bufferedRanges,
    cancelVideoSeek,
    clearControlsHideTimer,
    controlsFocusRef,
    controlsHoverRef,
    controlsRef,
    controlsVisible,
    displayedVideoTime,
    duration,
    finishVideoSeek,
    fullscreenActive,
    handlePlaybackRateMenuOpenChange,
    isPlaying,
    muted,
    playbackRate,
    playerShellRef,
    previewVideoPosition,
    scheduleControlsHide,
    setVideoPlaybackRate,
    setVideoVolume,
    showControls,
    text,
    toggleFullscreen,
    toggleMute,
    togglePlayback,
    volume,
  } = controller;
  const playedPercent = duration > 0 ? Math.min(100, Math.max(0, displayedVideoTime / duration * 100)) : 0;
  return (
    <div
      ref={controlsRef}
      className={cn(
        'absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-3 pb-3 pt-12 text-white transition-opacity duration-200 sm:px-4 sm:pb-4',
        controlsVisible ? 'opacity-100' : 'pointer-events-none opacity-0',
      )}
      onPointerMove={clearControlsHideTimer}
      onPointerDown={clearControlsHideTimer}
      onPointerUp={scheduleControlsHide}
      onPointerEnter={(event) => {
        if (event.pointerType === 'mouse') controlsHoverRef.current = true;
        clearControlsHideTimer();
        showControls();
      }}
      onPointerLeave={(event) => {
        if (event.pointerType === 'mouse') controlsHoverRef.current = false;
        scheduleControlsHide();
      }}
      onFocusCapture={() => {
        controlsFocusRef.current = true;
        clearControlsHideTimer();
        showControls();
      }}
      onBlurCapture={() => {
        window.requestAnimationFrame(() => {
          controlsFocusRef.current = !!controlsRef.current?.contains(document.activeElement);
          scheduleControlsHide();
        });
      }}
    >
      <div className="relative h-5 w-full">
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-white/25">
          {duration > 0 ? bufferedRanges.map((range, index) => (
            <span
              key={`${range.start}-${range.end}-${index}`}
              className="absolute inset-y-0 bg-white/45"
              style={{ left: `${range.start / duration * 100}%`, width: `${(range.end - range.start) / duration * 100}%` }}
            />
          )) : null}
          <span className="absolute inset-y-0 left-0 bg-white" style={{ width: `${playedPercent}%` }} />
        </div>
        <input
          className="wallhub-video-seek absolute inset-0 z-10 h-5 w-full cursor-pointer touch-none border-0 outline-none focus:outline-none focus-visible:outline-none focus-visible:ring-0"
          type="range"
          min={0}
          max={duration > 0 ? duration : 0}
          step="0.01"
          value={Math.min(displayedVideoTime, duration || 0)}
          disabled={duration <= 0}
          aria-label={text.videoSeek}
          aria-valuetext={`${formatVideoTime(displayedVideoTime)} / ${formatVideoTime(duration)}`}
          onPointerDown={beginVideoSeek}
          onPointerUp={finishVideoSeek}
          onPointerCancel={cancelVideoSeek}
          onChange={(event) => previewVideoPosition(Number(event.target.value))}
        />
      </div>
      <div className="mt-1 flex min-w-0 items-center gap-1 sm:gap-2">
        <button
          type="button"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          onClick={togglePlayback}
          onPointerUp={(event) => {
            if (event.pointerType === 'mouse') event.currentTarget.blur();
          }}
          aria-label={isPlaying ? text.videoPause : text.videoPlay}
          title={isPlaying ? text.videoPause : text.videoPlay}
        >
          {isPlaying ? <Pause className="h-5 w-5" fill="currentColor" /> : <Play className="h-5 w-5" fill="currentColor" />}
        </button>
        <span className="shrink-0 whitespace-nowrap text-[11px] font-medium tabular-nums text-white/90 sm:text-xs">
          {formatVideoTime(displayedVideoTime)} / {formatVideoTime(duration)}
        </span>
        <span className="min-w-0 flex-1" />
        <Select
          className="w-[4.5rem] shrink-0"
          value={String(playbackRate)}
          options={VIDEO_PLAYBACK_RATE_SELECT_OPTIONS}
          onChange={(value) => setVideoPlaybackRate(Number(value))}
          onOpenChange={handlePlaybackRateMenuOpenChange}
          ariaLabel={text.videoPlaybackRate}
          portalContainerRef={fullscreenActive ? playerShellRef : undefined}
          variant="media"
        />
        <button
          type="button"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          onClick={toggleMute}
          onPointerUp={(event) => {
            if (event.pointerType === 'mouse') event.currentTarget.blur();
          }}
          aria-label={muted || volume === 0 ? text.videoUnmute : text.videoMute}
          title={muted || volume === 0 ? text.videoUnmute : text.videoMute}
        >
          {muted || volume === 0 ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5" />}
        </button>
        <input
          className="hidden h-5 w-20 cursor-pointer accent-white sm:block"
          type="range"
          min={0}
          max={1}
          step="0.05"
          value={muted ? 0 : volume}
          aria-label={text.videoVolume}
          onChange={(event) => setVideoVolume(Number(event.target.value))}
        />
        <button
          type="button"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md text-white transition-colors hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/80"
          onClick={toggleFullscreen}
          onPointerUp={(event) => {
            if (event.pointerType === 'mouse') event.currentTarget.blur();
          }}
          aria-label={fullscreenActive ? text.videoExitFullscreen : text.videoEnterFullscreen}
          title={fullscreenActive ? text.videoExitFullscreen : text.videoEnterFullscreen}
        >
          {fullscreenActive ? <Minimize className="h-5 w-5" /> : <Maximize className="h-5 w-5" />}
        </button>
      </div>
    </div>
  );
}
