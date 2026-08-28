import type { WorkshopItem } from '@/lib/api';
import { parseDetailTagSearch } from '@/lib/detailTagSearch.mjs';
import {
  normalizeFilterTypes,
  normalizeResolutionSelection,
  normalizeRatings,
  type Filters,
} from '@/lib/normalizers';
import {
  CONTENT_RATINGS,
  STEAM_RESOLUTION_TAGS,
  VISIBLE_WORKSHOP_TYPES,
  WORKSHOP_GENRES,
  WORKSHOP_RESOLUTIONS,
} from '@/lib/workshopFilterCatalog';

const APPID = 431960;

export const WORKSHOP_QUERY_CACHE_TTL_MS = 2 * 60 * 1000;
const COMMUNITY_HTML_QUERY_CACHE_TTL_MS = 30 * 1000;

const PERSONAL_FILTER_PARAM_MAP: Record<string, {
  browsefilter?: string;
  special_filter?: number;
  path?: string;
  browsesort?: string;
  actualsort?: string;
  section?: string;
}> = {
  mysubscriptions: { browsefilter: 'mysubscriptions', path: 'myfiles' },
  myfavorites: { browsefilter: 'myfavorites', path: 'myfiles' },
  voted: { browsefilter: 'myvotes', path: 'myfiles' },
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

export type WorkshopQuerySnapshot = {
  filters: Filters;
  exactPhrase: boolean;
  page: number;
  items: WorkshopItem[];
  total: number;
  serverTotalPages: number;
  dataSource: string;
  steamDataSource: 'community' | 'webapi' | 'cm';
  fallbackUsed: boolean;
  error: string;
};

export function workshopCacheKey(filters: Filters, page: number, pageSize: number, exactPhrase: boolean, steamDataSource = 'community', language = 'zh') {
  const query = exactPhrase ? { filters, exactPhrase: true, steamDataSource, language } : { filters, steamDataSource, language };
  return JSON.stringify(page === 1 ? { ...query, page } : { ...query, page, pageSize });
}

export function findWorkshopCacheEntry(cache: Map<string, WorkshopCacheEntry>, filters: Filters, page: number, pageSize: number, exactPhrase: boolean, steamDataSource = 'community', language = 'zh') {
  const exact = cache.get(workshopCacheKey(filters, page, pageSize, exactPhrase, steamDataSource, language));
  if (exact && cacheEntryCoversPage(exact, pageSize) && !isCacheStale(exact)) return exact;
  let best: WorkshopCacheEntry | undefined;
  for (const [key, entry] of cache) {
    try {
      const parsed = JSON.parse(key);
      if (parsed.page !== page || parsed.steamDataSource !== steamDataSource || parsed.language !== language || JSON.stringify(parsed.filters) !== JSON.stringify(filters) || !!parsed.exactPhrase !== !!exactPhrase) continue;
      if (!cacheEntryCoversPage(entry, pageSize) || isCacheStale(entry)) continue;
      if (!best || entry.items.length < best.items.length) best = entry;
    } catch {}
  }
  return best;
}

function cacheEntryCoversPage(entry: WorkshopCacheEntry, pageSize: number) {
  return entry.items.length >= pageSize || (entry.source === 'community-html' && entry.pageSize >= pageSize);
}

function isCacheStale(entry: WorkshopCacheEntry) {
  const ttlMs = entry.source === 'community-html' ? COMMUNITY_HTML_QUERY_CACHE_TTL_MS : WORKSHOP_QUERY_CACHE_TTL_MS;
  return Date.now() - entry.cachedAt > ttlMs;
}

export function buildQuery(filters: Filters, page: number, pageSize: number, exactPhrase: boolean, nsfw = true, steamDataSource: 'community' | 'webapi' | 'cm' = 'community', language = 'zh') {
  const queryTypeMap: Record<string, number> = { trend: 1, mostrecent: 2, toprated: 0, mostvotes: 11, totaluniquesubscribers: 16 };
  const params: Record<string, string | number> = {
    appid: APPID,
    query_type: queryTypeMap[filters.sort] ?? 1,
    page,
    numperpage: pageSize,
  };
  if (steamDataSource !== 'community') params.language = language === 'en' ? 'english' : 'schinese';
  const search = filters.search.trim();
  const detailTagSearch = parseDetailTagSearch(search);
  const workshopId = extractWorkshopId(search);
  const ordinaryTextSearch = !!search && !workshopId && !search.startsWith('author:') && detailTagSearch.length === 0;
  if (workshopId) params.workshop_id = workshopId;
  else if (search.startsWith('author:')) params.creator = search.replace(/^author:/, '').trim();
  else if (ordinaryTextSearch) {
    params.search_text = exactPhrase && !search.includes('"') ? `"${search}"` : search;
  }
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
  const normalizedTypes = normalizeFilterTypes(filters.types);
  const validTypes = normalizedTypes.length ? normalizedTypes : [...VISIBLE_WORKSHOP_TYPES];
  const validRatings = normalizeRatings(filters.ratings, nsfw, undefined, filters.rating);
  const selectedRatings = validRatings.includes('') ? [...CONTENT_RATINGS] : validRatings.filter(Boolean);
  const validGenres = filters.genres.filter((genre) => WORKSHOP_GENRES.includes(genre as typeof WORKSHOP_GENRES[number]));
  const normalizedResolutions = normalizeResolutionSelection(filters.resolutions, steamDataSource);
  const selectedResolutions = normalizedResolutions.length ? normalizedResolutions : [...WORKSHOP_RESOLUTIONS];

  (filters.officialTags || []).forEach((tag) => appendUniqueTag(tags, tag));
  (filters.excludedOfficialTags || []).forEach((tag, index) => { params[`excludedtags[${index}]`] = tag; });
  validTypes.forEach((tag, index) => { params[`type_or[${index}]`] = tag; });
  selectedRatings.forEach((tag, index) => { params[`rating_or[${index}]`] = tag; });
  validGenres.forEach((tag, index) => { params[`genre_or[${index}]`] = tag; });
  if (!validGenres.length) params[`excludedtags[${(filters.excludedOfficialTags || []).length}]`] = 'Unspecified';
  params['category_or[0]'] = 'Wallpaper';
  selectedResolutions.forEach((tag, index) => { params[`resolution_or[${index}]`] = STEAM_RESOLUTION_TAGS[tag] || tag; });
  tags.forEach((tag, index) => {
    params[`requiredtags[${index}]`] = tag;
  });
  if (filters.mobileCompatibleOnly && steamDataSource !== 'community') params.mobile_compatible = 1;
  params.community_tag_filter = '1';
  return params;
}

function appendUniqueTag(tags: string[], value: string) {
  if (value && !tags.includes(value)) tags.push(value);
}

function extractWorkshopId(value: string) {
  const raw = String(value || '').trim();
  if (/^\d{6,}$/.test(raw)) return raw;
  const match = raw.match(/(?:publishedfileid|id)=([0-9]{6,})/i) || raw.match(/sharedfiles\/filedetails\/\?id=([0-9]{6,})/i);
  return match ? match[1] : '';
}
