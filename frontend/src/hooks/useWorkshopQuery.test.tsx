import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getDetailsBatch, queryWorkshop, waitSteamAccessReady, type WorkshopItem } from '@/lib/api';
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
  resolutions: [],
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
});
