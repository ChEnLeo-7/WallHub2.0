import * as React from 'react';
import {
  getDetailsBatch,
  queryWorkshop,
  waitSteamAccessReady,
  type WorkshopItem,
} from '@/lib/api';
import type { Filters } from '@/lib/normalizers';
import {
  buildQuery,
  findWorkshopCacheEntry,
  workshopCacheKey,
  WORKSHOP_QUERY_CACHE_TTL_MS,
  type WorkshopCacheEntry,
  type WorkshopQuerySnapshot,
} from '@/lib/workshopQuery';
import type { ApiError } from '@/lib/api/errors';
import { getNextPagePrefetchPlan } from '@/lib/paginationPrefetch.mjs';
import { pruneWorkshopCache } from '@/lib/workshopCache.mjs';
import { scheduleIdleTask } from '@/lib/idleTask.mjs';
import { isWallpaperSearchItem } from '@/lib/workshop';

export type { WorkshopQuerySnapshot } from '@/lib/workshopQuery';

type UseWorkshopQueryOptions = {
  enabled: boolean;
  filters: Filters;
  page: number;
  pageSize: number;
  exactPhrase: boolean;
  nsfw: boolean;
  prefetchNextPage: boolean;
  steamAccessEnhance: boolean;
  steamDataSource: 'community' | 'webapi' | 'cm';
  language: 'zh' | 'en';
  refreshToken: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  onWarning: (message: string) => void;
};

const MAX_WORKSHOP_QUERY_CACHE_ENTRIES = 60;

export function useWorkshopQuery({
  enabled,
  filters,
  page,
  pageSize,
  exactPhrase,
  nsfw,
  prefetchNextPage,
  steamAccessEnhance,
  steamDataSource,
  language,
  refreshToken,
  setPage,
  onWarning,
}: UseWorkshopQueryOptions) {
  const [items, setItems] = React.useState<WorkshopItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [serverTotalPages, setServerTotalPages] = React.useState(0);
  const [dataSource, setDataSource] = React.useState('');
  const [fallbackUsed, setFallbackUsed] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [warmingSteamIp, setWarmingSteamIp] = React.useState(false);
  const [error, setError] = React.useState('');
  const [requiresSteamLogin, setRequiresSteamLogin] = React.useState(false);
  const [suppressGridLayoutAnimation, setSuppressGridLayoutAnimation] = React.useState(false);
  const queryCacheRef = React.useRef(new Map<string, WorkshopCacheEntry>());
  const queryRequestRef = React.useRef(0);
  const searchRequestRef = React.useRef<AbortController | null>(null);
  const prefetchRequestRef = React.useRef<AbortController | null>(null);
  const prefetchRequestTokenRef = React.useRef(0);
  const backgroundDetailsTokenRef = React.useRef(0);
  const backgroundDetailsCancelRef = React.useRef<(() => void) | null>(null);
  const forceRefreshRef = React.useRef(false);
  const restoreKeyRef = React.useRef('');
  const warningShownAtRef = React.useRef(0);

  const cancelNextPagePrefetch = React.useCallback(() => {
    prefetchRequestTokenRef.current += 1;
    prefetchRequestRef.current?.abort();
    prefetchRequestRef.current = null;
  }, []);

  const cancelBackgroundDetails = React.useCallback(() => {
    backgroundDetailsTokenRef.current += 1;
    backgroundDetailsCancelRef.current?.();
    backgroundDetailsCancelRef.current = null;
  }, []);

  const cancelActiveQuery = React.useCallback(() => {
    queryRequestRef.current += 1;
    searchRequestRef.current?.abort();
    searchRequestRef.current = null;
    cancelNextPagePrefetch();
    cancelBackgroundDetails();
    setWarmingSteamIp(false);
    setLoading(false);
  }, [cancelBackgroundDetails, cancelNextPagePrefetch]);

  const clearCache = React.useCallback(() => {
    queryCacheRef.current.clear();
  }, []);

  const markForceRefresh = React.useCallback(() => {
    forceRefreshRef.current = true;
  }, []);

  const restoreState = React.useCallback((snapshot: WorkshopQuerySnapshot) => {
    cancelActiveQuery();
    restoreKeyRef.current = workshopCacheKey(
      snapshot.filters,
      snapshot.page,
      pageSize,
      !!snapshot.filters.search.trim() && snapshot.exactPhrase,
      snapshot.steamDataSource,
      language,
    );
    setItems(snapshot.items);
    setTotal(snapshot.total);
    setServerTotalPages(snapshot.serverTotalPages);
    setDataSource(snapshot.dataSource);
    setFallbackUsed(snapshot.fallbackUsed);
    setError(snapshot.error);
    setLoading(false);
    setWarmingSteamIp(false);
  }, [cancelActiveQuery, language, pageSize]);

  const scheduleBackgroundDetails = React.useCallback((baseItems: WorkshopItem[], cacheKey: string, totalValue: number, requestId: number) => {
    const needsDetails = baseItems.filter((item) => {
      const tags = Array.isArray(item.tags) ? item.tags : [];
      const preview = String(item.preview_url || '');
      return item.detailsPending || !preview || /[?&](?:ima|impolicy)=/i.test(preview) || !tags.length || !item.file_size || item.file_size === '未知';
    });
    if (!needsDetails.length) return;

    const token = ++backgroundDetailsTokenRef.current;
    backgroundDetailsCancelRef.current?.();
    const batches = Array.from({ length: Math.ceil(needsDetails.length / 12) }, (_, index) => needsDetails.slice(index * 12, index * 12 + 12));
    const runBatch = (batchIndex: number) => {
      const batch = batches[batchIndex];
      if (!batch || token !== backgroundDetailsTokenRef.current || requestId !== queryRequestRef.current) return;
      backgroundDetailsCancelRef.current = scheduleIdleTask(() => {
        const requestedIds = new Set(batch.map((item) => String(item.publishedfileid)));
        const applyDetails = (detailItems: WorkshopItem[]) => {
          if (token !== backgroundDetailsTokenRef.current || requestId !== queryRequestRef.current) return;
          const detailsById = new Map(detailItems.map((item) => [String(item.publishedfileid), item]));
          const mergeItem = (item: WorkshopItem): WorkshopItem | null => {
            const id = String(item.publishedfileid);
            if (!requestedIds.has(id)) return item;
            const detail = detailsById.get(id);
            if (!detail) return { ...item, detailsPending: false };
            const merged = {
              ...item,
              ...detail,
              title: detail.title || item.title,
              preview_url: detail.preview_url || item.preview_url,
              short_description: detail.short_description || item.short_description,
              author: detail.author || item.author,
              creator: detail.creator || item.creator,
              tags: detail.tags && detail.tags.length ? detail.tags : item.tags,
              detailsPending: false,
            };
            return isWallpaperSearchItem(merged, filters.types) ? merged : null;
          };
          const mergeItems = (source: WorkshopItem[]) => source.map(mergeItem).filter((item): item is WorkshopItem => item !== null);
          setSuppressGridLayoutAnimation(true);
          setItems(mergeItems);
          window.requestAnimationFrame(() => setSuppressGridLayoutAnimation(false));
          const previous = queryCacheRef.current.get(cacheKey);
          if (previous) {
            queryCacheRef.current.set(cacheKey, {
              ...previous,
              pageSize,
              items: mergeItems(previous.items),
              total: previous.total || totalValue,
            });
            pruneWorkshopCache(queryCacheRef.current, {
              ttlMs: WORKSHOP_QUERY_CACHE_TTL_MS,
              maxEntries: MAX_WORKSHOP_QUERY_CACHE_ENTRIES,
            });
          }
        };
        getDetailsBatch(batch.map((item) => item.publishedfileid))
          .then(applyDetails)
          .catch((detailsError) => {
            applyDetails([]);
            console.warn('[details-batch]', detailsError);
          })
          .finally(() => {
            if (token !== backgroundDetailsTokenRef.current || requestId !== queryRequestRef.current) return;
            if (batchIndex + 1 < batches.length) runBatch(batchIndex + 1);
            else backgroundDetailsCancelRef.current = null;
          });
      });
    };
    runBatch(0);
  }, [filters.types, pageSize]);

  const prefetchFollowingPage = React.useCallback((currentPage: number, currentTotalPages: number) => {
    const nextPage = currentPage + 1;
    const alreadyCached = !!findWorkshopCacheEntry(queryCacheRef.current, filters, nextPage, pageSize, exactPhrase, steamDataSource, language);
    const plan = getNextPagePrefetchPlan({
      enabled: prefetchNextPage,
      page: currentPage,
      totalPages: currentTotalPages,
      alreadyCached,
    });
    if (!plan) return;

    cancelNextPagePrefetch();
    const controller = new AbortController();
    const token = prefetchRequestTokenRef.current;
    prefetchRequestRef.current = controller;
    const cacheKey = workshopCacheKey(filters, plan.page, pageSize, exactPhrase, steamDataSource, language);
    void queryWorkshop(buildQuery(filters, plan.page, pageSize, exactPhrase, nsfw, steamDataSource, language), { signal: controller.signal })
      .then((data) => {
        if (token !== prefetchRequestTokenRef.current || controller.signal.aborted) return;
        const totalValue = data.total || data.items.length;
        const nextEntry = {
          pageSize,
          items: data.items,
          total: totalValue,
          totalPages: Math.max(1, data.totalPages || Math.ceil(totalValue / pageSize)),
          source: data.source,
          fallbackUsed: data.fallbackUsed,
          cachedAt: Date.now(),
        };
        const previous = queryCacheRef.current.get(cacheKey);
        if (!previous || previous.items.length <= nextEntry.items.length) queryCacheRef.current.set(cacheKey, nextEntry);
        pruneWorkshopCache(queryCacheRef.current, {
          ttlMs: WORKSHOP_QUERY_CACHE_TTL_MS,
          maxEntries: MAX_WORKSHOP_QUERY_CACHE_ENTRIES,
        });
      })
      .catch((prefetchError) => {
        if (!controller.signal.aborted) console.warn('[next-page-prefetch]', prefetchError);
      })
      .finally(() => {
        if (token === prefetchRequestTokenRef.current && prefetchRequestRef.current === controller) prefetchRequestRef.current = null;
      });
  }, [cancelNextPagePrefetch, exactPhrase, filters, language, nsfw, pageSize, prefetchNextPage, steamDataSource]);

  const loadItems = React.useCallback(async () => {
    if (!enabled) return;
    const currentKey = workshopCacheKey(filters, page, pageSize, exactPhrase, steamDataSource, language);
    if (restoreKeyRef.current === currentKey) {
      restoreKeyRef.current = '';
      return;
    }

    cancelActiveQuery();
    const forceThis = forceRefreshRef.current;
    if (forceThis) forceRefreshRef.current = false;
    const cacheKey = workshopCacheKey(filters, page, pageSize, exactPhrase, steamDataSource, language);
    const cached = forceThis ? null : findWorkshopCacheEntry(queryCacheRef.current, filters, page, pageSize, exactPhrase, steamDataSource, language);
    if (cached) {
      setError('');
      setRequiresSteamLogin(false);
      setItems(cached.items.slice(0, pageSize));
      setTotal(cached.total);
      setServerTotalPages(cached.totalPages || Math.ceil(cached.total / pageSize));
      setDataSource(cached.source || '');
      setFallbackUsed(!!cached.fallbackUsed);
      setLoading(false);
      scheduleBackgroundDetails(cached.items.slice(0, pageSize), cacheKey, cached.total, queryRequestRef.current);
      prefetchFollowingPage(page, cached.totalPages || Math.ceil(cached.total / pageSize));
      return;
    }

    const requestId = ++queryRequestRef.current;
    const searchController = new AbortController();
    searchRequestRef.current = searchController;
    setItems([]);
    setLoading(true);
    setError('');
    setRequiresSteamLogin(false);
    try {
      const queryParams = buildQuery(filters, page, pageSize, exactPhrase, nsfw, steamDataSource, language);
      if (forceThis) queryParams._refresh = 1;
      if (steamAccessEnhance && steamDataSource !== 'community') {
        setWarmingSteamIp(true);
        await waitSteamAccessReady({ signal: searchController.signal });
        if (requestId !== queryRequestRef.current) return;
        setWarmingSteamIp(false);
      }
      const data = await queryWorkshop(queryParams, { signal: searchController.signal });
      if (requestId !== queryRequestRef.current) return;
      if (data.warningCode === 'STEAM_WEBAPI_SLOW_OR_FAILED' && Date.now() - warningShownAtRef.current > 30000) {
        warningShownAtRef.current = Date.now();
        onWarning('api.steampowered.com 加载较慢或失败，可在实验性选项中调整 API 域名控制以改善连接。');
      }
      const responseTotal = data.total || data.items.length;
      const responseTotalPages = Math.max(1, data.totalPages || Math.ceil(responseTotal / pageSize));
      if (!data.items.length && responseTotal > 0 && page > responseTotalPages) {
        setTotal(responseTotal);
        setLoading(false);
        setPage(responseTotalPages);
        return;
      }
      const nextEntry = {
        pageSize,
        items: data.items,
        total: responseTotal,
        totalPages: responseTotalPages,
        source: data.source,
        fallbackUsed: data.fallbackUsed,
        cachedAt: Date.now(),
      };
      if (!forceThis) {
        const previous = queryCacheRef.current.get(cacheKey);
        if (!previous || previous.items.length <= nextEntry.items.length) queryCacheRef.current.set(cacheKey, nextEntry);
        pruneWorkshopCache(queryCacheRef.current, {
          ttlMs: WORKSHOP_QUERY_CACHE_TTL_MS,
          maxEntries: MAX_WORKSHOP_QUERY_CACHE_ENTRIES,
        });
      }
      setItems(data.items);
      setTotal(responseTotal);
      setServerTotalPages(responseTotalPages);
      setDataSource(data.source || '');
      setFallbackUsed(!!data.fallbackUsed);
      scheduleBackgroundDetails(data.items, cacheKey, responseTotal, requestId);
      prefetchFollowingPage(page, responseTotalPages);
    } catch (queryError) {
      if (requestId !== queryRequestRef.current) return;
      if (queryError instanceof DOMException && queryError.name === 'AbortError') return;
      if (queryError instanceof Error && queryError.name === 'AbortError') return;
      const apiError = queryError as ApiError;
      setError(queryError instanceof Error ? queryError.message : String(queryError));
      setRequiresSteamLogin(!!apiError?.requiresSteamLogin || apiError?.code === 'STEAM_CM_LOGIN_REQUIRED');
      setItems([]);
      setTotal(0);
      setServerTotalPages(0);
      setDataSource('');
      setFallbackUsed(false);
    } finally {
      if (requestId === queryRequestRef.current) {
        if (searchRequestRef.current === searchController) searchRequestRef.current = null;
        setWarmingSteamIp(false);
        setLoading(false);
      }
      if (forceThis) forceRefreshRef.current = false;
    }
  }, [cancelActiveQuery, enabled, exactPhrase, filters, language, nsfw, onWarning, page, pageSize, prefetchFollowingPage, refreshToken, scheduleBackgroundDetails, setPage, steamAccessEnhance, steamDataSource]);

  React.useEffect(() => {
    if (!prefetchNextPage) cancelNextPagePrefetch();
  }, [cancelNextPagePrefetch, prefetchNextPage]);

  React.useEffect(() => {
    if (enabled) return;
    cancelActiveQuery();
  }, [cancelActiveQuery, enabled]);

  React.useEffect(() => {
    void loadItems();
  }, [loadItems]);

  React.useEffect(() => () => cancelActiveQuery(), [cancelActiveQuery]);

  return {
    items,
    total,
    serverTotalPages,
    dataSource,
    fallbackUsed,
    loading,
    warmingSteamIp,
    error,
    requiresSteamLogin,
    suppressGridLayoutAnimation,
    loadItems,
    cancelActiveQuery,
    cancelNextPagePrefetch,
    clearCache,
    markForceRefresh,
    restoreState,
  };
}
