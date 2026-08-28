import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

import {
  cancelDepotFullCache,
  getDepotFullCacheStatus,
  reportDepotPlaybackFeedback,
  startDepotFullCache,
} from '@/lib/api';
import { BANDWIDTH_WARNING_DURATION_MS, useDepotPlaybackFeedback } from './useDepotPlaybackFeedback';

vi.mock('@/lib/api', () => ({
  cancelDepotFullCache: vi.fn(),
  getDepotFullCacheStatus: vi.fn(),
  reportDepotPlaybackFeedback: vi.fn(),
  startDepotFullCache: vi.fn(),
}));

function video() {
  return {
    currentTime: 10,
    duration: 100,
    playbackRate: 1.5,
    paused: false,
    readyState: 4,
    networkState: 1,
    pause: vi.fn(),
    play: vi.fn().mockResolvedValue(undefined),
    buffered: {
      length: 1,
      start: () => 8,
      end: () => 44,
    },
  } as unknown as HTMLVideoElement;
}

describe('useDepotPlaybackFeedback', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(reportDepotPlaybackFeedback).mockResolvedValue(undefined);
    vi.mocked(startDepotFullCache).mockResolvedValue(undefined);
    vi.mocked(getDepotFullCacheStatus).mockResolvedValue(undefined);
    vi.mocked(cancelDepotFullCache).mockResolvedValue(undefined);
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-11T00:00:00Z'));
  });

  test('reports real buffered playback time and throttles progress events', () => {
    const { result } = renderHook(() => useDepotPlaybackFeedback('/api/video/depot?token=test'));
    const element = video();

    act(() => {
      result.current.reportPlaying(element);
      result.current.reportProgress(element);
    });
    expect(reportDepotPlaybackFeedback).toHaveBeenCalledTimes(1);
    expect(reportDepotPlaybackFeedback).toHaveBeenLastCalledWith('/api/video/depot?token=test', expect.objectContaining({
      sequence: 1,
      state: 'playing',
      currentTime: 10,
      duration: 100,
      bufferedEnd: 44,
      bufferedRanges: [{ start: 8, end: 44 }],
      controllerPaused: false,
      playbackRate: 1.5,
      paused: false,
      readyState: 4,
      networkState: 1,
      mediaTimeAdvanced: true,
      errorCode: 0,
    }));

    act(() => vi.advanceTimersByTime(1000));
    act(() => result.current.reportProgress(element));
    expect(reportDepotPlaybackFeedback).toHaveBeenCalledTimes(2);
  });

  test('reports seek immediately and ignores non-depot sources', () => {
    const depot = renderHook(() => useDepotPlaybackFeedback('/api/video/depot?token=test'));
    const local = renderHook(() => useDepotPlaybackFeedback('/api/video/stream?id=1'));
    const element = video();

    act(() => {
      depot.result.current.reportSeeking(element);
      depot.result.current.reportSeeked(element);
      local.result.current.reportPlaying(element);
    });

    expect(reportDepotPlaybackFeedback).toHaveBeenCalledTimes(2);
    expect(reportDepotPlaybackFeedback).toHaveBeenNthCalledWith(1, expect.any(String), expect.objectContaining({ state: 'seeking' }));
    expect(reportDepotPlaybackFeedback).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({
      state: 'playing', controllerPaused: false,
    }));
  });

  test('never pauses or restarts native playback while startup data is still buffering', () => {
    const element = video();
    Object.defineProperty(element, 'currentTime', { value: 0, writable: true });
    Object.defineProperty(element, 'buffered', {
      value: { length: 1, start: () => 0, end: () => 2.3 },
    });
    const { result } = renderHook(() => useDepotPlaybackFeedback('/api/video/depot?token=test'));

    act(() => {
      result.current.reportPlaying(element);
      result.current.reportWaiting(element);
      result.current.reportStalled(element);
      result.current.reportProgress(element);
    });

    expect(element.pause).not.toHaveBeenCalled();
    expect(element.play).not.toHaveBeenCalled();
    expect(reportDepotPlaybackFeedback).toHaveBeenLastCalledWith(
      expect.any(String), expect.objectContaining({ state: 'stalled', bufferedEnd: 2.3 }),
    );
  });

  test('lets native startup waiting continue without preemptive controller pause', () => {
    const element = video();
    const { result } = renderHook(() => useDepotPlaybackFeedback('/api/video/depot?token=test'));

    act(() => result.current.reportWaiting(element));

    expect(element.pause).not.toHaveBeenCalled();
    expect(element.play).not.toHaveBeenCalled();
    expect(reportDepotPlaybackFeedback).toHaveBeenLastCalledWith(
      expect.any(String), expect.objectContaining({ state: 'waiting', paused: false, controllerPaused: false }),
    );
  });

  test('diagnostic directives never pause or restart native playback', async () => {
    const element = video();
    vi.mocked(reportDepotPlaybackFeedback)
      .mockResolvedValueOnce({
        success: true, playbackDirective: 'pause', bufferPhase: 'recovering', bufferProgress: 0.25,
      })
      .mockResolvedValueOnce({
        success: true, playbackDirective: 'play', bufferPhase: 'steady', bufferProgress: 1,
      });
    const { result } = renderHook(() => useDepotPlaybackFeedback('/api/video/depot?token=test'));

    await act(async () => { await result.current.reportPlaying(element); });
    expect(element.pause).not.toHaveBeenCalled();
    expect(result.current.buffering).toBeNull();
    Object.defineProperty(element, 'paused', { value: true, configurable: true });
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await result.current.reportProgress(element);
    });
    expect(element.play).not.toHaveBeenCalled();
    expect(result.current.buffering).toBeNull();
  });

  test('metadata loading reports native startup without scheduling a controller poll', async () => {
    const element = video();
    Object.defineProperty(element, 'paused', { value: true, configurable: true });
    vi.mocked(reportDepotPlaybackFeedback).mockResolvedValue({
      success: true, playbackDirective: 'none', bufferPhase: 'startup', bufferProgress: 0.1,
    });
    const { result } = renderHook(() => useDepotPlaybackFeedback('/api/video/depot?token=test'));

    await act(async () => { await result.current.reportLoadedMetadata(element); });
    expect(reportDepotPlaybackFeedback).toHaveBeenLastCalledWith(
      expect.any(String), expect.objectContaining({ state: 'waiting', controllerPaused: false }),
    );
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    expect(reportDepotPlaybackFeedback).toHaveBeenCalledTimes(1);
    expect(element.play).not.toHaveBeenCalled();
    expect(result.current.buffering).toBeNull();
  });

  test('does not execute play directive after explicit user pause', async () => {
    const element = video();
    vi.mocked(reportDepotPlaybackFeedback).mockResolvedValue({
      success: true, playbackDirective: 'play', bufferPhase: 'steady', bufferProgress: 1,
    });
    const { result } = renderHook(() => useDepotPlaybackFeedback('/api/video/depot?token=test'));

    await act(async () => { await result.current.reportUserPlaybackIntent(element, true); });
    expect(element.play).not.toHaveBeenCalled();
  });

  test('ignores an older directive response that arrives after a newer one', async () => {
    const element = video();
    let resolveFirst: ((value: { success: boolean; playbackDirective: 'play'; bufferPhase: 'steady' }) => void) | undefined;
    vi.mocked(reportDepotPlaybackFeedback)
      .mockImplementationOnce(() => new Promise<{
        success: boolean;
        playbackDirective: 'play';
        bufferPhase: 'steady';
      }>(resolve => { resolveFirst = resolve; }))
      .mockResolvedValueOnce({
        success: true, playbackDirective: 'pause', bufferPhase: 'recovering', bufferProgress: 0.5,
      });
    const { result } = renderHook(() => useDepotPlaybackFeedback('/api/video/depot?token=test'));

    act(() => { void result.current.reportPlaying(element); });
    await act(async () => {
      vi.advanceTimersByTime(1000);
      await result.current.reportProgress(element);
    });
    expect(element.pause).not.toHaveBeenCalled();
    await act(async () => { resolveFirst?.({ success: true, playbackDirective: 'play', bufferPhase: 'steady' }); });
    expect(element.play).not.toHaveBeenCalled();
  });

  test('reports an explicit user pause without auto-resuming it', () => {
    const element = video();
    const { result } = renderHook(() => useDepotPlaybackFeedback('/api/video/depot?token=test'));

    act(() => result.current.reportUserPlaybackIntent(element, true));
    Object.defineProperty(element, 'paused', { value: true });
    act(() => {
      result.current.reportPaused(element);
      result.current.reportProgress(element);
    });

    expect(element.play).not.toHaveBeenCalled();
    expect(reportDepotPlaybackFeedback).toHaveBeenLastCalledWith(
      expect.any(String), expect.objectContaining({ state: 'paused' }),
    );
  });

  test('reports media decode errors separately from buffering feedback', () => {
    const element = video();
    Object.defineProperty(element, 'error', { value: { code: 3 } });
    const { result } = renderHook(() => useDepotPlaybackFeedback('/api/video/depot?token=test'));

    act(() => result.current.reportError(element));

    expect(reportDepotPlaybackFeedback).toHaveBeenLastCalledWith(
      expect.any(String), expect.objectContaining({ state: 'stalled', errorCode: 3 }),
    );
  });

  test('exposes sustained bandwidth pressure returned by the server', async () => {
    vi.mocked(reportDepotPlaybackFeedback).mockResolvedValue({
      success: true, bandwidthLimited: true, decodeError: false,
    });
    const { result } = renderHook(() => useDepotPlaybackFeedback('/api/video/depot?token=test'));

    await act(async () => { await result.current.reportWaiting(video()); });

    expect(result.current.bandwidthLimited).toBe(true);
    expect(result.current.decodeError).toBe(false);
  });

  test('shows one bandwidth warning for three seconds without extending it on repeated feedback', async () => {
    vi.mocked(reportDepotPlaybackFeedback).mockResolvedValue({
      success: true, bandwidthLimited: true, decodeError: false,
    });
    const { result } = renderHook(() => useDepotPlaybackFeedback('/api/video/depot?token=test'));

    await act(async () => { await result.current.reportWaiting(video()); });
    expect(result.current.bandwidthLimited).toBe(true);

    await act(async () => {
      vi.advanceTimersByTime(1000);
      await result.current.reportWaiting(video());
      vi.advanceTimersByTime(BANDWIDTH_WARNING_DURATION_MS - 1000);
    });
    expect(result.current.bandwidthLimited).toBe(false);

    await act(async () => { await result.current.reportWaiting(video()); });
    expect(result.current.bandwidthLimited).toBe(false);
  });

  test('pauses for complete-file caching and resumes after polling completion', async () => {
    const element = video();
    vi.mocked(startDepotFullCache).mockResolvedValue({
      success: true, status: 'caching', cachedBytes: 25, totalBytes: 100, progress: 0.25,
    });
    vi.mocked(getDepotFullCacheStatus).mockResolvedValue({
      success: true, status: 'complete', cachedBytes: 100, totalBytes: 100, progress: 1,
    });
    const { result } = renderHook(() => useDepotPlaybackFeedback('/api/video/depot?token=test'));

    await act(async () => { await result.current.cacheCompleteFile(element); });
    expect(element.pause).toHaveBeenCalledOnce();
    expect(result.current.fullCache?.status).toBe('caching');

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(getDepotFullCacheStatus).toHaveBeenCalledWith('/api/video/depot?token=test');
    expect(result.current.fullCache?.status).toBe('complete');
    expect(element.play).toHaveBeenCalledOnce();
  });
});
