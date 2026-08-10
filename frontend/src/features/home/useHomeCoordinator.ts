import * as React from 'react';
import { GENRES } from '@/components/dialogs/GenreSheet';
import type { WorkshopItem } from '@/lib/api';
import { TEXT } from '@/lib/text';
import {
  defaultHomeFilters,
  normalizeRatings,
  primaryRating,
  type Filters,
} from '@/lib/normalizers';
import { itemType } from '@/lib/workshop';

export function useHomeQueryState() {
  const [page, setPage] = React.useState(1);
  const [filterRefreshToken, setFilterRefreshToken] = React.useState(0);
  return { page, setPage, filterRefreshToken, setFilterRefreshToken };
}

type UseHomeCoordinatorOptions = {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  homeFilterMultiSelect: boolean;
  nsfw: boolean;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  setFilterRefreshToken: React.Dispatch<React.SetStateAction<number>>;
  cancelNextPagePrefetch: () => void;
  clearWorkshopCache: () => void;
  markWorkshopForceRefresh: () => void;
  clearDetailsCache: () => void;
  closeOverlays: () => void;
};

export function useHomeCoordinator({
  filters,
  setFilters,
  homeFilterMultiSelect,
  nsfw,
  setPage,
  setFilterRefreshToken,
  cancelNextPagePrefetch,
  clearWorkshopCache,
  markWorkshopForceRefresh,
  clearDetailsCache,
  closeOverlays,
}: UseHomeCoordinatorOptions) {
  React.useEffect(() => {
    if (homeFilterMultiSelect) return;
    setFilters((current) => {
      const ratings = normalizeRatings([current.rating], nsfw);
      const rating = primaryRating(ratings, nsfw);
      return rating === current.rating && JSON.stringify(ratings) === JSON.stringify(current.ratings)
        ? current
        : { ...current, rating, ratings };
    });
  }, [homeFilterMultiSelect, nsfw, setFilters]);

  const updateFilter = React.useCallback((patch: Partial<Filters>) => {
    cancelNextPagePrefetch();
    const next = { ...filters, ...patch };
    const forceFilterRefresh = Object.prototype.hasOwnProperty.call(patch, 'rating')
      || Object.prototype.hasOwnProperty.call(patch, 'ratings');
    if (forceFilterRefresh) {
      clearWorkshopCache();
      markWorkshopForceRefresh();
    }
    if (JSON.stringify(next) === JSON.stringify(filters)) {
      if (forceFilterRefresh) setFilterRefreshToken((value) => value + 1);
      return;
    }
    setPage(1);
    setFilters(next);
  }, [cancelNextPagePrefetch, clearWorkshopCache, filters, markWorkshopForceRefresh, setFilterRefreshToken, setFilters, setPage]);

  const resetHome = React.useCallback((clearAuthorNavigation: () => void) => {
    clearAuthorNavigation();
    closeOverlays();
    setPage(1);
    setFilters(defaultHomeFilters(GENRES, TEXT.zh));
    clearWorkshopCache();
    clearDetailsCache();
    markWorkshopForceRefresh();
  }, [clearDetailsCache, clearWorkshopCache, closeOverlays, markWorkshopForceRefresh, setFilters, setPage]);

  return { updateFilter, resetHome };
}

type UseHomeCardActionOptions = {
  defaultAction: string;
  playVideo: (item: WorkshopItem) => void;
  backgroundDownload: (item: WorkshopItem) => void;
  openSteamPage: (item: WorkshopItem) => void;
  remoteSubscribe: (item: WorkshopItem) => void;
  download: (item: WorkshopItem) => void;
};

export function useHomeCardAction(options: UseHomeCardActionOptions) {
  const actionRef = React.useRef<(item: WorkshopItem) => void>(() => {});
  actionRef.current = (item) => {
    const action = options.defaultAction === 'playVideo' && itemType(item) !== 'Video'
      ? 'clientDownload'
      : options.defaultAction;
    if (action === 'playVideo') return options.playVideo(item);
    if (action === 'backgroundDownload') return options.backgroundDownload(item);
    if (action === 'openSteamPage') return options.openSteamPage(item);
    if (action === 'remoteSubscribe') return options.remoteSubscribe(item);
    options.download(item);
  };
  return React.useCallback((item: WorkshopItem) => actionRef.current(item), []);
}
