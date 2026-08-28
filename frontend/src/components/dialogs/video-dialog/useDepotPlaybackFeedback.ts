import * as React from 'react';

import {
  cancelDepotFullCache,
  getDepotFullCacheStatus,
  reportDepotPlaybackFeedback,
  startDepotFullCache,
  type DepotFullCacheStatus,
  type DepotPlaybackFeedback,
} from '@/lib/api';

const FEEDBACK_INTERVAL_MS = 1000;
const PLAYBACK_PROGRESS_EPSILON = 0.05;
export const BANDWIDTH_WARNING_DURATION_MS = 3000;

function bufferedEndAtCurrentTime(video: HTMLVideoElement) {
  const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
  for (let index = 0; index < video.buffered.length; index++) {
    if (video.buffered.start(index) <= currentTime && video.buffered.end(index) >= currentTime) {
      return video.buffered.end(index);
    }
  }
  return currentTime;
}

function bufferedRanges(video: HTMLVideoElement) {
  const ranges = [];
  for (let index = 0; index < Math.min(8, video.buffered.length); index++) {
    ranges.push({ start: video.buffered.start(index), end: video.buffered.end(index) });
  }
  return ranges;
}

export function useDepotPlaybackFeedback(readySrc: string) {
  const sequenceRef = React.useRef(0);
  const lastSentAtRef = React.useRef(0);
  const lastReportedPositionRef = React.useRef(0);
  const lastAppliedResponseSequenceRef = React.useRef(0);
  const userPausedRef = React.useRef(false);
  const controllerPausedRef = React.useRef(false);
  const feedbackGenerationRef = React.useRef(0);
  const fullCacheTimerRef = React.useRef<number | null>(null);
  const bandwidthWarningTimerRef = React.useRef<number | null>(null);
  const bufferingPollTimerRef = React.useRef<number | null>(null);
  const bandwidthPressureActiveRef = React.useRef(false);
  const [bandwidthLimited, setBandwidthLimited] = React.useState(false);
  const [decodeError, setDecodeError] = React.useState(false);
  const [fullCache, setFullCache] = React.useState<DepotFullCacheStatus | null>(null);
  const [buffering, setBuffering] = React.useState<{
    phase: 'calibrating' | 'startup' | 'recovering';
    progress: number;
  } | null>(null);
  const isDepot = readySrc.includes('/api/video/depot');

  const clearFullCacheTimer = React.useCallback(() => {
    if (fullCacheTimerRef.current !== null) window.clearTimeout(fullCacheTimerRef.current);
    fullCacheTimerRef.current = null;
  }, []);

  const clearBandwidthWarningTimer = React.useCallback(() => {
    if (bandwidthWarningTimerRef.current !== null) window.clearTimeout(bandwidthWarningTimerRef.current);
    bandwidthWarningTimerRef.current = null;
  }, []);

  const clearBufferingPollTimer = React.useCallback(() => {
    if (bufferingPollTimerRef.current !== null) window.clearTimeout(bufferingPollTimerRef.current);
    bufferingPollTimerRef.current = null;
  }, []);

  React.useEffect(() => {
    sequenceRef.current = 0;
    lastSentAtRef.current = 0;
    lastReportedPositionRef.current = 0;
    lastAppliedResponseSequenceRef.current = 0;
    userPausedRef.current = false;
    controllerPausedRef.current = false;
    feedbackGenerationRef.current += 1;
    clearFullCacheTimer();
    clearBandwidthWarningTimer();
    clearBufferingPollTimer();
    bandwidthPressureActiveRef.current = false;
    setBandwidthLimited(false);
    setDecodeError(false);
    setFullCache(null);
    setBuffering(null);
  }, [clearBandwidthWarningTimer, clearBufferingPollTimer, clearFullCacheTimer, isDepot, readySrc]);

  React.useEffect(() => () => {
    clearFullCacheTimer();
    clearBandwidthWarningTimer();
    clearBufferingPollTimer();
  }, [clearBandwidthWarningTimer, clearBufferingPollTimer, clearFullCacheTimer]);

  const scheduleBufferingPollRef = React.useRef<(video: HTMLVideoElement) => void>(() => {});

  const report = React.useCallback((video: HTMLVideoElement, state: DepotPlaybackFeedback['state'], immediate = false) => {
    if (!isDepot) return;
    const now = Date.now();
    if (!immediate && now - lastSentAtRef.current < FEEDBACK_INTERVAL_MS) return;
    lastSentAtRef.current = now;
    const currentTime = Number.isFinite(video.currentTime) ? video.currentTime : 0;
    const generation = feedbackGenerationRef.current;
    const sequence = ++sequenceRef.current;
    const request = reportDepotPlaybackFeedback(readySrc, {
      sequence,
      state,
      currentTime,
      duration: Number.isFinite(video.duration) ? video.duration : 0,
      bufferedEnd: bufferedEndAtCurrentTime(video),
      bufferedRanges: bufferedRanges(video),
      controllerPaused: controllerPausedRef.current,
      playbackRate: Number.isFinite(video.playbackRate) ? video.playbackRate : 1,
      sentAt: now,
      paused: video.paused,
      readyState: video.readyState,
      networkState: video.networkState,
      mediaTimeAdvanced: currentTime > lastReportedPositionRef.current + PLAYBACK_PROGRESS_EPSILON,
      errorCode: video.error?.code || 0,
    });
    request.then(result => {
      if (!result || generation !== feedbackGenerationRef.current ||
          sequence <= lastAppliedResponseSequenceRef.current || result.success === false) return;
      lastAppliedResponseSequenceRef.current = sequence;
      const pressureActive = !!result.bandwidthLimited;
      if (pressureActive && !bandwidthPressureActiveRef.current) {
        clearBandwidthWarningTimer();
        setBandwidthLimited(true);
        bandwidthWarningTimerRef.current = window.setTimeout(() => {
          bandwidthWarningTimerRef.current = null;
          setBandwidthLimited(false);
        }, BANDWIDTH_WARNING_DURATION_MS);
      } else if (!pressureActive) {
        clearBandwidthWarningTimer();
        setBandwidthLimited(false);
      }
      bandwidthPressureActiveRef.current = pressureActive;
      setDecodeError(!!result.decodeError);
      // Browser-native playback owns waiting and recovery. Feedback controls
      // prefetch diagnostics only and must never pause or restart the element.
      controllerPausedRef.current = false;
      setBuffering(null);
    });
    lastReportedPositionRef.current = currentTime;
    return request;
  }, [clearBandwidthWarningTimer, clearBufferingPollTimer, isDepot, readySrc]);

  scheduleBufferingPollRef.current = (video: HTMLVideoElement) => {
    if (bufferingPollTimerRef.current !== null || userPausedRef.current || !controllerPausedRef.current) return;
    bufferingPollTimerRef.current = window.setTimeout(() => {
      bufferingPollTimerRef.current = null;
      if (!userPausedRef.current && controllerPausedRef.current) report(video, 'buffering', true);
    }, FEEDBACK_INTERVAL_MS);
  };

  const pollFullCache = React.useCallback((video: HTMLVideoElement, generation: number) => {
    clearFullCacheTimer();
    fullCacheTimerRef.current = window.setTimeout(async () => {
      try {
        const status = await getDepotFullCacheStatus(readySrc);
        if (!status || generation !== feedbackGenerationRef.current) return;
        setFullCache(status);
        if (status.status === 'caching') pollFullCache(video, generation);
        else if (status.status === 'complete') void video.play().catch(() => {});
      } catch {
        if (generation === feedbackGenerationRef.current) {
          setFullCache(current => current ? { ...current, status: 'error' } : current);
        }
      }
    }, 1000);
  }, [clearFullCacheTimer, readySrc]);

  const cacheCompleteFile = React.useCallback(async (video: HTMLVideoElement) => {
    if (!readySrc.includes('/api/video/depot')) return;
    video.pause();
    userPausedRef.current = false;
    const generation = feedbackGenerationRef.current;
    try {
      const status = await startDepotFullCache(readySrc);
      if (!status || generation !== feedbackGenerationRef.current) return;
      setFullCache(status);
      if (status.status === 'caching') pollFullCache(video, generation);
      else if (status.status === 'complete') void video.play().catch(() => {});
    } catch (error) {
      if (generation === feedbackGenerationRef.current) setFullCache({
        success: false,
        status: 'error',
        cachedBytes: 0,
        totalBytes: 0,
        progress: 0,
        code: String((error as Error & { code?: string }).code || ''),
      });
    }
  }, [pollFullCache, readySrc]);

  const cancelCompleteFileCache = React.useCallback(async () => {
    clearFullCacheTimer();
    try {
      const status = await cancelDepotFullCache(readySrc);
      if (status) setFullCache(null);
    } catch {
      setFullCache(current => current ? { ...current, status: 'error' } : current);
    }
  }, [clearFullCacheTimer, readySrc]);

  return {
    bandwidthLimited,
    buffering,
    cacheCompleteFile,
    cancelCompleteFileCache,
    decodeError,
    fullCache,
    reportUserPlaybackIntent: React.useCallback((video: HTMLVideoElement, willPause: boolean) => {
      userPausedRef.current = willPause;
      if (willPause) {
        clearBufferingPollTimer();
        controllerPausedRef.current = false;
        setBuffering(null);
        report(video, 'paused', true);
      }
    }, [clearBufferingPollTimer, report]),
    reportPlayIntent: React.useCallback((video: HTMLVideoElement) => {
      userPausedRef.current = false;
      report(video, controllerPausedRef.current ? 'buffering' : 'playing', true);
    }, [report]),
    reportPlaying: React.useCallback((video: HTMLVideoElement) => {
      userPausedRef.current = false;
      controllerPausedRef.current = false;
      report(video, 'playing', true);
    }, [report]),
    reportProgress: React.useCallback((video: HTMLVideoElement) => {
      const state = video.paused
        ? userPausedRef.current ? 'paused' : controllerPausedRef.current ? 'buffering' : 'waiting'
        : 'playing';
      report(video, state);
    }, [report]),
    reportPaused: React.useCallback((video: HTMLVideoElement) => {
      if (controllerPausedRef.current) report(video, 'buffering', true);
      else {
        userPausedRef.current = true;
        report(video, 'paused', true);
      }
    }, [report]),
    reportSeeking: React.useCallback((video: HTMLVideoElement) => {
      controllerPausedRef.current = false;
      report(video, 'seeking', true);
    }, [report]),
    reportSeeked: React.useCallback((video: HTMLVideoElement) => {
      report(video, userPausedRef.current ? 'paused' : controllerPausedRef.current ? 'buffering' : 'playing', true);
    }, [report]),
    reportWaiting: React.useCallback((video: HTMLVideoElement) => {
      report(video, userPausedRef.current ? 'paused' : controllerPausedRef.current ? 'buffering' : 'waiting', true);
    }, [report]),
    reportStalled: React.useCallback((video: HTMLVideoElement) => {
      report(video, userPausedRef.current ? 'paused' : controllerPausedRef.current ? 'buffering' : 'stalled', true);
    }, [report]),
    reportEnded: React.useCallback((video: HTMLVideoElement) => {
      report(video, 'ended', true);
    }, [report]),
    reportError: React.useCallback((video: HTMLVideoElement) => {
      report(video, 'stalled', true);
    }, [report]),
    reportLoadedMetadata: React.useCallback((video: HTMLVideoElement) => {
      if (isDepot) {
        controllerPausedRef.current = false;
        report(video, video.paused ? 'waiting' : 'playing', true);
      }
    }, [isDepot, report]),
    isDepot,
  };
}
