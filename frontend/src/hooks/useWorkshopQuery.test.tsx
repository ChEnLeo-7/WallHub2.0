import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getDetailsBatch, queryWorkshop, waitSteamAccessReady, type WorkshopItem } from '@/lib/api';
import { createApiError } from '@/lib/api/errors';
import type { Filters } from '@/lib/normalizers';
import { useWorkshopQuery } from './useWorkshopQuery';

vi.mock('@/lib/api', () => ({
  getDetailsBatch: vi.fn(),
  queryWorkshop: vi.fn(),
  waitSteamAccessReady: vi.fn(),
}));

const filters = {
  search: '',
  sort: 'trend',
  personalFilter: '',
  personalSort: 'lastupdated',
  days: '30',
  types: [],
  rating: 'Everyone',
  ratings: ['Everyone'],
  genres: [],
  officialTags: [],
  excludedOfficialTags: [],
  categories: ['Wallpaper'],
  resolutions: [],
  mobileCompatibleOnly: false,
} as Filters;

describe('useWorkshopQuery Community HTML details', () => {
  beforeEach(() => {
    vi.mocked(queryWorkshop).mockResolvedValue({
      items: [
        { publishedfileid: '303', title: 'HTML first', preview_url: '', tags: [], detailsPending: true },
        { publishedfileid: '101', title: 'HTML second', preview_url: '', tags: [], detailsPending: true },
      ],
      total: 2,
      totalPages: 1,
      source: 'community-html',
      fallbackUsed: false,
      warningCode: '',
    });
    vi.mocked(getDetailsBatch).mockResolvedValue([
      { publishedfileid: '101', title: 'Detail second', preview_url: 'https://full/101.jpg', tags: [{ tag: 'Video' }], file_size: 101 },
      { publishedfileid: '303', title: 'Detail first', preview_url: 'https://full/303.jpg', tags: [{ tag: 'Scene' }], file_size: 303 },
    ]);
  });

  test('renders HTML order first and enriches by ID without SteamAccess blocking', async () => {
    const setPage = vi.fn();
    const onWarning = vi.fn();
    let resolveDetails: ((items: WorkshopItem[]) => void) | undefined;
    vi.mocked(getDetailsBatch).mockImplementation(() => new Promise<WorkshopItem[]>((resolve) => {
      resolveDetails = resolve;
    }));
    const { result } = renderHook(() => useWorkshopQuery({
      enabled: true,
      filters,
      page: 1,
      pageSize: 30,
      exactPhrase: false,
      nsfw: true,
      prefetchNextPage: false,
      steamAccessEnhance: true,
      steamDataSource: 'community',
      language: 'zh',
      refreshToken: 0,
      setPage,
      onWarning,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.items.map(item => item.publishedfileid)).toEqual(['303', '101']);
    expect(result.current.items.map(item => item.title)).toEqual(['HTML first', 'HTML second']);
    expect(result.current.items.map(item => item.preview_url)).toEqual(['', '']);
    expect(waitSteamAccessReady).not.toHaveBeenCalled();

    await waitFor(() => expect(getDetailsBatch).toHaveBeenCalledWith(['303', '101']));
    await act(async () => {
      resolveDetails?.([
        { publishedfileid: '101', title: 'Detail second', preview_url: 'https://full/101.jpg', tags: [{ tag: 'Video' }], file_size: 101 },
        { publishedfileid: '303', title: 'Detail first', preview_url: 'https://full/303.jpg', tags: [{ tag: 'Scene' }], file_size: 303 },
      ]);
    });

    expect(result.current.items.map(item => item.publishedfileid)).toEqual(['303', '101']);
    expect(result.current.items.map(item => item.title)).toEqual(['Detail first', 'Detail second']);
    expect(result.current.items.map(item => item.preview_url)).toEqual(['https://full/303.jpg', 'https://full/101.jpg']);
    expect(result.current.items.every(item => item.detailsPending === false)).toBe(true);
  });

  test('removes Asset, unknown, and wrong-type Community entries after detail enrichment', async () => {
    vi.mocked(queryWorkshop).mockResolvedValue({
      items: [
        { publishedfileid: '101', title: 'Video', preview_url: '', tags: [], detailsPending: true },
        { publishedfileid: '202', title: 'Scene', preview_url: '', tags: [], detailsPending: true },
        { publishedfileid: '303', title: 'Asset', preview_url: '', tags: [], detailsPending: true },
        { publishedfileid: '404', title: 'Unknown', preview_url: '', tags: [], detailsPending: true },
      ],
      total: 4,
      totalPages: 1,
      source: 'community-html',
      fallbackUsed: false,
      warningCode: '',
    });
    vi.mocked(getDetailsBatch).mockResolvedValue([
      { publishedfileid: '101', title: 'Video', preview_url: 'https://full/101.jpg', tags: [{ tag: 'Wallpaper' }, { tag: 'Video' }], file_size: 101 },
      { publishedfileid: '202', title: 'Scene', preview_url: 'https://full/202.jpg', tags: [{ tag: 'Wallpaper' }, { tag: 'Scene' }], file_size: 202 },
      { publishedfileid: '303', title: 'Asset', preview_url: 'https://full/303.jpg', tags: [{ tag: 'Asset' }, { tag: 'Particle' }], file_size: 303 },
      { publishedfileid: '404', title: 'Unknown', preview_url: 'https://full/404.jpg', tags: [{ tag: 'Wallpaper' }], file_size: 404 },
    ]);
    const setPage = vi.fn();
    const onWarning = vi.fn();
    const videoFilters = { ...filters, types: ['Video'] };
    const { result } = renderHook(() => useWorkshopQuery({
      enabled: true,
      filters: videoFilters,
      page: 1,
      pageSize: 30,
      exactPhrase: false,
      nsfw: true,
      prefetchNextPage: false,
      steamAccessEnhance: false,
      steamDataSource: 'community',
      language: 'zh',
      refreshToken: 0,
      setPage,
      onWarning,
    }));

    await waitFor(() => expect(getDetailsBatch).toHaveBeenCalled());
    await waitFor(() => expect(result.current.items.map(item => item.publishedfileid)).toEqual(['101']));
  });

  test('exposes a structured re-login state for an expired Steam session', async () => {
    const setPage = vi.fn();
    const onWarning = vi.fn();
    vi.mocked(queryWorkshop).mockRejectedValue(createApiError({
      error: 'Steam 登录已失效，请重新登录后再使用 Steam CM WebSocket。',
      code: 'STEAM_CM_LOGIN_REQUIRED',
      requiresSteamLogin: true,
    }, 401));
    const { result } = renderHook(() => useWorkshopQuery({
      enabled: true,
      filters,
      page: 1,
      pageSize: 30,
      exactPhrase: false,
      nsfw: true,
      prefetchNextPage: false,
      steamAccessEnhance: false,
      steamDataSource: 'cm',
      language: 'zh',
      refreshToken: 0,
      setPage,
      onWarning,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.requiresSteamLogin).toBe(true);
    expect(result.current.error).toContain('重新登录');
  });

  test('keeps a Steam CM query timeout retryable without requesting login', async () => {
    const setPage = vi.fn();
    const onWarning = vi.fn();
    vi.mocked(queryWorkshop).mockRejectedValue(createApiError({
      error: 'Steam CM Workshop query timed out',
      code: 'STEAM_CM_QUERY_TIMEOUT',
      requiresSteamLogin: false,
    }, 504));
    const { result } = renderHook(() => useWorkshopQuery({
      enabled: true,
      filters,
      page: 1,
      pageSize: 30,
      exactPhrase: false,
      nsfw: true,
      prefetchNextPage: false,
      steamAccessEnhance: false,
      steamDataSource: 'cm',
      language: 'zh',
      refreshToken: 0,
      setPage,
      onWarning,
    }));

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toContain('timed out');
    expect(result.current.requiresSteamLogin).toBe(false);
  });

  test('retries automatically when login success advances the refresh token', async () => {
    const setPage = vi.fn();
    const onWarning = vi.fn();
    vi.mocked(queryWorkshop)
      .mockRejectedValueOnce(createApiError({
        error: 'Steam 登录已失效，请重新登录',
        code: 'STEAM_CM_LOGIN_REQUIRED',
        requiresSteamLogin: true,
      }, 401))
      .mockResolvedValueOnce({
        items: [{ publishedfileid: '404', title: 'Recovered', preview_url: '', tags: [] }],
        total: 1,
        totalPages: 1,
        source: 'steam-cm',
        fallbackUsed: false,
        warningCode: '',
      });
    const { result, rerender } = renderHook(({ refreshToken }) => useWorkshopQuery({
      enabled: true,
      filters,
      page: 1,
      pageSize: 30,
      exactPhrase: false,
      nsfw: true,
      prefetchNextPage: false,
      steamAccessEnhance: false,
      steamDataSource: 'cm',
      language: 'zh',
      refreshToken,
      setPage,
      onWarning,
    }), { initialProps: { refreshToken: 0 } });

    await waitFor(() => expect(result.current.requiresSteamLogin).toBe(true));
    rerender({ refreshToken: 1 });

    await waitFor(() => expect(result.current.items[0]?.title).toBe('Recovered'));
    expect(result.current.error).toBe('');
    expect(result.current.requiresSteamLogin).toBe(false);
    expect(queryWorkshop).toHaveBeenCalledTimes(2);
  });
});
