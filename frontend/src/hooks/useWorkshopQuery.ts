import { useCallback } from 'react';
import { queryWorkshop, type WorkshopItem } from '@/lib/api';
import { parseDetailTagSearch } from '@/lib/detailTagSearch.mjs';
import {
  normalizeFilterTypes,
  normalizeRatings,
  type Filters,
} from '@/lib/normalizers';

const APPID = 431960;

export const WORKSHOP_QUERY_CACHE_TTL_MS = 2 * 60 * 1000; // 1-3 分钟窗口，取中值 2 分钟
const ALL_RESOLUTION_TAGS = [
  'Standard',
  '1280 x 720',
  '1366 x 768',
  '1920 x 1080',
  '2560 x 1440',
  '3840 x 2160',
  'Ultrawide',
  '2560 x 1080',
  '3440 x 1440',
  'Dual monitor',
  '3840 x 1080',
  '5120 x 1440',
  '7680 x 2160',
  'Triple monitor',
  '4096 x 768',
  '5760 x 1080',
  '7680 x 1440',
  '11520 x 2160',
  'Portrait',
  '720 x 1280',
  '1080 x 1920',
  '1440 x 2560',
  '2160 x 3840',
  'Other resolution',
  'Dynamic resolution',
];
const PERSONAL_FILTER_PARAM_MAP: Record<string, { browsefilter?: string; special_filter?: number; path?: string; browsesort?: string; actualsort?: string; section?: string }> = {
  mysubscriptions: { browsefilter: 'mysubscriptions', path: 'myfiles' },
  myfavorites: { browsefilter: 'myfavorites', path: 'myfiles' },
  voted: { browsefilter: 'myvotes', path: 'myfiles' },
  // Steam's current Workshop UI exposes friend/follow filters through
  // special_filter rather than the old browsefilter aliases.
  friendsfavorites: { special_filter: 2 },
  friendscreated: { special_filter: 3 },
  followedcreated: { special_filter: 4 },
};

export type WorkshopCacheEntry = {
  pageSize: number;
  items: WorkshopItem[];
  total: number;
  totalPages?: number;
  source?: string;
  fallbackUsed?: boolean;
  cachedAt: number;
};

export function workshopCacheKey(filters: Filters, page: number, pageSize: number, exactPhrase: boolean) {
  const query = exactPhrase ? { filters, exactPhrase: true } : { filters };
  return JSON.stringify(page === 1 ? { ...query, page } : { ...query, page, pageSize });
}

export function findWorkshopCacheEntry(cache: Map<string, WorkshopCacheEntry>, filters: Filters, page: number, pageSize: number, exactPhrase: boolean) {
  const exact = cache.get(workshopCacheKey(filters, page, pageSize, exactPhrase));
  if (exact && exact.items.length >= pageSize && !isCacheStale(exact)) return exact;
  let best: WorkshopCacheEntry | undefined;
  for (const [key, entry] of cache) {
    try {
      const parsed = JSON.parse(key);
      if (parsed.page !== page || JSON.stringify(parsed.filters) !== JSON.stringify(filters) || !!parsed.exactPhrase !== !!exactPhrase) continue;
      if (entry.items.length < pageSize) continue;
      if (isCacheStale(entry)) continue;
      if (!best || entry.items.length < best.items.length) best = entry;
    } catch {}
  }
  return best;
}

function isCacheStale(entry: WorkshopCacheEntry): boolean {
  return (Date.now() - entry.cachedAt) > WORKSHOP_QUERY_CACHE_TTL_MS;
}

export function buildQuery(filters: Filters, page: number, pageSize: number, exactPhrase: boolean, nsfw = true) {
  const queryTypeMap: Record<string, number> = { trend: 1, mostrecent: 2, toprated: 0, mostvotes: 11, totaluniquesubscribers: 16 };
  const params: Record<string, string | number> = {
    appid: APPID,
    query_type: queryTypeMap[filters.sort] ?? 1,
    page,
    numperpage: pageSize,
  };
  const search = filters.search.trim();
  const detailTagSearch = parseDetailTagSearch(search);
  const workshopId = extractWorkshopId(search);
  if (workshopId) params.workshop_id = workshopId;
  else if (search.startsWith('author:')) params.creator = search.replace(/^author:/, '').trim();
  else if (detailTagSearch.length === 0 && search) params.search_text = search;
  if (exactPhrase && search && !workshopId && !search.startsWith('author:') && detailTagSearch.length === 0) params.exact_phrase = 1;
  if (filters.personalFilter) {
    const personal = PERSONAL_FILTER_PARAM_MAP[filters.personalFilter] || { browsefilter: filters.personalFilter };
    if (personal.browsefilter) params.browsefilter = personal.browsefilter;
    if (personal.special_filter != null) params.special_filter = personal.special_filter;
    if (personal.path) params.path = personal.path;
    if (personal.browsesort) params.browsesort = personal.browsesort;
    if (personal.actualsort) params.actualsort = personal.actualsort;
    if (personal.section) params.section = personal.section;
    params.sortmethod = filters.personalSort;
  }
  if (!filters.personalFilter && filters.days && filters.sort === 'trend' && filters.days !== '0') params.days = Number(filters.days);

  const tags: string[] = [...detailTagSearch];
  const validTypes = normalizeFilterTypes(filters.types);
  if (validTypes.length === 1) tags.push(validTypes[0]);
  if (validTypes.length > 1 && validTypes.length < 4) {
    validTypes.forEach((type, index) => {
      params[`type_or[${index}]`] = type;
    });
  }
  const validRatings = normalizeRatings(filters.ratings, nsfw, undefined, filters.rating);
  if (validRatings.length === 1 && validRatings[0]) tags.push(validRatings[0]);
  if (validRatings.length > 1) {
    validRatings.filter(Boolean).forEach((rating, index) => {
      params[`rating_or[${index}]`] = rating;
    });
  }
  const validGenres = filters.genres.filter((g) => {
    const GENRES = [
      { id: 'Abstract' }, { id: 'Animal' }, { id: 'Anime' }, { id: 'Cartoon' }, { id: 'CGI' },
      { id: 'Cyberpunk' }, { id: 'Fantasy' }, { id: 'Game' }, { id: 'Girls' }, { id: 'Guys' },
      { id: 'Landscape' }, { id: 'Medieval' }, { id: 'Memes' }, { id: 'MMD' }, { id: 'Music' },
      { id: 'Nature' }, { id: 'Pixel art' }, { id: 'Relaxing' }, { id: 'Retro' }, { id: 'Sci-Fi' },
      { id: 'Sports' }, { id: 'Technology' }, { id: 'Television' }, { id: 'Vehicle' }, { id: 'Unspecified' }
    ];
    return GENRES.some((x) => x.id === g);
  });
  if (validGenres.length === 1) tags.push(validGenres[0]);
  if (validGenres.length > 1 && validGenres.length < 25) {
    validGenres.forEach((genre, index) => {
      params[`genre_or[${index}]`] = genre;
    });
  }
  tags.forEach((tag, index) => {
    params[`requiredtags[${index}]`] = tag;
  });
  const resolutionTags = filters.resolutions?.length === ALL_RESOLUTION_TAGS.length ? [] : (filters.resolutions || []);
  (filters.officialTags || []).forEach((tag) => {
    if (!tags.includes(tag)) params[`requiredtags[${Object.keys(params).filter((key) => /^requiredtags/.test(key)).length}]`] = tag;
  });
  if (resolutionTags.length === 1) {
    const tag = resolutionTags[0];
    if (!tags.includes(tag)) params[`requiredtags[${Object.keys(params).filter((key) => /^requiredtags/.test(key)).length}]`] = tag;
  }
  const hasPartialGenreSelection = validGenres.length > 0 && validGenres.length < 25;
  // Explicit Workshop tag selections keep their Community-compatible query marker.
  if (detailTagSearch.length > 0 || hasPartialGenreSelection || filters.officialTags.length > 0 || resolutionTags.length > 0) {
    params.community_tag_filter = '1';
  }
  return params;
}

function extractWorkshopId(value: string) {
  const raw = String(value || '').trim();
  if (/^\d{6,}$/.test(raw)) return raw;
  const match = raw.match(/(?:publishedfileid|id)=([0-9]{6,})/i) || raw.match(/sharedfiles\/filedetails\/\?id=([0-9]{6,})/i);
  return match ? match[1] : '';
}

export interface UseWorkshopQueryResult {
  items: WorkshopItem[];
  total: number;
  loading: boolean;
  error: string;
  loadItems: () => Promise<void>;
}

export function useWorkshopQuery(
  filters: Filters,
  page: number,
  pageSize: number,
  effectiveExactPhrase: boolean,
  nsfw: boolean,
  queryCacheRef: React.MutableRefObject<Map<string, WorkshopCacheEntry>>,
  queryRequestRef: React.MutableRefObject<number>,
  setItems: (items: WorkshopItem[]) => void,
  setTotal: (total: number) => void,
  setLoading: (loading: boolean) => void,
  setError: (error: string) => void,
): UseWorkshopQueryResult {
  const loadItems = useCallback(async () => {
    const cacheKey = workshopCacheKey(filters, page, pageSize, effectiveExactPhrase);
    const cached = findWorkshopCacheEntry(queryCacheRef.current, filters, page, pageSize, effectiveExactPhrase);
    if (cached) {
      setError('');
      setItems(cached.items.slice(0, pageSize));
      setTotal(cached.total);
      setLoading(false);
      return;
    }

    const requestId = ++queryRequestRef.current;
    setItems([]);
    setLoading(true);
    setError('');
    try {
      const data = await queryWorkshop(buildQuery(filters, page, pageSize, effectiveExactPhrase, nsfw));
      if (requestId !== queryRequestRef.current) return;
      const nextEntry = { pageSize, items: data.items, total: data.total || data.items.length, totalPages: data.totalPages, source: data.source, fallbackUsed: data.fallbackUsed, cachedAt: Date.now() };
      const previous = queryCacheRef.current.get(cacheKey);
      if (!previous || previous.items.length <= nextEntry.items.length) {
        queryCacheRef.current.set(cacheKey, nextEntry);
      }
      setItems(data.items);
      setTotal(data.total || data.items.length);
    } catch (e) {
      if (requestId !== queryRequestRef.current) return;
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
      setTotal(0);
    } finally {
      if (requestId === queryRequestRef.current) setLoading(false);
    }
  }, [effectiveExactPhrase, filters, nsfw, page, pageSize, queryCacheRef, queryRequestRef, setItems, setLoading, setError, setTotal]);

  return {
    items: [],
    total: 0,
    loading: false,
    error: '',
    loadItems,
  };
}
