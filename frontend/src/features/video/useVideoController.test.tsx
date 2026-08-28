import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { playVideo, releaseDepotVideoStream } from '@/lib/api';
import { TEXT } from '@/lib/text';
import { useVideoController } from './useVideoController';

vi.mock('@/lib/api', () => ({
  playVideo: vi.fn(),
  releaseDepotVideoStream: vi.fn(),
}));

describe('useVideoController CDN toast', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-09T12:00:00Z'));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  function renderController(fetchRuntime = vi.fn().mockResolvedValue({
    platform: 'win32', arch: 'x64', termux: false, downloaderMode: 'steamkit', effectiveDownloader: 'steamkit',
    nsfwEnabled: false, runnerDir: '', downloadsDir: '', steamCdn: {},
  })) {
    const toast = vi.fn(() => 1);
    const result = renderHook(() => useVideoController({
      pageVisible: true,
      text: TEXT.en,
      toast,
      fetchRuntime,
      setRuntime: vi.fn(),
      requestLogin: vi.fn(() => false),
      reportDownloadClick: vi.fn(),
      refreshQueue: vi.fn(),
    }));
    return { ...result, toast, fetchRuntime };
  }

  test('briefly shows the CDN returned while video playback is being prepared', async () => {
    vi.mocked(playVideo).mockResolvedValue({
      success: true, status: 'ready', streamUrl: '/video', cdnHost: 'cdn.example.com',
    });
    const { result, toast } = renderController();

    await act(async () => {
      await result.current.doPlayVideo({ publishedfileid: '1', title: 'Video' });
    });

    expect(toast).toHaveBeenCalledWith('Current CDN node: cdn.example.com', 'info', 2400);
  });

  test('shows a delayed runtime CDN only once for the same playback session', async () => {
    const startedAt = Date.now();
    const fetchRuntime = vi.fn().mockResolvedValue({
      platform: 'win32', arch: 'x64', termux: false, downloaderMode: 'steamkit', effectiveDownloader: 'steamkit',
      nsfwEnabled: false, runnerDir: '', downloadsDir: '',
      steamCdn: { currentHost: 'late.cdn.example', updatedAt: startedAt },
    });
    const { result, toast } = renderController(fetchRuntime);

    act(() => result.current.playQueueTask({ id: '2', title: 'Queued video', source: 'download' } as never));
    await act(async () => { await vi.advanceTimersByTimeAsync(2100); });

    expect(toast).toHaveBeenCalledTimes(1);
    expect(toast).toHaveBeenCalledWith('Current CDN node: late.cdn.example', 'info', 2400);
  });

});
