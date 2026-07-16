'use strict';

const {
  CONTENT_RATING_TAGS,
  WORKSHOP_TYPE_TAGS,
  collectArrayLikeParams,
  collectRatingOrParams,
  itemAllowedByContentSafety,
  filterItemsByContentSafety,
  itemMatchesAnyTag,
  itemMatchesExactPhrase,
  normalizeWorkshopIdSearch,
  sanitizeWorkshopQueryParams,
} = require('./filters');
const { cleanText } = require('./text');
const {
  buildCommunityWorkshopBrowseUrl,
  fetchWorkshopBrowsePage,
  scrapeWorkshopIds,
  queryWorkshopBySteamApi,
} = require('./query');
const { parseWorkshopBrowseHtml } = require('./parse');
const { createInFlightCoalescer } = require('../../shared/inFlight');
const {
  detailMapFromList,
  validDetailForId,
  usableDetailForId,
  mapWorkshopItem,
} = require('./search/itemMapping');

const STEAM_WORKSHOP_ACCESSIBLE_ITEMS = 50000;
const COMMUNITY_PAGE_TIMEOUT_MS = Math.max(8000, parseInt(process.env.WALLHUB_COMMUNITY_PAGE_TIMEOUT_MS || '22000', 10) || 22000);
const WORKSHOP_TYPE_TAG_KEYS = new Set(Array.from(WORKSHOP_TYPE_TAGS).map(tag => String(tag).toLowerCase()));
const COMMUNITY_GENRE_TAGS = [
  'Abstract', 'Animal', 'Anime', 'Cartoon', 'CGI', 'Cyberpunk', 'Fantasy', 'Game', 'Girls', 'Guys',
  'Landscape', 'Medieval', 'Memes', 'MMD', 'Music', 'Nature', 'Pixel art', 'Relaxing', 'Retro',
  'Sci-Fi', 'Sports', 'Technology', 'Television', 'Vehicle', 'Unspecified',
];

function usesOfficialCommunityTagFilter(params = {}) {
  return ['1', 'true', 'yes', 'on'].includes(String(params.community_tag_filter || '').toLowerCase());
}

function accessibleWorkshopTotal(total, params = {}) {
  const value = Math.max(0, parseInt(total, 10) || 0);
  if (!value || params.creator || usesOfficialCommunityTagFilter(params)) return value;
  return Math.min(value, STEAM_WORKSHOP_ACCESSIBLE_ITEMS);
}

function pageBeyondAccessibleWorkshopTotal(page, numperpage, params = {}) {
  if (params.creator || usesOfficialCommunityTagFilter(params)) return false;
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  const safeNumperpage = Math.max(1, parseInt(numperpage, 10) || 30);
  return safePage > Math.ceil(STEAM_WORKSHOP_ACCESSIBLE_ITEMS / safeNumperpage);
}

function itemHasTags(item) {
  return Array.isArray(item && item.tags) && item.tags.length > 0;
}

function itemMatchesAnyKnownTag(item, tags) {
  if (!itemHasTags(item)) return true;
  return itemMatchesAnyTag(item, tags);
}

function itemMatchesAllKnownTags(item, tags) {
  const normalized = (tags || []).map(tag => String(tag || '').trim().toLowerCase()).filter(Boolean);
  if (!normalized.length) return true;
  if (!itemHasTags(item)) return false;
  const tagSet = new Set((item.tags || []).map(tag => String((tag && tag.tag) || tag || '').trim().toLowerCase()).filter(Boolean));
  return normalized.every(tag => tagSet.has(tag));
}


function itemMatchesCreator(item, creator) {
  const requested = String(creator || '').trim();
  return !requested || String(item && item.creator || '').trim() === requested;
}
function itemExcludesAnyKnownTag(item, tags) {
  if (!itemHasTags(item)) return true;
  return !itemMatchesAnyTag(item, tags);
}

function tokenSetFromTitle(value) {
  return new Set(String(value || '')
    .toLowerCase()
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/[()[\]{}【】《》「」『』<>:：,，.。!！?？'"`~+_=|/\\-]+/g, ' ')
    .split(/\s+/)
    .map(token => token.trim())
    .filter(token => token && token.length > 1));
}

function createWorkshopSearchService(options = {}) {
  const get = options.get;
  const getFileDetailsSafe = options.getFileDetailsSafe;
  const getSteamApiKey = options.getSteamApiKey || (() => '');
  const useSteamApi = options.useSteamApi || (() => false);
  const useCommunityBrowseOrder = options.useCommunityBrowseOrder || (() => false);
  const refreshFileDetailsInBackground = options.refreshFileDetailsInBackground || (() => {});
  const steamAccessGatewayEnabled = options.steamAccessGatewayEnabled || (() => false);
  const getSteamAccessMode = options.getSteamAccessMode || (() => 'resolver');
  const isAndroidHostLikeEnv = options.isAndroidHostLikeEnv || (() => false);
  const nsfwEnabled = options.nsfwEnabled || (() => false);
  const logger = options.logger || console;
  const getSteamWebApiBaseUrl = options.getSteamWebApiBaseUrl || (() => 'https://api.steampowered.com');
  const communitySequenceTtlMs = Number(options.communitySequenceTtlMs || 2 * 60 * 1000);
  const communitySequenceCache = new Map();
  const communityDetailCache = new Map();

  // Workshop queries retain a small, short-lived LRU cache. This avoids
  // duplicate page loads while keeping normal browsing results fresh.
  // - _refresh always bypasses and does not write the result cache.
  // - network-setting changes clear both in-flight work and cached results.
  // - 影响网络的设置变更（DoH、SteamAccessEnhance、steamApiKey、useSteamApi 等）时，
  //   调用 clearInFlight() 清除当前 in-flight 并 bump generation，强制下次查询重新开始

  function queryCacheKey(params, allowNsfw) {
    if (useCommunityBrowseOrder()) {
      const page = Math.max(1, parseInt(params.page, 10) || 1);
      const pageSize = Math.max(1, parseInt(params.numperpage, 10) || 30);
      return JSON.stringify({ mode: 'community-result', sequence: buildCommunitySequenceKey(params, allowNsfw), page, pageSize });
    }
    const stable = {};
    for (const key of Object.keys(params || {}).sort()) {
      if (key === '_' || key === 't' || key === '_refresh' || key === 'refresh' || key === 'force' || key === 'nocache') continue;
      stable[key] = params[key];
    }
    stable.__nsfw = !!allowNsfw;
    stable.__mode = 'normal';
    return JSON.stringify(stable);
  }

  // 错误回退不再依赖任何历史成功缓存
  function cachedResultFor(rawParams = {}) {
    return null;
  }

  function steamCommunityHeaders(runOptions = {}) {
    const cookie = String(runOptions.steamCommunityCookie || '').trim();
    return cookie ? {
      Cookie: cookie,
      steamAccessRouteOptions: {
        requireApplicationProbe: true,
        connectionReuse: false,
        backgroundRefresh: true,
        maxAgeMs: 5 * 60 * 1000,
      },
    } : {};
  }

  async function scrapeIds(params, runOptions = {}) {
    return scrapeWorkshopIds(params, { get, logger, signal: runOptions.signal, headers: steamCommunityHeaders(runOptions) });
  }

  function paramsWithRequiredTag(params, tag) {
    const next = Object.assign({}, params);
    for (const key of Object.keys(next)) {
      if (/^genre_or(?:\[\d+\])?$/.test(key)) delete next[key];
    }
    const requiredTags = collectArrayLikeParams(next, 'requiredtags');
    if (!requiredTags.some(value => value.toLowerCase() === String(tag).toLowerCase())) {
      next[`requiredtags[${requiredTags.length}]`] = tag;
    }
    return next;
  }

  async function scrapeGenreOrIds(params, genreOr, runOptions = {}) {
    // Large tag selections (for example the 17-tag filter modal) used to fan out
    // one Steam community page per tag and then request details for hundreds of
    // ids. Keep small OR sets precise, but switch larger sets to a broad page +
    // local tag filtering path so the first page stays responsive.
    const genreFanoutLimit = 6;
    const genreList = Array.from(new Set((genreOr || []).filter(Boolean)));
    if (genreList.length <= 1 || genreList.length > genreFanoutLimit) {
      return Object.assign({ detailMap: {} }, await scrapeIds(params, runOptions));
    }

    const results = await Promise.all(genreList.map(genre => scrapeIds(paramsWithRequiredTag(params, genre), runOptions)));
    const ids = [];
    const hints = {};
    const seen = new Set();
    let totalCount = 0;
    for (const result of results) {
      if (result.totalCount > 0) totalCount += result.totalCount;
      Object.assign(hints, result.hints || {});
      for (const id of result.ids || []) {
        if (seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }
    logger.log(`[Query] Genre OR scrape fanout(${genreList.length}) merged ${ids.length} IDs from current page`);
    return { ids, totalCount, hints, detailMap: {} };
  }

  async function queryBySteamApi(apiKey, params, genreOr, runOptions = {}) {
    return queryWorkshopBySteamApi(apiKey, params, genreOr, { get, logger, signal: runOptions.signal, timeoutMs: runOptions.timeoutMs, getSteamWebApiBaseUrl });
  }

  function requireSteamApiReady(apiKey, context) {
    if (!apiKey) throw new Error(`SteamAPI ${context || 'query'} requires a Steam API key`);
  }

  function isSteamAccessSmartOrEnhanced() {
    return false;
  }

  function isDefaultHomeQuery(params = {}) {
    const appid = String(params.appid || '431960');
    const page = String(params.page || '1');
    const queryType = String(params.query_type ?? '1');
    const numperpage = parseInt(params.numperpage || 30, 10) || 30;
    return appid === '431960' && page === '1' && queryType === '1' && numperpage <= 30 &&
      !String(params.search_text || '').trim() && !String(params.creator || '').trim() && !String(params.workshop_id || '').trim();
  }

  function shouldScrapeFirst(params = {}, hasLocalOr = false) {
    return isSteamAccessSmartOrEnhanced() && (isAndroidHostLikeEnv() || isDefaultHomeQuery(params) || !hasLocalOr);
  }

  async function getShortDetails(ids, optionsForRun = {}) {
    return getFileDetailsSafe(ids, Object.assign({ safe: false, ignoreCooldown: true }, optionsForRun));
  }

  function sourceParamsForScrape(params) {
    const next = Object.assign({}, params || {});
    const kept = [];
    for (const [key, value] of Object.entries(params || {})) {
      if (!/^requiredtags/.test(key)) continue;
      delete next[key];
      const tag = String(value || '').trim();
      if (!tag) continue;
      if (tag.toLowerCase() === 'mobile') continue;
      kept.push(tag);
    }
    Array.from(new Set(kept)).forEach((tag, index) => { next[`requiredtags[${index}]`] = tag; });
    return next;
  }

  function detailFilterRequiredTags(tags) {
    const sourceOnlyTags = new Set(['mobile']);
    return (tags || []).filter(tag => !sourceOnlyTags.has(String(tag || '').trim().toLowerCase()));
  }

  function withoutRequiredTags(params, shouldDrop) {
    const next = Object.assign({}, params || {});
    const kept = [];
    for (const [key, value] of Object.entries(params || {})) {
      if (!/^requiredtags/.test(key)) continue;
      delete next[key];
      const tag = String(value || '').trim();
      if (!tag || shouldDrop(tag)) continue;
      kept.push(tag);
    }
    Array.from(new Set(kept)).forEach((tag, index) => { next[`requiredtags[${index}]`] = tag; });
    return next;
  }

  async function scrapeIdsWithFallback(params, runOptions = {}, apiFallback = {}) {
    const sourceParams = sourceParamsForScrape(params);
    const primary = await scrapeIds(sourceParams, runOptions);
    return primary;
  }

  function isAbortError(error) {
    return !!(error && error.code === 'ABORT_ERR');
  }

  async function fallbackScrapeAfterSteamApiError(error, params, genreOr, label, runOptions = {}) {
    if (isAbortError(error)) throw error;
    logger.warn(`[Query] SteamAPI ${label || 'query'} failed, fallback to workshop scrape: ${error.message}`);
    return Object.assign({ detailMap: {}, hints: {}, warningCode: 'STEAM_WEBAPI_SLOW_OR_FAILED' }, await scrapeGenreOrIds(sourceParamsForScrape(params), genreOr, runOptions));
  }

  async function queryBySteamApiOrScrape(apiKey, params, genreOr, label, runOptions = {}) {
    requireSteamApiReady(apiKey, label);
    try {
      return Object.assign({ hints: {} }, await queryBySteamApi(apiKey, params, genreOr, runOptions));
    } catch (error) {
      return fallbackScrapeAfterSteamApiError(error, params, genreOr, label, runOptions);
    }
  }

  async function scrapeFirstOrSteamApi(apiKey, params, genreOr, label, runOptions = {}) {
    return queryBySteamApiOrScrape(apiKey, params, genreOr, label, runOptions);
  }

  async function findExactPhraseFallbackItems(params, phrase, applyPostFilters, numperpage, runOptions = {}) {
    const probeParams = Object.assign({}, params, { page: 1, search_text: '' });
    const sourceData = await scrapeIds(probeParams, runOptions);
    if (!sourceData.ids || !sourceData.ids.length) return [];
    let details = [];
    try {
      details = await getShortDetails(sourceData.ids, { totalBudgetMs: 5000, signal: runOptions.signal });
    } catch (err) {
      if (isAbortError(err)) throw err;
      logger.warn('[ExactPhrase] fallback details failed:', err.message);
    }
    const detailMap = detailMapFromList(details);
    return applyPostFilters(sourceData.ids
      .filter(id => validDetailForId(detailMap[id], id))
      .map(id => mapWorkshopItem(id, detailMap[id], (sourceData.hints && sourceData.hints[id]) || {})))
      .filter(item => itemMatchesExactPhrase(item, phrase))
      .slice(0, numperpage);
  }

  function paramsForCommunityBrowse(params = {}) {
    const next = sourceParamsForScrape(params);
    const required = collectArrayLikeParams(next, 'requiredtags');
    const excluded = collectArrayLikeParams(next, 'excludedtags');
    const addTag = (list, tag) => {
      const value = String(tag || '').trim();
      if (!value || list.some(existing => existing.toLowerCase() === value.toLowerCase())) return;
      list.push(value);
    };
    const genreTags = collectArrayLikeParams(params, 'genre_or');
    const typeTags = collectArrayLikeParams(params, 'type_or').filter(tag => WORKSHOP_TYPE_TAGS.has(tag));
    const ratingTags = collectRatingOrParams(params, true);
    if (genreTags.length === 1) addTag(required, genreTags[0]);
    if (genreTags.length > 1) {
      const selected = new Set(genreTags.map(tag => tag.toLowerCase()));
      COMMUNITY_GENRE_TAGS.filter(tag => !selected.has(tag.toLowerCase())).forEach(tag => addTag(excluded, tag));
    }
    if (typeTags.length === 1) addTag(required, typeTags[0]);
    if (typeTags.length > 1) {
      const selected = new Set(typeTags.map(tag => tag.toLowerCase()));
      Array.from(WORKSHOP_TYPE_TAGS).filter(tag => !selected.has(tag.toLowerCase())).forEach(tag => addTag(excluded, tag));
    }
    if (ratingTags.length === 1) addTag(required, ratingTags[0]);
    if (ratingTags.length > 1) {
      const selected = new Set(ratingTags.map(tag => tag.toLowerCase()));
      Array.from(CONTENT_RATING_TAGS).filter(tag => !selected.has(tag.toLowerCase())).forEach(tag => addTag(excluded, tag));
    }
    for (const key of Object.keys(next)) {
      if (/^(?:genre_or|type_or|rating_or|excludedtags)(?:\[\d+\])?$/.test(key) || /^requiredtags/.test(key)) delete next[key];
    }
    required.forEach((tag, index) => { next[`requiredtags[${index}]`] = tag; });
    excluded.forEach((tag, index) => { next[`excludedtags[${index}]`] = tag; });
    return next;
  }

  function communityRatingTags(params = {}) {
    const orRatings = collectRatingOrParams(params, true);
    return Array.from(new Set(orRatings));
  }

  function buildCommunitySequenceKey(params = {}, allowNsfw = false) {
    const communityParams = Object.assign({}, paramsForCommunityBrowse(params));
    delete communityParams.page;
    delete communityParams.numperpage;
    communityParams.page = 1;
    communityParams.numperpage = 30;
    return JSON.stringify({
      url: buildCommunityWorkshopBrowseUrl(communityParams),
      ratings: communityRatingTags(params),
      nsfw: !!allowNsfw,
      exactPhrase: !!params.exact_phrase,
    });
  }

  function createCommunitySequenceEntry(key, params, allowNsfw) {
    return {
      key,
      params: paramsForCommunityBrowse(params),
      ratings: communityRatingTags(params),
      exactPhraseText: ['1', 'true', 'yes', 'on'].includes(String(params.exact_phrase || '').toLowerCase()) ? String(params.search_text || '').trim() : '',
      allowNsfw: !!allowNsfw,
      accepted: [],
      acceptedIds: new Set(),
      nextRawPage: 1,
      rawPageSize: 30,
      totalRaw: 0,
      totalRawPages: 0,
      exhausted: false,
      source: 'community-ordered',
      fallbackUsed: false,
      expiresAt: Date.now() + communitySequenceTtlMs,
      pending: null,
      diagnostics: {
        scannedPages: [],
        filteredByRating: 0,
        filteredBySafety: 0,
        filteredByExactPhrase: 0,
        duplicateRawIds: 0,
        detailsMs: 0,
        communityMs: 0,
        parseMs: 0,
      },
    };
  }

  function getCommunitySequenceEntry(key, params, allowNsfw) {
    const current = communitySequenceCache.get(key);
    if (current && current.expiresAt > Date.now()) return current;
    if (current) communitySequenceCache.delete(key);
    const entry = createCommunitySequenceEntry(key, params, allowNsfw);
    communitySequenceCache.set(key, entry);
    return entry;
  }

  function detailMatchesCommunityRatings(detail, ratings) {
    if (!ratings || !ratings.length) return true;
    if (!detail || !Array.isArray(detail.tags)) return false;
    const tagSet = new Set(detail.tags.map(tag => String((tag && tag.tag) || tag || '').trim()).filter(Boolean));
    return ratings.some(tag => tagSet.has(tag));
  }

  async function filterCommunityItemsByRatings(items, ratings, runOptions = {}) {
    const list = (items || []).filter(item => item && item.publishedfileid);
    if (!ratings || !ratings.length || !list.length) return list;
    const ids = list.map(item => String(item.publishedfileid));
    let details = [];
    try {
      details = await getShortDetails(ids, { totalBudgetMs: 5000, signal: runOptions.signal });
    } catch (err) {
      if (isAbortError(err)) throw err;
      logger.warn('[Community Rating Filter] details failed:', err.message);
    }
    const detailMap = detailMapFromList(details);
    return list
      .filter(item => detailMatchesCommunityRatings(detailMap[String(item.publishedfileid)], ratings))
      .map(item => {
        const id = String(item.publishedfileid);
        const detail = usableDetailForId(detailMap[id], id);
        return detail ? mapWorkshopItem(id, detail, item) : item;
      });
  }

  function mergeCommunityDetail(item, detail) {
    const id = String(item && item.publishedfileid || detail && detail.publishedfileid || '');
    if (!id || !validDetailForId(detail, id)) return item;
    return Object.assign({}, item, mapWorkshopItem(id, detail, item));
  }

  function updateAcceptedCommunityDetails(entry, detailMap) {
    if (!entry || !detailMap) return;
    entry.accepted = entry.accepted.map(item => {
      const id = String(item && item.publishedfileid || '');
      return mergeCommunityDetail(item, detailMap[id]);
    });
  }

  function scheduleCommunityDetailEnrichment(entry, ids, runOptions = {}) {
    const missingIds = Array.from(new Set((ids || []).map(id => String(id || '')).filter(Boolean)))
      .filter(id => !communityDetailCache.has(id));
    if (!missingIds.length) return;
    setTimeout(() => {
      detailsMapForIds(missingIds, entry, runOptions)
        .then(detailMap => {
          for (const [id, detail] of Object.entries(detailMap || {})) {
            if (validDetailForId(detail, id)) communityDetailCache.set(id, detail);
          }
          updateAcceptedCommunityDetails(entry, detailMap);
        })
        .catch(err => {
          if (!isAbortError(err)) logger.warn('[Community Sequence] background details failed:', err.message);
        });
    }, 0).unref?.();
  }

  function applyCachedCommunityDetails(items) {
    return (items || []).map(item => {
      const id = String(item && item.publishedfileid || '');
      return mergeCommunityDetail(item, communityDetailCache.get(id));
    });
  }

  function appendAcceptedCommunityItems(entry, items) {
    const safeItems = filterItemsByContentSafety(items || [], entry.allowNsfw);
    entry.diagnostics.filteredBySafety += Math.max(0, (items || []).length - safeItems.length);
    for (const item of safeItems) {
      const id = String(item && item.publishedfileid || '');
      if (!id) continue;
      if (entry.acceptedIds.has(id)) {
        entry.diagnostics.duplicateRawIds += 1;
        continue;
      }
      if (entry.exactPhraseText && !itemMatchesExactPhrase(item, entry.exactPhraseText)) {
        entry.diagnostics.filteredByExactPhrase += 1;
        continue;
      }
      entry.acceptedIds.add(id);
      entry.accepted.push(item);
    }
  }

  async function detailsMapForIds(ids, entry, runOptions = {}) {
    const startedAt = Date.now();
    let details = [];
    try {
      details = await getShortDetails(ids, { totalBudgetMs: 5000, signal: runOptions.signal });
    } catch (err) {
      if (isAbortError(err)) throw err;
      logger.warn('[Community Sequence] details failed:', err.message);
    } finally {
      entry.diagnostics.detailsMs += Date.now() - startedAt;
    }
    return detailMapFromList(details);
  }

  async function scanCommunityRawPage(entry, runOptions = {}) {
    const rawPage = entry.nextRawPage;
    const browseParams = Object.assign({}, entry.params, { page: rawPage, numperpage: entry.rawPageSize });
    const fetched = await fetchWorkshopBrowsePage(browseParams, {
      get,
      logger,
      signal: runOptions.signal,
      headers: steamCommunityHeaders(runOptions),
      timeoutMs: runOptions.timeoutMs || COMMUNITY_PAGE_TIMEOUT_MS,
    });
    entry.nextRawPage += 1;
    entry.diagnostics.communityMs += fetched.requestMs || 0;
    entry.diagnostics.parseMs += fetched.parseMs || 0;

    const ssr = fetched.ssr || {};
    if (ssr.ok && Array.isArray(ssr.results)) {
      if (!entry.totalRaw) entry.totalRaw = ssr.totalCount || 0;
      if (!entry.totalRawPages) entry.totalRawPages = ssr.totalPages || 0;
      const rawItems = ssr.results.filter(item => item && item.publishedfileid);
      const beforeRating = rawItems.length;
      const accepted = await filterCommunityItemsByRatings(rawItems, entry.ratings, runOptions);
      entry.diagnostics.filteredByRating += Math.max(0, beforeRating - accepted.length);
      appendAcceptedCommunityItems(entry, accepted);
      entry.diagnostics.scannedPages.push({ page: rawPage, source: 'community-ssr', raw: rawItems.length, accepted: accepted.length, url: fetched.url });
      if (!rawItems.length || (entry.totalRawPages > 0 && rawPage >= entry.totalRawPages) || (entry.totalRaw > 0 && rawPage >= Math.ceil(entry.totalRaw / entry.rawPageSize))) entry.exhausted = true;
      return;
    }

    const parseStartedAt = Date.now();
    const dom = parseWorkshopBrowseHtml(fetched.html);
    entry.diagnostics.parseMs += Date.now() - parseStartedAt;
    if (!dom.ids || !dom.ids.length) {
      entry.exhausted = true;
      if (!entry.accepted.length) {
        const error = new Error('Steam 社区 Workshop 页面未包含可解析的列表数据');
        error.code = /captcha|g-recaptcha|login/i.test(fetched.html) ? 'STEAM_COMMUNITY_BLOCKED' : 'COMMUNITY_PARSE_FAILED';
        throw error;
      }
      return;
    }

    entry.source = 'community-ordered-dom';
    entry.fallbackUsed = true;
    if (!entry.totalRaw) entry.totalRaw = dom.totalCount || 0;
    if (!entry.totalRawPages) entry.totalRawPages = dom.totalPages || 0;
    const detailMap = entry.ratings && entry.ratings.length ? await detailsMapForIds(dom.ids, entry, runOptions) : {};
    const rawItems = dom.ids.map(id => {
      const detail = usableDetailForId(detailMap[id], id);
      return mapWorkshopItem(id, detail, (dom.hints && dom.hints[id]) || {});
    });
    const accepted = rawItems.filter(item => detailMatchesCommunityRatings(detailMap[String(item.publishedfileid)], entry.ratings));
    entry.diagnostics.filteredByRating += Math.max(0, rawItems.length - accepted.length);
    appendAcceptedCommunityItems(entry, accepted);
    entry.diagnostics.scannedPages.push({ page: rawPage, source: 'community-dom-fallback', raw: rawItems.length, accepted: accepted.length, url: fetched.url });
    if (!dom.ids.length || (entry.totalRawPages > 0 && rawPage >= entry.totalRawPages) || (entry.totalRaw > 0 && rawPage >= Math.ceil(entry.totalRaw / entry.rawPageSize))) entry.exhausted = true;
  }

  async function ensureCommunityAcceptedCount(entry, targetCount, runOptions = {}) {
    const defaultMaxRawPages = Math.max(8, Math.min(40, Math.ceil(targetCount / 10) + 6));
    const maxRawPages = Math.max(5, Math.min(40, Number(runOptions.maxRawPages || defaultMaxRawPages)));
    const extend = async () => {
      let scanned = 0;
      while (entry.accepted.length < targetCount && !entry.exhausted && scanned < maxRawPages) {
        await scanCommunityRawPage(entry, runOptions);
        scanned += 1;
      }
      entry.expiresAt = Date.now() + communitySequenceTtlMs;
      return entry;
    };
    const pending = (entry.pending || Promise.resolve()).then(extend, extend);
    entry.pending = pending;
    try {
      return await pending;
    } finally {
      if (entry.pending === pending) entry.pending = null;
    }
  }

  function communityResponseFromItems(items, meta = {}) {
    const page = Math.max(1, parseInt(meta.page, 10) || 1);
    const pageSize = Math.max(1, parseInt(meta.pageSize, 10) || 30);
    const total = Math.max(0, parseInt(meta.total, 10) || 0);
    const totalPages = Math.max(0, parseInt(meta.totalPages, 10) || (total ? Math.ceil(total / pageSize) : 0));
    return {
      response: {
        publishedfiledetails: items,
        total,
        total_count: total,
        totalPages,
      },
      page,
      pageSize,
      total,
      totalPages,
      source: meta.source,
      officialApproximation: 'steam-community-workshop',
      fallbackUsed: !!meta.fallbackUsed,
      queryUrl: meta.queryUrl || '',
      diagnostics: meta.diagnostics || {},
      warningCode: meta.warningCode || '',
    };
  }

  function inferredCommunityTotal(total, itemCount, pageSize, params = {}) {
    const parsed = Math.max(0, parseInt(total, 10) || 0);
    if (parsed > 0) return accessibleWorkshopTotal(parsed, params);
    const communityPageCap = 30;
    const fullPageThreshold = Math.min(Math.max(1, pageSize), communityPageCap);
    return itemCount >= fullPageThreshold ? accessibleWorkshopTotal(STEAM_WORKSHOP_ACCESSIBLE_ITEMS, params) : itemCount;
  }

  function inferredCommunityPages(totalPages, total, itemCount, pageSize, params = {}) {
    const parsedPages = Math.max(0, parseInt(totalPages, 10) || 0);
    if (parsedPages > 0) return parsedPages;
    const inferredTotal = inferredCommunityTotal(total, itemCount, pageSize, params);
    return inferredTotal > 0 ? Math.ceil(inferredTotal / Math.max(1, pageSize)) : 0;
  }

  async function queryCommunitySequencePage(params, runOptions = {}) {
    const page = Math.max(1, parseInt(params.page, 10) || 1);
    const pageSize = Math.max(1, parseInt(params.numperpage, 10) || 30);
    const communityPageSize = Math.max(1, Math.min(100, pageSize));
    const absoluteOffset = (page - 1) * pageSize;
    const firstCommunityPage = Math.floor(absoluteOffset / communityPageSize) + 1;
    const firstCommunitySkip = absoluteOffset % communityPageSize;
    const communityParams = paramsForCommunityBrowse(params);
    const requestedCreator = String(params.creator || '').trim();
    const diagnostics = {
      scannedPages: [],
      detailsMs: 0,
      communityMs: 0,
      parseMs: 0,
      orderSource: 'steam-community-page',
      pageLoadMode: 'community-sequence-page',
      detailMode: 'blocking-for-preview',
      localFilterApplied: false,
      requestedCommunityPage: page,
      requestedCommunityPageSize: pageSize,
      effectiveCommunityPageSize: communityPageSize,
      firstCommunityPage,
      firstCommunitySkip,
    };

    const requireSteamLogin = !!String(communityParams.browsefilter || '').trim() ||
      !!String(communityParams.special_filter || '').trim() ||
      ['myfiles', 'votingqueue'].includes(String(communityParams.path || '').trim().toLowerCase());
    const fetchCommunityTarget = (browseParams) => fetchWorkshopBrowsePage(browseParams, {
      get,
      logger,
      signal: runOptions.signal,
      headers: steamCommunityHeaders(runOptions),
      requireSteamLogin,
      timeoutMs: runOptions.timeoutMs || COMMUNITY_PAGE_TIMEOUT_MS,
    });

    const officialCommunityTagFilter = collectArrayLikeParams(params, 'genre_or').length > 1 ||
      collectArrayLikeParams(params, 'type_or').length > 1 ||
      collectRatingOrParams(params, true).length > 1 ||
      ['1', 'true', 'yes', 'on'].includes(String(params.community_tag_filter || '').toLowerCase());
    if (officialCommunityTagFilter) diagnostics.detailMode = 'deferred-client-enrichment';

    let source = 'community-ordered';
    let totalRaw = 0;
    let totalRawPages = 0;
    let queryUrl = '';
    const rawItems = [];
    const maxPages = Math.max(1, Math.ceil((firstCommunitySkip + pageSize) / communityPageSize));
    for (let offset = 0; offset < maxPages && rawItems.length < pageSize; offset += 1) {
      const communityPage = firstCommunityPage + offset;
      let fetched;
      try {
        fetched = await fetchCommunityTarget(Object.assign({}, communityParams, { page: communityPage, numperpage: communityPageSize }));
      } catch (error) {
        if (offset === 0) throw error;
        if (!isAbortError(error)) logger.warn(`[Community] Page ${communityPage} skipped while filling UI page ${page}: ${error.message}`);
        break;
      }
      if (!queryUrl) queryUrl = fetched.url;
      diagnostics.communityMs += fetched.requestMs || 0;
      diagnostics.parseMs += fetched.parseMs || 0;

      let pageItems = [];
      const ssr = fetched.ssr || {};
      if (ssr.ok && Array.isArray(ssr.results) && ssr.results.length) {
        if (!totalRaw) totalRaw = ssr.totalCount || 0;
        if (!totalRawPages) totalRawPages = ssr.totalPages || 0;
        pageItems = ssr.results.filter(item => item && item.publishedfileid);
      } else {
        const parseStartedAt = Date.now();
        const dom = parseWorkshopBrowseHtml(fetched.html);
        diagnostics.parseMs += Date.now() - parseStartedAt;
        if (!dom.ids || !dom.ids.length) {
          if (offset === 0) {
            const error = new Error('Steam 社区 Workshop 目标页未包含可解析的列表数据');
            error.code = /captcha|g-recaptcha|login/i.test(fetched.html) ? 'STEAM_COMMUNITY_BLOCKED' : 'COMMUNITY_PARSE_FAILED';
            throw error;
          }
          break;
        }
        source = 'community-ordered-dom';
        if (!totalRaw) totalRaw = dom.totalCount || 0;
        if (!totalRawPages) totalRawPages = dom.totalPages || 0;
        pageItems = dom.ids.map(id => mapWorkshopItem(id, null, (dom.hints && dom.hints[id]) || {}));
      }
      if (offset === 0 && firstCommunitySkip > 0) pageItems = pageItems.slice(firstCommunitySkip);
      const remaining = pageSize - rawItems.length;
      const accepted = pageItems.slice(0, remaining);
      rawItems.push(...accepted);
      diagnostics.scannedPages.push({ page: communityPage, source, raw: pageItems.length + (offset === 0 ? firstCommunitySkip : 0), accepted: accepted.length, url: fetched.url });
      if (!pageItems.length || (totalRawPages > 0 && communityPage >= totalRawPages) || (totalRaw > 0 && communityPage >= Math.ceil(totalRaw / communityPageSize))) break;
    }

    const cacheEntry = {
      key: buildCommunitySequenceKey(params, !!nsfwEnabled()),
      accepted: rawItems,
      diagnostics,
    };
    let enriched = rawItems;
    if (!officialCommunityTagFilter || requestedCreator) {
      enriched = applyCachedCommunityDetails(rawItems);
      const missingDetailIds = enriched
        .map(item => String(item && item.publishedfileid || ''))
        .filter(id => id && !communityDetailCache.has(id));
      if (missingDetailIds.length) {
        const detailMap = await detailsMapForIds(missingDetailIds, cacheEntry, runOptions);
        const requestedDetailIds = new Set(missingDetailIds);
        for (const [id, detail] of Object.entries(detailMap || {})) {
          if (!requestedDetailIds.has(String(id))) continue;
          if (validDetailForId(detail, id)) communityDetailCache.set(id, detail);
        }
        enriched = applyCachedCommunityDetails(rawItems);
      }
    }

    const visibleItems = requestedCreator
      ? enriched.filter(item => itemMatchesCreator(item, requestedCreator))
      : enriched;
    const resultTotalPages = inferredCommunityPages(totalRawPages, totalRaw, visibleItems.length, pageSize, communityParams);
    const resultTotal = totalRaw > 0
      ? inferredCommunityTotal(totalRaw, visibleItems.length, pageSize, communityParams)
      : resultTotalPages * pageSize;
    return communityResponseFromItems(visibleItems, {
      page,
      pageSize,
      total: resultTotal,
      totalPages: Math.max(1, resultTotalPages || Math.ceil(resultTotal / pageSize)),
      source,
      fallbackUsed: false,
      queryUrl,
      diagnostics,
    });
  }

  async function queryCommunityPrimary(params, runOptions = {}) {
    return queryCommunitySequencePage(params, runOptions);
  }

  // 实际执行查询的内部函数（不含合并/缓存逻辑）
  async function doSearch(rawParams = {}, runOptions = {}) {
    const allowNsfw = !!nsfwEnabled();
    const params = sanitizeWorkshopQueryParams(rawParams || {}, allowNsfw);
    const page = parseInt(params.page, 10) || 1;
    const requestedCreator = String(params.creator || '').trim();
    const numperpage = parseInt(params.numperpage, 10) || 30;
    const directWorkshopId = normalizeWorkshopIdSearch(params.workshop_id || params.search_text || '');
    const genreOr = collectArrayLikeParams(params, 'genre_or').map(tag => tag.toLowerCase());
    const typeOr = collectArrayLikeParams(params, 'type_or').filter(tag => WORKSHOP_TYPE_TAGS.has(tag));
    const ratingOr = collectRatingOrParams(params, allowNsfw);
    const requiredTags = collectArrayLikeParams(params, 'requiredtags');
    const detailRequiredTags = detailFilterRequiredTags(requiredTags);
    const excludedRatings = collectArrayLikeParams(params, 'excludedtags').filter(tag => CONTENT_RATING_TAGS.has(tag));
    const exactPhraseEnabled = ['1', 'true', 'yes', 'on'].includes(String(params.exact_phrase || '').toLowerCase());
    const exactPhraseText = exactPhraseEnabled ? String(params.search_text || '').trim() : '';
    let fallbackReason = '';
    const hasGenreOr = genreOr.length > 1;
    const hasLocalOr = hasGenreOr || typeOr.length > 1 || ratingOr.length > 1;
    const browsefilter = String(params.browsefilter || '').trim();
    const specialFilter = String(params.special_filter || '').trim();
    const pathMode = String(params.path || '').trim().toLowerCase();
    const requiresSteamCommunitySession = !!browsefilter || !!specialFilter || pathMode === 'myfiles' || pathMode === 'votingqueue';
    const steamApiKey = getSteamApiKey();
    const steamApiAvailable = !!steamApiKey && !!useSteamApi() && !requiresSteamCommunitySession;
    const shouldUseSteamApi = steamApiAvailable;
    // The frontend marks only explicit tag filters with community_tag_filter.
    // Do not promote type/rating OR filters to Community sequence mode when
    // the user has disabled the general Community page-order setting.
    const hasOfficialCommunityTagFilter = usesOfficialCommunityTagFilter(params);
    const shouldUseCommunityBrowseOrder = !!useCommunityBrowseOrder() || requiresSteamCommunitySession || hasOfficialCommunityTagFilter;
    const shouldUseSteamCommunityCookie = shouldUseCommunityBrowseOrder || requiresSteamCommunitySession;
    if (!shouldUseSteamCommunityCookie && String(runOptions.steamCommunityCookie || '').trim()) {
      runOptions = Object.assign({}, runOptions, { steamCommunityCookie: '' });
    }
    if (requiresSteamCommunitySession && !String(runOptions.steamCommunityCookie || '').trim()) {
      const error = new Error('个人筛选需要先通过 WallHub 的 Steam 页面登录 Steam Web 会话');
      error.code = 'STEAM_WEB_LOGIN_REQUIRED';
      error.requiresSteamLogin = true;
      throw error;
    }
    const applyPostFilters = (items) => filterItemsByContentSafety(items || [], allowNsfw)
      .filter(item => itemMatchesCreator(item, requestedCreator))
      .filter(item => itemMatchesAllKnownTags(item, detailRequiredTags))
      .filter(item => typeOr.length ? itemMatchesAnyKnownTag(item, typeOr) : true)
      .filter(item => ratingOr.length ? itemMatchesAnyKnownTag(item, ratingOr) : true)
      .filter(item => excludedRatings.length ? itemExcludesAnyKnownTag(item, excludedRatings) : true)
      .filter(item => genreOr.length > 1 ? itemMatchesAnyKnownTag(item, genreOr) : true)
      .filter(item => exactPhraseText ? itemMatchesExactPhrase(item, exactPhraseText) : true);
    let steamWebApiWarning = false;

    function markSteamWebApiWarning(err) {
      const msg = String(err && err.message || err || '').toLowerCase();
      if (!msg || /abort/.test(msg)) return;
      if (msg.includes('api.steampowered.com') || msg.includes('timeout') || msg.includes('timed out') || msg.includes('steamapi') || msg.includes('filedetails')) {
        steamWebApiWarning = true;
      }
    }

    function withWarnings(response) {
      const next = steamWebApiWarning
        ? Object.assign({}, response, { warningCode: 'STEAM_WEBAPI_SLOW_OR_FAILED' })
        : Object.assign({}, response);
      if (fallbackReason && !next.source) {
        const responseBody = next.response || {};
        const total = Number(responseBody.total || 0);
        next.source = steamApiAvailable ? 'webapi-fallback' : 'community-dom-fallback';
        next.officialApproximation = 'steam-community-workshop';
        next.fallbackUsed = true;
        next.total = total;
        next.totalPages = Math.max(0, Math.ceil(total / numperpage));
        next.page = page;
        next.pageSize = numperpage;
        next.diagnostics = Object.assign({}, next.diagnostics || {}, { fallbackReason });
      }
      return next;
    }

    if (directWorkshopId) {
      const details = await getFileDetailsSafe([directWorkshopId], { safe: false, signal: runOptions.signal }).catch((err) => {
        if (isAbortError(err)) throw err;
        markSteamWebApiWarning(err);
        logger.warn('[FileDetails Error]', err.message);
        return [];
      });
      if (!details.length) steamWebApiWarning = true;
      const detail = details.find(item => item && String(item.publishedfileid) === directWorkshopId);
      const items = applyPostFilters(detail && detail.result === 1 ? [mapWorkshopItem(directWorkshopId, detail, {})] : []);
      logger.log(`[Query] Workshop ID ${directWorkshopId} returning ${items.length}`);
      return withWarnings({ response: { publishedfiledetails: items, total: items.length, total_count: items.length } });
    }

    if (shouldUseCommunityBrowseOrder) {
      try {
        return await queryCommunityPrimary(params, runOptions);
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (error && error.code === 'STEAM_WEB_LOGIN_REQUIRED') throw error;
        fallbackReason = error.code || 'COMMUNITY_PRIMARY_FAILED';
        logger.warn(`[Query] Community order path failed: ${error.message}`);
        return withWarnings({
          response: { publishedfiledetails: [], total: 0, total_count: 0, totalPages: 0 },
          source: 'community-order-unavailable',
          officialApproximation: 'steam-community-workshop',
          fallbackUsed: false,
          warningCode: 'COMMUNITY_ORDER_UNAVAILABLE',
          page,
          pageSize: numperpage,
          total: 0,
          totalPages: 0,
          diagnostics: { fallbackReason, orderSource: 'steam-community-page' },
        });
      }
    }

    const scrapeFirst = shouldScrapeFirst(params, hasLocalOr);
    const pageOffset = 0;
    const targetCount = numperpage;
    const firstScanPage = page;

    function communityAwareMaxScanPages() {
      if (!shouldUseCommunityBrowseOrder) return Math.max(page, page + 8);
      return page + 2;
    }

    if (!hasLocalOr) {
      const matched = [];
      const seen = new Set();
      let total = 0;
      let scanned = 0;
      const maxScanPages = communityAwareMaxScanPages();

      for (let scanPage = firstScanPage; scanPage <= maxScanPages && matched.length < targetCount; scanPage += 1) {
        const scanParams = scanPage === page ? params : Object.assign({}, params, { page: scanPage });
        const sourceData = shouldUseCommunityBrowseOrder
          ? Object.assign({ detailMap: {} }, await scrapeIdsWithFallback(scanParams, runOptions, { apiKey: steamApiKey, genreOr }))
          : scrapeFirst
          ? await scrapeFirstOrSteamApi(steamApiKey, scanParams, genreOr, scanPage === page ? 'simple SteamAPI' : `simple SteamAPI page ${scanPage}`, runOptions)
          : shouldUseSteamApi
            ? await queryBySteamApiOrScrape(steamApiKey, scanParams, genreOr, scanPage === page ? 'simple' : `simple page ${scanPage}`, runOptions)
            : await scrapeIdsWithFallback(scanParams, runOptions);
        const { ids, totalCount, hints, detailMap: apiDetailMap } = sourceData;
        if (sourceData.warningCode === 'STEAM_WEBAPI_SLOW_OR_FAILED') steamWebApiWarning = true;
        if (!ids.length) break;
        scanned += 1;
        if (totalCount > 0) total = totalCount;

        let details = [];
        if (!shouldUseSteamApi || !apiDetailMap || !Object.keys(apiDetailMap).length) {
          try {
            details = await getShortDetails(ids, { totalBudgetMs: scrapeFirst ? 2500 : 7000, signal: runOptions.signal });
          } catch (err) {
            if (isAbortError(err)) throw err;
            markSteamWebApiWarning(err);
            logger.warn('[FileDetails Error]', err.message);
          }
          if (ids.length && !details.length) steamWebApiWarning = true;
        } else {
          details = ids.map(id => apiDetailMap[id]).filter(Boolean);
        }

        const detailMap = detailMapFromList(details);
        const pageItems = applyPostFilters(ids
          .filter(id => validDetailForId(detailMap[id], id))
          .map(id => mapWorkshopItem(id, detailMap[id], (hints && hints[id]) || {})));
        for (const item of pageItems) {
          const id = String(item && item.publishedfileid || '');
          if (!id || seen.has(id)) continue;
          seen.add(id);
          matched.push(item);
          if (matched.length >= targetCount) break;
        }
        if ((ids || []).length < numperpage && !shouldUseCommunityBrowseOrder) break;
      }

      let items = matched.slice(pageOffset, pageOffset + numperpage);
      if (exactPhraseText && !items.length) {
        items = await findExactPhraseFallbackItems(params, exactPhraseText, applyPostFilters, numperpage, runOptions);
      }
      const resultTotal = exactPhraseText && items.length
        ? items.length
        : (total > 0
          ? accessibleWorkshopTotal(total, params)
          : (shouldUseCommunityBrowseOrder && items.length ? STEAM_WORKSHOP_ACCESSIBLE_ITEMS : 0)
            || (items.length >= numperpage || pageBeyondAccessibleWorkshopTotal(page, numperpage, params) ? STEAM_WORKSHOP_ACCESSIBLE_ITEMS : items.length));
      logger.log(`[Query] Returning ${items.length} items, total=${resultTotal}, scanned=${scanned}`);
      return withWarnings({ response: { publishedfiledetails: items, total: resultTotal, total_count: items.length } });
    }

    if (shouldUseSteamApi && !scrapeFirst && !shouldUseCommunityBrowseOrder) {
      const matched = [];
      const seen = new Set();
      let total = 50000;
      let scanned = 0;
      const maxScanPages = Math.max(page, page + 8);
      for (let scanPage = page; scanPage <= maxScanPages && matched.length < numperpage; scanPage += 1) {
        const scanParams = Object.assign({}, params, { page: scanPage });
        const apiData = Object.assign({ hints: {} }, await queryBySteamApiOrScrape(steamApiKey, scanParams, genreOr, scanPage === page ? 'genre-or' : `genre-or page ${scanPage}`, runOptions));
        if (apiData.warningCode === 'STEAM_WEBAPI_SLOW_OR_FAILED') steamWebApiWarning = true;
        if (!apiData.ids.length) break;
        scanned += 1;
        if (apiData.totalCount > 0) total = apiData.totalCount;
        let details = [];
        if (apiData.detailMap && Object.keys(apiData.detailMap).length) {
          details = apiData.ids.map(id => apiData.detailMap[id]).filter(Boolean);
        } else {
          try {
            details = await getShortDetails(apiData.ids, { totalBudgetMs: 2500, signal: runOptions.signal });
          } catch (err) {
            if (isAbortError(err)) throw err;
            markSteamWebApiWarning(err);
            logger.warn('[FileDetails Error]', err.message);
          }
          if (apiData.ids.length && !details.length) steamWebApiWarning = true;
        }
        const detailMap = detailMapFromList(details);
        for (const item of applyPostFilters(apiData.ids
          .filter(id => validDetailForId(detailMap[id], id))
          .map(id => mapWorkshopItem(id, detailMap[id], {})))) {
          const id = String(item && item.publishedfileid || '');
          if (!id || seen.has(id)) continue;
          seen.add(id);
          matched.push(item);
          if (matched.length >= numperpage) break;
        }
        if ((apiData.ids || []).length < numperpage) break;
      }
      total = accessibleWorkshopTotal(total, params);
      logger.log(`[Query] SteamAPI Genre OR(${genreOr.length}) returning ${matched.length}, total=${total}, scanned=${scanned}`);
      return withWarnings({ response: { publishedfiledetails: matched, total, total_count: matched.length } });
    }

    const firstPageParams = firstScanPage === page ? params : Object.assign({}, params, { page: firstScanPage });
    const pageData = await scrapeGenreOrIds(sourceParamsForScrape(firstPageParams), genreOr, runOptions);
    if (!pageData.ids.length) {
      return withWarnings({ response: { publishedfiledetails: [], total: pageBeyondAccessibleWorkshopTotal(page, numperpage, params) ? STEAM_WORKSHOP_ACCESSIBLE_ITEMS : 0 } });
    }

    const matched = [];
    const seen = new Set();
    let total = pageData.totalCount > 0 ? pageData.totalCount : 50000;
    let currentPageData = pageData;
    let scanned = 0;
    const maxScanPages = communityAwareMaxScanPages();
    for (let scanPage = firstScanPage; scanPage <= maxScanPages && matched.length < targetCount; scanPage += 1) {
      if (scanPage !== firstScanPage) {
        currentPageData = await scrapeGenreOrIds(sourceParamsForScrape(Object.assign({}, params, { page: scanPage })), genreOr, runOptions);
        if (!currentPageData.ids.length) break;
        if (currentPageData.totalCount > 0) total = currentPageData.totalCount;
      }
      scanned += 1;
      let details = [];
      try {
        details = await getShortDetails(currentPageData.ids, { totalBudgetMs: 2500, signal: runOptions.signal });
      } catch (err) {
        if (isAbortError(err)) throw err;
        markSteamWebApiWarning(err);
        logger.warn('[FileDetails Error]', err.message);
      }
      if (currentPageData.ids.length && !details.length) steamWebApiWarning = true;
      const detailMap = detailMapFromList(details);
      for (const id of currentPageData.ids) {
        if (seen.has(id)) continue;
        const detail = detailMap[id];
        if (!validDetailForId(detail, id)) continue;
        const hint = (currentPageData.hints && currentPageData.hints[id]) || {};
        const item = mapWorkshopItem(id, detail, hint);
        if (!itemMatchesCreator(item, requestedCreator)) continue;
        const tagSet = new Set(((detail && detail.tags) || []).map(tag => String(tag.tag || tag).toLowerCase()));
        if (genreOr.length > 1 && tagSet.size && !genreOr.some(tag => tagSet.has(tag))) continue;
        if (ratingOr.length > 1 && tagSet.size && !ratingOr.some(tag => tagSet.has(String(tag).toLowerCase()))) continue;
        if (typeOr.length && tagSet.size && !typeOr.some(tag => tagSet.has(String(tag).toLowerCase()))) continue;
        if (detailRequiredTags.length && !detailRequiredTags.every(tag => tagSet.has(String(tag).toLowerCase()))) continue;
        if (!itemAllowedByContentSafety(item, allowNsfw)) continue;
        if (exactPhraseText && !itemMatchesExactPhrase(item, exactPhraseText)) continue;
        seen.add(id);
        matched.push(item);
        if (matched.length >= targetCount) break;
      }
      if ((currentPageData.ids || []).length < numperpage && !shouldUseCommunityBrowseOrder) break;
    }
    const items = shouldUseCommunityBrowseOrder ? matched.slice(pageOffset, pageOffset + numperpage) : matched;
    total = accessibleWorkshopTotal(total, params);
    logger.log(`[Query] Genre OR(${genreOr.length}) returning ${items.length} items, total=${total}, scanned=${scanned}`);
    return withWarnings({ response: { publishedfiledetails: items, total, total_count: items.length } });
  }

  const inFlight = createInFlightCoalescer({
    label: '[Search]',
    logger,
    resultTtlMs: Number(options.resultTtlMs || 60 * 1000),
    resultCacheMaxEntries: Number(options.resultCacheMaxEntries || 60),
    execute: async (cacheKey, runOptions = {}) => {
      const result = await doSearch(runOptions.rawParams || {}, runOptions);
      if (runOptions.signal && runOptions.signal.aborted) {
        throw Object.assign(new Error('Search aborted by settings change'), { code: 'ABORT_ERR' });
      }
      const items = result && result.response && Array.isArray(result.response.publishedfiledetails)
        ? result.response.publishedfiledetails
        : [];
      if (runOptions.forceRefresh && items.length) {
        logger.log(`[Search] Force refresh completed for ${cacheKey} (result not cached)`);
      }
      return result;
    },
  });

  const prefetching = new Set();

  function scheduleNextPagePrefetch(params, searchOptions, result) {
    if (!result || result.source !== 'community-ordered' || result.fallbackUsed) return;
    const page = Math.max(1, parseInt(result.page, 10) || parseInt(params.page, 10) || 1);
    const totalPages = Math.max(0, parseInt(result.totalPages, 10) || 0);
    if (!totalPages || page >= totalPages) return;
    const nextParams = Object.assign({}, params, { page: page + 1 });
    const key = queryCacheKey(nextParams, !!nsfwEnabled());
    if (prefetching.has(key)) return;
    prefetching.add(key);
    setTimeout(() => {
      inFlight.run(key, {
        rawParams: nextParams,
        steamCommunityCookie: searchOptions.steamCommunityCookie || '',
        prefetch: true,
      }).catch((err) => {
        if (!isAbortError(err)) logger.warn('[Search] Next page prefetch failed:', err.message);
      }).finally(() => prefetching.delete(key));
    }, 0).unref?.();
  }

  async function search(rawParams = {}, searchOptions = {}) {
    const allowNsfw = !!nsfwEnabled();
    const params = sanitizeWorkshopQueryParams(rawParams || {}, allowNsfw);
    let cacheKey = queryCacheKey(params, allowNsfw);
    const requiresSteamCommunitySession = !!String(params.browsefilter || '').trim() ||
      !!String(params.special_filter || '').trim() ||
      String(params.path || '').trim().toLowerCase() === 'myfiles' ||
      String(params.path || '').trim().toLowerCase() === 'votingqueue';
    if (requiresSteamCommunitySession) {
      cacheKey = `${cacheKey}|steamCookie=${String(searchOptions.steamCommunityCookie || '').trim() ? '1' : '0'}`;
    }
    const forceRefresh = !!(rawParams && (rawParams._refresh || rawParams.refresh || rawParams.force || rawParams.nocache));
    const result = await inFlight.run(cacheKey, { forceRefresh, rawParams, steamCommunityCookie: searchOptions.steamCommunityCookie || '', signal: searchOptions.signal });
    if (!searchOptions.prefetch && !forceRefresh) scheduleNextPagePrefetch(params, searchOptions, result);
    return result;
  }

  // 设置变更等场景下强制清除所有正在进行的查询，并递增 generation
  // 旧的 in-flight promise 会被丢弃（调用方仍可能拿到旧结果，但不会再被新请求 join）
  function clearInFlight() {
    communitySequenceCache.clear();
    communityDetailCache.clear();
    inFlight.clear();
  }

  // 为了兼容旧调用，保留 clearCaches / invalidateCaches 的薄包装
  // 实际行为就是清 in-flight + bump generation
  function clearCaches() {
    communitySequenceCache.clear();
    communityDetailCache.clear();
    inFlight.clearCaches();
  }

  function invalidateCaches() {
    // invalidate 语义在这里也等同于清 in-flight（因为没有成功缓存可 invalid）
    communitySequenceCache.clear();
    communityDetailCache.clear();
    inFlight.invalidateCaches();
  }

  return {
    search,
    scrapeIds,
    queryBySteamApi,
    cachedResultFor,
    clearCaches,
    invalidateCaches,
    clearInFlight,
  };
}

module.exports = {
  createWorkshopSearchService,
  mapWorkshopItem,
  detailMapFromList,
};
