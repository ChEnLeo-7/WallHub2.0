import { cn } from '@/lib/utils';
import { VideoControls } from './VideoControls';
import type { VideoDialogController } from './useVideoDialogController';

export function VideoPlayer({ controller }: { controller: VideoDialogController }) {
  const {
    compatibilityMode,
    controlsVisible,
    desktopVideoInteraction,
    finishLongPress,
    fittedVideoSize,
    fullscreenActive,
    handleMobileVideoDoubleClick,
    handleVideoClick,
    keyboardLongPressActive,
    longPressActive,
    onLoadedMetadata,
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
    text,
    videoRef,
  } = controller;
  return (
    <div
      ref={playerShellRef}
      className={cn(
        'relative bg-black',
        fullscreenActive && 'wallhub-video-fullscreen-height flex w-screen min-h-0 flex-1 items-center justify-center overflow-hidden',
        compatibilityMode && !controlsVisible && 'cursor-none',
      )}
      onPointerMove={compatibilityMode ? showControls : undefined}
      onPointerDown={compatibilityMode ? showControls : undefined}
      onPointerLeave={compatibilityMode ? scheduleControlsHide : undefined}
    >
      <video
        ref={videoRef}
        className={cn('block shrink-0 touch-manipulation bg-black', fullscreenActive ? 'h-full w-full object-contain' : 'w-full')}
        style={!fullscreenActive && fittedVideoSize ? { height: `${fittedVideoSize.height}px` } : undefined}
        src={readySrc}
        controls={!compatibilityMode}
        playsInline={compatibilityMode}
        autoPlay
        loop
        onClick={handleVideoClick}
        onDoubleClick={!desktopVideoInteraction ? handleMobileVideoDoubleClick : undefined}
        onPointerDown={startLongPress}
        onPointerUp={finishLongPress}
        onPointerCancel={finishLongPress}
        onPointerLeave={finishLongPress}
        onLostPointerCapture={finishLongPress}
        onContextMenu={(event) => {
          if (longPressActive) event.preventDefault();
        }}
        onLoadedMetadata={onLoadedMetadata}
        onDurationChange={compatibilityMode ? (event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0) : undefined}
        onTimeUpdate={compatibilityMode ? (event) => setCurrentTime(event.currentTarget.currentTime || 0) : undefined}
        onPlay={compatibilityMode ? () => setIsPlaying(true) : undefined}
        onPlaying={() => setPlaybackStarted(true)}
        onPause={compatibilityMode ? () => setIsPlaying(false) : undefined}
        onEnded={compatibilityMode ? () => setIsPlaying(false) : undefined}
        onVolumeChange={compatibilityMode ? onVolumeChange : undefined}
      />
      {compatibilityMode ? <VideoControls controller={controller} /> : null}
      {longPressActive || keyboardLongPressActive ? (
        <div className="pointer-events-none absolute left-1/2 top-[max(1rem,6%)] z-30 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/15 bg-black/45 px-5 py-3 text-sm font-semibold text-white/90 shadow-lg backdrop-blur-sm sm:px-6 sm:py-3.5 sm:text-base">
          {text.videoSpeedPlaying}
        </div>
      ) : null}
    </div>
  );
}
