import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { VideoControls } from './VideoControls';
import type { VideoDialogController } from './useVideoDialogController';

export function VideoPlayer({ controller }: { controller: VideoDialogController }) {
  const {
    bandwidthLimited,
    buffering,
    cacheCompleteFile,
    cancelCompleteFileCache,
    controlsVisible,
    desktopVideoInteraction,
    decodeError,
    finishLongPress,
    fittedVideoSize,
    fullscreenActive,
    fullCache,
    handleMobileVideoDoubleClick,
    handleVideoClick,
    keyboardLongPressActive,
    isDepot,
    longPressActive,
    longPressPlaybackRate,
    onLoadedMetadata,
    onDepotEnded,
    onDepotError,
    onDepotPause,
    onDepotPlay,
    onDepotPlaying,
    onDepotProgress,
    onDepotSeeked,
    onDepotSeeking,
    onDepotStalled,
    onDepotWaiting,
    onVolumeChange,
    playerShellRef,
    readySrc,
    scheduleControlsHide,
    setCurrentTime,
    setDuration,
    setIsPlaying,
    setPlaybackStarted,
    showControls,
    startLongPress,
    syncBufferedRanges,
    text,
    videoRef,
  } = controller;
  return (
    <div
      ref={playerShellRef}
      className={cn(
        'relative bg-black',
        fullscreenActive && 'wallhub-video-fullscreen-height flex w-screen min-h-0 flex-1 items-center justify-center overflow-hidden',
        !controlsVisible && 'cursor-none',
      )}
      onPointerMove={showControls}
      onPointerDown={showControls}
      onPointerLeave={scheduleControlsHide}
    >
      <video
        ref={videoRef}
        className={cn('block shrink-0 touch-manipulation bg-black', fullscreenActive ? 'h-full w-full object-contain' : 'w-full')}
        style={!fullscreenActive && fittedVideoSize ? { height: `${fittedVideoSize.height}px` } : undefined}
        src={readySrc}
        preload="auto"
        controls={false}
        controlsList="nodownload noplaybackrate noremoteplayback"
        disablePictureInPicture
        disableRemotePlayback
        playsInline
        autoPlay
        loop
        onClick={handleVideoClick}
        onDoubleClick={!desktopVideoInteraction ? handleMobileVideoDoubleClick : undefined}
        onPointerDown={startLongPress}
        onPointerUp={finishLongPress}
        onPointerCancel={finishLongPress}
        onPointerLeave={finishLongPress}
        onLostPointerCapture={finishLongPress}
        onContextMenu={(event) => event.preventDefault()}
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={(event) => {
          setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0);
          syncBufferedRanges(event.currentTarget);
        }}
        onTimeUpdate={(event) => {
          setCurrentTime(event.currentTarget.currentTime || 0);
          syncBufferedRanges(event.currentTarget);
          onDepotProgress(event.currentTarget);
        }}
        onProgress={(event) => { syncBufferedRanges(event.currentTarget); onDepotProgress(event.currentTarget); }}
        onCanPlay={(event) => { syncBufferedRanges(event.currentTarget); onDepotProgress(event.currentTarget); }}
        onCanPlayThrough={(event) => { syncBufferedRanges(event.currentTarget); onDepotProgress(event.currentTarget); }}
        onSeeking={(event) => { syncBufferedRanges(event.currentTarget); onDepotSeeking(event.currentTarget); }}
        onSeeked={(event) => { syncBufferedRanges(event.currentTarget); onDepotSeeked(event.currentTarget); }}
        onPlay={(event) => { setIsPlaying(true); onDepotPlay(event.currentTarget); }}
        onPlaying={(event) => { setPlaybackStarted(true); onDepotPlaying(event.currentTarget); }}
        onPause={(event) => { setIsPlaying(false); onDepotPause(event.currentTarget); }}
        onWaiting={(event) => onDepotWaiting(event.currentTarget)}
        onStalled={(event) => onDepotStalled(event.currentTarget)}
        onEnded={(event) => { setIsPlaying(false); onDepotEnded(event.currentTarget); }}
        onError={(event) => onDepotError(event.currentTarget)}
        onEmptied={(event) => syncBufferedRanges(event.currentTarget)}
        onVolumeChange={onVolumeChange}
      />
      <VideoControls controller={controller} />
      {buffering ? (
        <div className="pointer-events-none absolute bottom-20 left-1/2 z-20 w-[min(28rem,calc(100%-2rem))] -translate-x-1/2 rounded-md border border-white/15 bg-black/75 px-3 py-2 text-white shadow-lg backdrop-blur-sm">
          <div className="mb-1.5 flex items-center justify-between gap-3 text-xs leading-4 text-white/85">
            <span>{buffering.phase === 'recovering' ? text.videoBufferRecovering : text.videoBufferPreparing}</span>
            <span className="tabular-nums">{Math.round(buffering.progress * 100)}%</span>
          </div>
          <div className="h-1.5 overflow-hidden rounded-full bg-white/20">
            <div className="h-full rounded-full bg-emerald-400 transition-[width] duration-300" style={{ width: `${Math.round(buffering.progress * 100)}%` }} />
          </div>
        </div>
      ) : null}
      {decodeError || bandwidthLimited || fullCache ? (
        <div className="absolute inset-x-3 top-3 z-30 mx-auto flex max-w-xl items-center justify-between gap-3 rounded-md border border-white/15 bg-black/80 px-3 py-2 text-white shadow-lg backdrop-blur-sm sm:inset-x-4 sm:top-4">
          <div className="min-w-0 text-xs leading-5 text-white/85 sm:text-sm">
            {decodeError
              ? text.videoDecodeError
              : fullCache?.status === 'caching'
                ? `${text.videoCachingCompleteFile} ${Math.round(fullCache.progress * 100)}%`
                : fullCache?.status === 'complete'
                  ? text.videoCompleteFileCached
                  : fullCache?.status === 'error'
                    ? fullCache.code === 'DEPOT_STREAM_FULL_CACHE_LIMIT'
                      ? text.videoCompleteFileCacheLimit
                      : text.videoCompleteFileCacheFailed
                    : text.videoBandwidthLimited}
          </div>
          {!decodeError && fullCache?.status === 'caching' ? (
            <Button variant="secondary" size="sm" className="shrink-0" onClick={cancelCompleteFileCache}>
              {text.cancel}
            </Button>
          ) : !decodeError && bandwidthLimited && fullCache?.status !== 'complete' ? (
            <Button variant="secondary" size="sm" className="shrink-0" onClick={cacheCompleteFile}>
              {text.videoCacheCompleteFile}
            </Button>
          ) : null}
        </div>
      ) : null}
      {longPressActive || keyboardLongPressActive ? (
        <div className="pointer-events-none absolute left-1/2 top-[max(1rem,6%)] z-30 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/15 bg-black/45 px-5 py-3 text-sm font-semibold text-white/90 shadow-lg backdrop-blur-sm sm:px-6 sm:py-3.5 sm:text-base">
          {text.videoSpeedPlaying.replace('{rate}', String(longPressPlaybackRate || 2))}
        </div>
      ) : null}
    </div>
  );
}
