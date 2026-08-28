import * as React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import type { Filters } from '@/lib/normalizers';
import { useHomeCoordinator } from './useHomeCoordinator';

const initialFilters: Filters = {
  search: '',
  sort: 'trend',
  personalFilter: '',
  personalSort: 'lastupdated',
  days: '30',
  types: ['Video'],
  rating: 'Everyone',
  ratings: ['Everyone'],
  genres: [],
  officialTags: [],
  excludedOfficialTags: [],
  categories: ['Wallpaper'],
  resolutions: ['3440 x 1440', '2560 x 1080'],
  mobileCompatibleOnly: false,
};

describe('useHomeCoordinator resolution state', () => {
  test('preserves persisted multi-resolution selections in Community mode', async () => {
    const cancelNextPagePrefetch = vi.fn();
    const { result } = renderHook(() => {
      const [filters, setFilters] = React.useState(initialFilters);
      const [page, setPage] = React.useState(3);
      useHomeCoordinator({
        filters,
        setFilters,
        homeFilterMultiSelect: true,
        nsfw: true,
        steamDataSource: 'community',
        setPage,
        setFilterRefreshToken: vi.fn(),
        cancelNextPagePrefetch,
        clearWorkshopCache: vi.fn(),
        markWorkshopForceRefresh: vi.fn(),
        clearDetailsCache: vi.fn(),
        closeOverlays: vi.fn(),
      });
      return { filters, page };
    });

    await waitFor(() => expect(result.current.filters.resolutions).toEqual(['3440 x 1440', '2560 x 1080']));
    expect(result.current.page).toBe(3);
    expect(cancelNextPagePrefetch).not.toHaveBeenCalled();
  });
});

function renderCoordinator(filtersOverride: Partial<Filters> = {}, steamDataSource: 'community' | 'webapi' | 'cm' = 'cm') {
  return renderHook(() => {
    const [filters, setFilters] = React.useState({ ...initialFilters, ...filtersOverride });
    const [page, setPage] = React.useState(3);
    const coordinator = useHomeCoordinator({
      filters,
      setFilters,
      homeFilterMultiSelect: true,
      nsfw: true,
      steamDataSource,
      setPage,
      setFilterRefreshToken: vi.fn(),
      cancelNextPagePrefetch: vi.fn(),
      clearWorkshopCache: vi.fn(),
      markWorkshopForceRefresh: vi.fn(),
      clearDetailsCache: vi.fn(),
      closeOverlays: vi.fn(),
    });
    return { filters, page, ...coordinator };
  });
}

describe('useHomeCoordinator official search behavior', () => {
  test('ordinary text preserves the selected trend sort and time-window semantics', () => {
    const { result } = renderCoordinator({ sort: 'trend' });

    act(() => result.current.updateFilter({ search: 'city rain' }));
    expect(result.current.filters.sort).toBe('trend');
    expect(result.current.filters.days).toBe('30');
    act(() => result.current.updateFilter({ search: '' }));
    expect(result.current.filters.sort).toBe('trend');
  });

  test('a manual sort change during search remains selected after clearing search', () => {
    const { result } = renderCoordinator({ sort: 'trend' });

    act(() => result.current.updateFilter({ search: 'city rain' }));
    act(() => result.current.updateFilter({ sort: 'mostrecent' }));
    act(() => result.current.updateFilter({ search: '' }));
    expect(result.current.filters.sort).toBe('mostrecent');
  });

  test.each(['author:76561198000000001', '3003011737', 'tag:Anime|Nature'])('special search %s keeps the selected sort', (search) => {
    const { result } = renderCoordinator({ sort: 'trend' });
    act(() => result.current.updateFilter({ search }));
    expect(result.current.filters.sort).toBe('trend');
  });

  test('Community clears a previously enabled mobile compatibility filter', async () => {
    const { result } = renderCoordinator({ mobileCompatibleOnly: true }, 'community');
    await waitFor(() => expect(result.current.filters.mobileCompatibleOnly).toBe(false));
  });

  test.each(['90', '180'])('non-Community sources reset the Community-only %s-day window', async (days) => {
    const { result } = renderCoordinator({ days }, 'cm');
    await waitFor(() => expect(result.current.filters.days).toBe('30'));
    expect(result.current.page).toBe(1);
  });

  test.each(['90', '180'])('Community retains its %s-day window', async (days) => {
    const { result } = renderCoordinator({ days }, 'community');
    await waitFor(() => expect(result.current.filters.days).toBe(days));
    expect(result.current.page).toBe(3);
  });
});
