import * as React from 'react';
import { Loader2, Maximize, Minimize, Pause, Play, Volume2, VolumeX, X } from 'lucide-react';
import { motion, useReducedMotion } from 'motion/react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import type { VideoPlayerMode } from '@/hooks/usePreferences';
import { useText } from '@/lib/text';
import { cn } from '@/lib/utils';
import {
  formatVideoTime,
  getLongPressPlaybackRate,
  getRestoredPlaybackRate,
  getVideoKeyboardAction,
  normalizeVideoPlaybackRate,
} from '../../../../src/shared/videoControls.mjs';

export const VIDEO_READY_POLL_MS = 1500;
const COMPATIBILITY_CONTROLS_HIDE_MS = 2400;
const KEYBOARD_LONG_PRESS_DELAY_MS = 350;
const VIDEO_PLAYBACK_RATE_OPTIONS = [0.5, 0.75, 1, 1.25, 1.5, 1.75, 2, 2.25, 2.5, 2.75, 3];
const VIDEO_PLAYBACK_RATE_SELECT_OPTIONS = VIDEO_PLAYBACK_RATE_OPTIONS.map((rate) => ({
  value: String(rate),
  label: `${rate}x`,
}));

type VideoState = {
  id?: string;
  title: string;
  src?: string;
  status?: 'loading' | 'ready';
  message?: string;
  cdnWatchSince?: number;
};

type WebkitFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void | Promise<void>;
};

type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>;
};

type WebkitFullscreenVideo = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
};

function hasTouchVideoInteraction(pointerQuery?: MediaQueryList | null) {
  if (typeof window === 'undefined') return false;
  const touchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints;
  const coarsePointer = pointerQuery
    || (typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null);
  return touchPoints > 0 || !!coarsePointer?.matches;
}

export type { VideoState };

export function VideoDialog({
  video,
  playerMode,
  onOpenChange,
}: {
  video: VideoState | null;
  playerMode: VideoPlayerMode;
  onOpenChange: (open: boolean) => void;
}) {
  const text = useText();
  const reduceMotion = useReducedMotion();
  const compatibilityMode = playerMode === 'compatibility';
  const [readySrc, setReadySrc] = React.useState('');
  const [checking, setChecking] = React.useState(false);
  const [videoSize, setVideoSize] = React.useState<{ width: number; height: number } | null>(null);
  const [viewportSize, setViewportSize] = React.useState(() => ({
    width: typeof window === 'undefined' ? 1024 : window.innerWidth,
    height: typeof window === 'undefined' ? 768 : window.innerHeight,
  }));
  const [touchVideoInteraction, setTouchVideoInteraction] = React.useState(() => hasTouchVideoInteraction());
  const [longPressActive, setLongPressActive] = React.useState(false);
  const [isPlaying, setIsPlaying] = React.useState(false);
  const [playbackStarted, setPlaybackStarted] = React.useState(false);
  const [currentTime, setCurrentTime] = React.useState(0);
  const [seekPreviewTime, setSeekPreviewTime] = React.useState<number | null>(null);
  const [duration, setDuration] = React.useState(0);
  const [volume, setVolume] = React.useState(1);
  const [muted, setMuted] = React.useState(false);
  const [playbackRate, setPlaybackRate] = React.useState(1);
  const [playbackRateMenuOpen, setPlaybackRateMenuOpen] = React.useState(false);
  const [controlsVisible, setControlsVisible] = React.useState(true);
  const [isSeeking, setIsSeeking] = React.useState(false);
  const [systemFullscreen, setSystemFullscreen] = React.useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = React.useState(false);
  const [keyboardLongPressActive, setKeyboardLongPressActive] = React.useState(false);
  const videoRef = React.useRef<HTMLVideoElement | null>(null);
  const playerShellRef = React.useRef<HTMLDivElement | null>(null);
  const controlsRef = React.useRef<HTMLDivElement | null>(null);
  const longPressTimerRef = React.useRef<number | null>(null);
  const longPressActiveRef = React.useRef(false);
  const playbackRateBeforeLongPressRef = React.useRef(1);
  const suppressVideoClickRef = React.useRef(false);
  const keyboardLongPressDelayRef = React.useRef<number | null>(null);
  const keyboardLongPressActiveRef = React.useRef(false);
  const keyboardPlaybackRateBeforeLongPressRef = React.useRef(1);
  const keyboardPendingSeekSecondsRef = React.useRef(0);
  const keyboardPendingSeekKeyRef = React.useRef<'ArrowLeft' | 'ArrowRight' | null>(null);
  const playbackRateMenuOpenRef = React.useRef(false);
  const playbackRateMenuDismissedRef = React.useRef(false);
  const controlsHideTimerRef = React.useRef<number | null>(null);
  const controlsHoverRef = React.useRef(false);
  const controlsFocusRef = React.useRef(false);
  const playingRef = React.useRef(false);
  const seekingRef = React.useRef(false);
  const seekPreviewTimeRef = React.useRef<number | null>(null);
  const lastAudibleVolumeRef = React.useRef(1);
  const fullscreenActive = systemFullscreen || fallbackFullscreen;

  const clearControlsHideTimer = React.useCallback(() => {
    if (controlsHideTimerRef.current == null) return;
    window.clearTimeout(controlsHideTimerRef.current);
    controlsHideTimerRef.current = null;
  }, []);

  const scheduleControlsHide = React.useCallback(() => {
    clearControlsHideTimer();
    if (
      !compatibilityMode
      || !playingRef.current
      || seekingRef.current
      || controlsHoverRef.current
      || controlsFocusRef.current
    ) return;
    controlsHideTimerRef.current = window.setTimeout(() => {
      controlsHideTimerRef.current = null;
      setControlsVisible(false);
    }, COMPATIBILITY_CONTROLS_HIDE_MS);
  }, [clearControlsHideTimer, compatibilityMode]);

  const showControls = React.useCallback(() => {
    if (!compatibilityMode) return;
    setControlsVisible(true);
    scheduleControlsHide();
  }, [compatibilityMode, scheduleControlsHide]);

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
    void check();
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

  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const pointerQuery = window.matchMedia('(pointer: coarse)');
    const update = () => setTouchVideoInteraction(hasTouchVideoInteraction(pointerQuery));
    update();
    if (typeof pointerQuery.addEventListener === 'function') {
      pointerQuery.addEventListener('change', update);
      return () => pointerQuery.removeEventListener('change', update);
    }
    pointerQuery.addListener(update);
    return () => pointerQuery.removeListener(update);
  }, []);

  React.useEffect(() => {
    setCurrentTime(0);
    seekPreviewTimeRef.current = null;
    setSeekPreviewTime(null);
    seekingRef.current = false;
    setIsSeeking(false);
    setDuration(0);
    setIsPlaying(false);
    setPlaybackStarted(false);
    setPlaybackRate(1);
    setPlaybackRateMenuOpen(false);
    playbackRateMenuOpenRef.current = false;
    playbackRateMenuDismissedRef.current = false;
    if (videoRef.current) videoRef.current.playbackRate = 1;
    setControlsVisible(true);
    setFallbackFullscreen(false);
    setSystemFullscreen(false);
    clearControlsHideTimer();
  }, [clearControlsHideTimer, playerMode, readySrc]);

  React.useEffect(() => {
    playingRef.current = isPlaying;
    if (!compatibilityMode || !isPlaying) {
      clearControlsHideTimer();
      setControlsVisible(true);
      return;
    }
    scheduleControlsHide();
  }, [clearControlsHideTimer, compatibilityMode, isPlaying, scheduleControlsHide]);

  React.useEffect(() => {
    seekingRef.current = isSeeking;
    if (isSeeking) {
      clearControlsHideTimer();
      setControlsVisible(true);
    } else {
      scheduleControlsHide();
    }
  }, [clearControlsHideTimer, isSeeking, scheduleControlsHide]);

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
    if (!playbackRateMenuOpenRef.current) playbackRateMenuDismissedRef.current = false;
    if (playbackRateMenuOpenRef.current || event.button !== 0 || longPressTimerRef.current != null || longPressActiveRef.current) return;
    if (!compatibilityMode || event.pointerType !== 'mouse') {
      event.currentTarget.setPointerCapture?.(event.pointerId);
    }
    suppressVideoClickRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      const player = videoRef.current;
      if (!player) return;
      playbackRateBeforeLongPressRef.current = getRestoredPlaybackRate(player.playbackRate);
      player.playbackRate = getLongPressPlaybackRate(true);
      longPressActiveRef.current = true;
      suppressVideoClickRef.current = true;
      setLongPressActive(true);
    }, 350);
  }, [compatibilityMode]);

  const finishLongPress = React.useCallback(() => {
    const shouldSuppressClick = longPressActiveRef.current;
    stopLongPress();
    if (shouldSuppressClick) {
      window.setTimeout(() => {
        suppressVideoClickRef.current = false;
      }, 0);
    }
  }, [stopLongPress]);

  const seekVideo = React.useCallback((seconds: number) => {
    const player = videoRef.current;
    if (!player || !Number.isFinite(player.duration)) return;
    player.currentTime = Math.min(player.duration, Math.max(0, player.currentTime + seconds));
  }, []);

  const togglePlayback = React.useCallback(() => {
    const player = videoRef.current;
    if (!player) return;
    if (player.paused) void player.play().catch(() => {});
    else player.pause();
  }, []);

  const stopKeyboardLongPress = React.useCallback((seekOnRelease = false) => {
    const pendingSeekSeconds = keyboardPendingSeekSecondsRef.current;
    const wasLongPress = keyboardLongPressActiveRef.current;
    if (keyboardLongPressDelayRef.current != null) {
      window.clearTimeout(keyboardLongPressDelayRef.current);
      keyboardLongPressDelayRef.current = null;
    }
    if (keyboardLongPressActiveRef.current) {
      const player = videoRef.current;
      if (player) player.playbackRate = getRestoredPlaybackRate(keyboardPlaybackRateBeforeLongPressRef.current);
      keyboardLongPressActiveRef.current = false;
    }
    keyboardPlaybackRateBeforeLongPressRef.current = 1;
    keyboardPendingSeekSecondsRef.current = 0;
    keyboardPendingSeekKeyRef.current = null;
    setKeyboardLongPressActive(false);
    if (seekOnRelease && !wasLongPress && pendingSeekSeconds !== 0) seekVideo(pendingSeekSeconds);
  }, [seekVideo]);

  const updateFullscreenState = React.useCallback(() => {
    const doc = document as WebkitFullscreenDocument;
    const shell = playerShellRef.current;
    const fullscreenElement = document.fullscreenElement || doc.webkitFullscreenElement || null;
    const videoElement = videoRef.current as WebkitFullscreenVideo | null;
    const active = !!(
      (shell && fullscreenElement && (fullscreenElement === shell || shell.contains(fullscreenElement)))
      || videoElement?.webkitDisplayingFullscreen
    );
    setSystemFullscreen(active);
    showControls();
  }, [showControls]);

  React.useEffect(() => {
    if (!readySrc) return;
    const videoElement = videoRef.current;
    document.addEventListener('fullscreenchange', updateFullscreenState);
    document.addEventListener('webkitfullscreenchange', updateFullscreenState);
    videoElement?.addEventListener('webkitbeginfullscreen', updateFullscreenState);
    videoElement?.addEventListener('webkitendfullscreen', updateFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', updateFullscreenState);
      document.removeEventListener('webkitfullscreenchange', updateFullscreenState);
      videoElement?.removeEventListener('webkitbeginfullscreen', updateFullscreenState);
      videoElement?.removeEventListener('webkitendfullscreen', updateFullscreenState);
    };
  }, [readySrc, updateFullscreenState]);

  const leaveFullscreen = React.useCallback(async () => {
    if (fallbackFullscreen) {
      setFallbackFullscreen(false);
      setSystemFullscreen(false);
      showControls();
      return;
    }

    const videoElement = videoRef.current as WebkitFullscreenVideo | null;
    if (videoElement?.webkitDisplayingFullscreen && videoElement.webkitExitFullscreen) {
      try {
        videoElement.webkitExitFullscreen();
        return;
      } catch {}
    }

    const doc = document as WebkitFullscreenDocument;
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
      else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
    } catch {
      setSystemFullscreen(false);
    }
  }, [fallbackFullscreen, showControls]);

  const enterFullscreen = React.useCallback(async () => {
    const shell = playerShellRef.current as WebkitFullscreenElement | null;
    const videoElement = videoRef.current as WebkitFullscreenVideo | null;
    if (!shell || !videoElement) return;

    showControls();
    if (shell.requestFullscreen) {
      try {
        await shell.requestFullscreen();
        setSystemFullscreen(true);
        return;
      } catch {}
    }
    if (shell.webkitRequestFullscreen) {
      try {
        await shell.webkitRequestFullscreen();
        setSystemFullscreen(true);
        return;
      } catch {}
    }
    if (videoElement.webkitEnterFullscreen) {
      try {
        videoElement.webkitEnterFullscreen();
        setSystemFullscreen(true);
        return;
      } catch {}
    }

    setFallbackFullscreen(true);
  }, [showControls]);

  const toggleFullscreen = React.useCallback(() => {
    if (fullscreenActive) void leaveFullscreen();
    else void enterFullscreen();
  }, [enterFullscreen, fullscreenActive, leaveFullscreen]);

  React.useEffect(() => {
    if (!readySrc) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof HTMLElement ? event.target : null;
      const action = getVideoKeyboardAction({
        key: event.key,
        targetTagName: target?.tagName,
        targetInputType: target instanceof HTMLInputElement ? target.type : '',
        isContentEditable: !!target?.isContentEditable,
        isPlayerControl: !!(target && controlsRef.current?.contains(target)),
        ctrlKey: event.ctrlKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
      if (!action) return;
      event.preventDefault();
      event.stopPropagation();
      if (action.type === 'toggle-play') {
        if (!event.repeat) togglePlayback();
        return;
      }
      if (action.type === 'toggle-fullscreen') {
        if (!event.repeat) toggleFullscreen();
        return;
      }
      if (event.repeat) return;
      stopKeyboardLongPress();
      keyboardPendingSeekSecondsRef.current = action.seconds;
      keyboardPendingSeekKeyRef.current = event.key === 'ArrowLeft' ? 'ArrowLeft' : 'ArrowRight';
      if (action.seconds > 0) {
        keyboardLongPressDelayRef.current = window.setTimeout(() => {
          keyboardLongPressDelayRef.current = null;
          const player = videoRef.current;
          if (!player) {
            keyboardPendingSeekSecondsRef.current = 0;
            keyboardPendingSeekKeyRef.current = null;
            return;
          }
          keyboardPendingSeekSecondsRef.current = 0;
          keyboardPlaybackRateBeforeLongPressRef.current = getRestoredPlaybackRate(player.playbackRate);
          player.playbackRate = getLongPressPlaybackRate(true);
          keyboardLongPressActiveRef.current = true;
          setKeyboardLongPressActive(true);
        }, KEYBOARD_LONG_PRESS_DELAY_MS);
      }
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== keyboardPendingSeekKeyRef.current) return;
      if (
        keyboardLongPressDelayRef.current == null &&
        !keyboardLongPressActiveRef.current &&
        keyboardPendingSeekSecondsRef.current === 0
      ) return;
      event.preventDefault();
      event.stopPropagation();
      stopKeyboardLongPress(true);
    };
    const onWindowBlur = () => stopKeyboardLongPress();
    const onVisibilityChange = () => {
      if (document.visibilityState !== 'visible') stopKeyboardLongPress();
    };
    // Capture before native video controls so fullscreen media keys cannot seek or re-toggle playback.
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onWindowBlur);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onWindowBlur);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      stopKeyboardLongPress();
    };
  }, [readySrc, seekVideo, stopKeyboardLongPress, toggleFullscreen, togglePlayback]);

  React.useEffect(() => {
    if (!fallbackFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setFallbackFullscreen(false);
      showControls();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [fallbackFullscreen, showControls]);

  React.useEffect(() => () => {
    stopLongPress();
    stopKeyboardLongPress();
    clearControlsHideTimer();
  }, [clearControlsHideTimer, stopKeyboardLongPress, stopLongPress]);

  const fittedVideoSize = React.useMemo(() => {
    if (!videoSize) return null;
    const desktop = viewportSize.width >= 640;
    const shellPadding = desktop ? 32 : 16;
    const headerHeight = desktop ? 86 : 76;
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

  const handleDialogOpenChange = React.useCallback((open: boolean) => {
    if (!open && fullscreenActive) void leaveFullscreen();
    onOpenChange(open);
  }, [fullscreenActive, leaveFullscreen, onOpenChange]);

  const beginVideoSeek = React.useCallback(() => {
    const player = videoRef.current;
    if (!player || !Number.isFinite(player.duration)) return;
    const initialValue = Math.min(player.duration, Math.max(0, player.currentTime));
    seekingRef.current = true;
    seekPreviewTimeRef.current = initialValue;
    setSeekPreviewTime(initialValue);
    setIsSeeking(true);
  }, []);

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
  }, []);

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
  }, []);

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

  const setVideoVolume = React.useCallback((value: number) => {
    const player = videoRef.current;
    if (!player) return;
    const nextVolume = Math.min(1, Math.max(0, value));
    player.volume = nextVolume;
    if (nextVolume > 0) lastAudibleVolumeRef.current = nextVolume;
    if (player.volume > 0) player.muted = false;
  }, []);

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
  }, []);

  const setVideoPlaybackRate = React.useCallback((value: number) => {
    const rate = normalizeVideoPlaybackRate(value);
    setPlaybackRate(rate);
    if (longPressActiveRef.current) {
      playbackRateBeforeLongPressRef.current = rate;
      return;
    }
    if (keyboardLongPressActiveRef.current) {
      keyboardPlaybackRateBeforeLongPressRef.current = rate;
      return;
    }
    if (videoRef.current) videoRef.current.playbackRate = rate;
  }, []);

  const handlePlaybackRateMenuOpenChange = React.useCallback((open: boolean) => {
    if (playbackRateMenuOpenRef.current && !open) playbackRateMenuDismissedRef.current = true;
    playbackRateMenuOpenRef.current = open;
    setPlaybackRateMenuOpen(open);
  }, []);

  const desktopVideoInteraction = viewportSize.width >= 640 && !touchVideoInteraction;
  const displayedVideoTime = seekPreviewTime ?? currentTime;
  const videoShortcuts = [
    { id: 'play', keyLabel: 'Space', action: text.videoShortcutPlayPause },
    { id: 'back', keyLabel: '←', action: text.videoShortcutBack5 },
    { id: 'forward', keyLabel: '→', action: text.videoShortcutForward5 },
    { id: 'speed', keyLabel: '→', prefix: text.videoShortcutHold, action: text.videoShortcutSpeed },
    { id: 'fullscreen', keyLabel: 'F', action: text.videoShortcutFullscreen },
    { id: 'exit-fullscreen', keyLabel: 'Esc', action: text.videoShortcutExitFullscreen },
  ];
  const handleVideoClick = React.useCallback((event: React.MouseEvent<HTMLVideoElement>) => {
    if (suppressVideoClickRef.current) return;
    if (playbackRateMenuOpen || playbackRateMenuOpenRef.current || playbackRateMenuDismissedRef.current) {
      playbackRateMenuDismissedRef.current = false;
      showControls();
      return;
    }
    if (!compatibilityMode) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientY >= bounds.bottom - 56) return;
    }
    if (!desktopVideoInteraction) {
      event.preventDefault();
      showControls();
      return;
    }
    togglePlayback();
    showControls();
  }, [compatibilityMode, desktopVideoInteraction, playbackRateMenuOpen, showControls, togglePlayback]);

  const handleMobileVideoDoubleClick = React.useCallback((event: React.MouseEvent<HTMLVideoElement>) => {
    if (desktopVideoInteraction || suppressVideoClickRef.current) return;
    event.preventDefault();
    if (playbackRateMenuOpen || playbackRateMenuOpenRef.current || playbackRateMenuDismissedRef.current) {
      playbackRateMenuDismissedRef.current = false;
      showControls();
      return;
    }
    if (!compatibilityMode) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientY >= bounds.bottom - 56) return;
    }
    togglePlayback();
    showControls();
  }, [compatibilityMode, desktopVideoInteraction, playbackRateMenuOpen, showControls, togglePlayback]);

  return (
    <Dialog
      open={!!video}
      onOpenChange={handleDialogOpenChange}
      fixedHeight={false}
      bare
      lightweight={compatibilityMode}
      title={video?.title || text.videoPlayer}
      fitContent={!!readySrc}
      className={cn(
        'max-h-[calc(100dvh-1rem)] border border-border bg-popover/95 text-popover-foreground shadow-panel backdrop-blur sm:max-h-[calc(100dvh-2rem)]',
        readySrc ? 'max-w-[calc(100vw-1rem)] sm:max-w-[calc(100vw-2rem)]' : 'w-full max-w-2xl',
        fallbackFullscreen && 'wallhub-video-fullscreen-height !fixed !inset-0 !max-h-none !w-screen !max-w-none !rounded-none !border-0 !bg-black',
      )}
    >
      {video ? (
        <div
          className={cn('overflow-hidden rounded-2xl', fallbackFullscreen && 'wallhub-video-fullscreen-height flex w-screen flex-col rounded-none')}
          style={
            readySrc && fittedVideoSize && !fullscreenActive
              ? {
                  width: `${fittedVideoSize.width}px`,
                }
              : undefined
          }
        >
          <div className={cn('flex min-h-14 items-start justify-between gap-4 border-b border-border/50 px-4 py-3 sm:px-5 sm:py-4', fallbackFullscreen && 'hidden')}>
            <div className="min-w-0 flex-1">
              <div className="truncate text-base font-semibold tracking-tight">{video.title || text.videoPlayer}</div>
              {playbackStarted ? (
                <motion.div
                  className="hide-scrollbar mt-2 flex max-w-full items-center gap-2 overflow-x-auto pb-0.5 text-[10px] leading-none sm:gap-2.5 sm:text-[11px]"
                  role="list"
                  aria-label={text.videoShortcutsLabel}
                  initial={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: reduceMotion ? 0.12 : 0.2, ease: [0.23, 1, 0.32, 1] }}
                >
                  {videoShortcuts.map((shortcut, index) => (
                    <React.Fragment key={shortcut.id}>
                      {index > 0 ? <span className="h-3 w-px shrink-0 bg-border/60" aria-hidden="true" /> : null}
                      <span className="flex shrink-0 items-center gap-1.5 whitespace-nowrap" role="listitem">
                        {shortcut.prefix ? <span className="text-muted-foreground">{shortcut.prefix}</span> : null}
                        <kbd className="inline-flex h-5 min-w-5 items-center justify-center rounded-[4px] border border-border/70 bg-muted/80 px-1.5 font-mono text-[10px] font-semibold leading-none text-foreground shadow-[inset_0_-1px_0_hsl(var(--border)/0.5)]">
                          {shortcut.keyLabel}
                        </kbd>
                        <span className="font-medium text-muted-foreground">{shortcut.action}</span>
                      </span>
                    </React.Fragment>
                  ))}
                </motion.div>
              ) : null}
            </div>
            <Button variant="ghost" size="icon-sm" onClick={() => handleDialogOpenChange(false)} aria-label={text.close}>
              <X className="h-4 w-4" />
            </Button>
          </div>
          {readySrc ? (
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
                className={cn(
                  'block shrink-0 touch-manipulation bg-black',
                  fullscreenActive ? 'h-full w-full object-contain' : 'w-full',
                )}
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
                onLoadedMetadata={(event) => {
                  const el = event.currentTarget;
                  if (el.videoWidth && el.videoHeight) setVideoSize({ width: el.videoWidth, height: el.videoHeight });
                  if (compatibilityMode) {
                    setDuration(Number.isFinite(el.duration) ? el.duration : 0);
                    setCurrentTime(el.currentTime || 0);
                    setVolume(el.volume);
                    setMuted(el.muted);
                    if (el.volume > 0) lastAudibleVolumeRef.current = el.volume;
                  }
                }}
                onDurationChange={compatibilityMode ? (event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0) : undefined}
                onTimeUpdate={compatibilityMode ? (event) => setCurrentTime(event.currentTarget.currentTime || 0) : undefined}
                onPlay={compatibilityMode ? () => setIsPlaying(true) : undefined}
                onPlaying={() => setPlaybackStarted(true)}
                onPause={compatibilityMode ? () => setIsPlaying(false) : undefined}
                onEnded={compatibilityMode ? () => setIsPlaying(false) : undefined}
                onVolumeChange={compatibilityMode ? (event) => {
                  setVolume(event.currentTarget.volume);
                  setMuted(event.currentTarget.muted);
                  if (event.currentTarget.volume > 0) lastAudibleVolumeRef.current = event.currentTarget.volume;
                } : undefined}
              />

              {compatibilityMode ? (
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
                    setControlsVisible(true);
                  }}
                  onPointerLeave={(event) => {
                    if (event.pointerType === 'mouse') controlsHoverRef.current = false;
                    scheduleControlsHide();
                  }}
                  onFocusCapture={() => {
                    controlsFocusRef.current = true;
                    clearControlsHideTimer();
                    setControlsVisible(true);
                  }}
                  onBlurCapture={() => {
                    window.requestAnimationFrame(() => {
                      controlsFocusRef.current = !!controlsRef.current?.contains(document.activeElement);
                      scheduleControlsHide();
                    });
                  }}
                >
                  <input
                    className="block h-5 w-full cursor-pointer touch-none accent-white"
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
              ) : null}

              {longPressActive || keyboardLongPressActive ? (
                <div className="pointer-events-none absolute left-1/2 top-[max(1rem,6%)] z-30 -translate-x-1/2 whitespace-nowrap rounded-full border border-white/15 bg-black/45 px-5 py-3 text-sm font-semibold text-white/90 shadow-lg backdrop-blur-sm sm:px-6 sm:py-3.5 sm:text-base">
                  {text.videoSpeedPlaying}
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
