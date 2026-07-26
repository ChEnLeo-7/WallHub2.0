'use strict';

const crypto = require('node:crypto');

const {
  CONTENT_RATING_TAGS,
  WORKSHOP_TYPE_TAGS,
  collectArrayLikeParams,
  collectRatingOrParams,
  filterItemsByContentSafety,
  itemMatchesAnyTag,
  itemMatchesExactPhrase,
  normalizeWorkshopIdSearch,
  sanitizeWorkshopQueryParams,
} = require('./filters');
const { cleanText } = require('./text');
const {
  scrapeWorkshopIds,
  queryWorkshopBySteamApi,
  normalizeSteamId,
} = require('./query');
const { createInFlightCoalescer } = require('../../shared/inFlight');
const {
  detailMapFromList,
  validDetailForId,
  mapWorkshopItem,
} = require('./search/itemMapping');

const STEAM_WORKSHOP_ACCESSIBLE_ITEMS = 50000;
const AUTHOR_SOURCE_PAGE_SIZE = 30;
const WORKSHOP_TYPE_TAG_KEYS = new Set(Array.from(WORKSHOP_TYPE_TAGS).map(tag => String(tag).toLowerCase()));

function usesOfficialCommunityTagFilter(params = {}) {
  return ['1', 'true', 'yes', 'on'].includes(String(params.community_tag_filter || '').toLowerCase());
}

function accessibleWorkshopTotal(total, params = {}) {
  const value = Math.max(0, parseInt(total, 10) || 0);
  if (!value || params.creator || usesOfficialCommunityTagFilter(params)) return value;
  return Math.min(value, STEAM_WORKSHOP_ACCESSIBLE_ITEMS);
}

function requiresSteamCommunitySession(params = {}) {
  const pathMode = String(params.path || '').trim().toLowerCase();
  const requestedSort = String(params.actualsort || params.browsesort || '').trim().toLowerCase();
  return !!String(params.browsefilter || '').trim() ||
    !!String(params.special_filter || '').trim() ||
    pathMode === 'myfiles' ||
    pathMode === 'votingqueue' ||
    requestedSort === 'mysubscriptions';
}

function steamKitPersonalListType(params = {}) {
  const browseFilter = String(params.browsefilter || '').trim().toLowerCase();
  if (browseFilter === 'mysubscriptions' || browseFilter === 'myfavorites') return browseFilter;
  return '';
}

function steamIdFromCommunityCookie(cookieHeader) {
  for (const part of String(cookieHeader || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim().toLowerCase() !== 'steamloginsecure') continue;
    const raw = part.slice(separator + 1).trim();
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch {}
    const steamId = normalizeSteamId(String(decoded).split('||')[0]);
    if (steamId) return steamId;
  }
  return '';
}

function steamAccountCacheKey(cookieHeader) {
  const cookie = String(cookieHeader || '').trim();
  if (!cookie) return 'anonymous';
  const steamId = steamIdFromCommunityCookie(cookie);
  if (steamId) return steamId;
  return `cookie-${crypto.createHash('sha256').update(cookie).digest('hex').slice(0, 16)}`;
}

function steamAccountCacheKeyForRun(runOptions = {}) {
  const explicit = String(runOptions.steamAccountKey || '').trim();
  return explicit || steamAccountCacheKey(runOptions.steamCommunityCookie);
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
  const getSteamWebApiBaseUrl = options.getSteamWebApiBaseUrl || (() => 'https://api.steampowered.com');
  const nsfwEnabled = options.nsfwEnabled || (() => false);
  const logger = options.logger || console;
  const querySteamKitUserFiles = typeof options.querySteamKitUserFiles === 'function' ? options.querySteamKitUserFiles : null;

  // Workshop queries retain a small, short-lived LRU cache. This avoids
  // duplicate page loads while keeping normal browsing results fresh.
  // - _refresh always bypasses and does not write the result cache.
  // - network-setting changes clear both in-flight work and cached results.
  // - 影响网络的设置变更（DoH、SteamAccessEnhance 等）时，
  //   调用 clearInFlight() 清除当前 in-flight 并 bump generation，强制下次查询重新开始

  function queryCacheKey(params, allowNsfw) {
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
    return scrapeWorkshopIds(params, {
      get,
      logger,
      signal: runOptions.signal,
      headers: steamCommunityHeaders(runOptions),
      requireSteamLogin: requiresSteamCommunitySession(params),
    });
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
    return queryWorkshopBySteamApi(apiKey, params, genreOr, {
      get,
      logger,
      signal: runOptions.signal,
      timeoutMs: runOptions.timeoutMs,
      getSteamWebApiBaseUrl,
    });
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

  function isAbortError(error) {
    return !!(error && error.code === 'ABORT_ERR');
  }

  async function queryBySteamApiOrCommunity(apiKey, params, genreOr, label, runOptions = {}) {
    if (!apiKey) {
      logger.log(`[Query] Steam Web API key unavailable; using Community browse for ${label || 'query'}`);
      return Object.assign({ detailMap: {}, hints: {} }, await scrapeGenreOrIds(sourceParamsForScrape(params), genreOr, runOptions));
    }
    try {
      return Object.assign({ hints: {} }, await queryBySteamApi(apiKey, params, genreOr, runOptions));
    } catch (error) {
      if (isAbortError(error)) throw error;
      logger.warn(`[Query] SteamAPI ${label || 'query'} failed, fallback to workshop scrape: ${error.message}`);
      return Object.assign(
        { detailMap: {}, hints: {}, warningCode: 'STEAM_WEBAPI_SLOW_OR_FAILED', fallbackReason: 'STEAM_WEBAPI_FAILED' },
        await scrapeGenreOrIds(sourceParamsForScrape(params), genreOr, runOptions)
      );
    }
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
    const accountSessionRequired = requiresSteamCommunitySession(params);
    const steamKitPersonalType = steamKitPersonalListType(params);
    const useSteamKitUserFiles = !!steamKitPersonalType && !!querySteamKitUserFiles &&
      !!runOptions.steamKitQueryAvailable && !runOptions.skipSteamKitUserFiles;
    const steamApiKey = String(getSteamApiKey() || '').trim();
    const communitySessionRequired = accountSessionRequired && !useSteamKitUserFiles;
    const querySteamApiKey = accountSessionRequired ? '' : steamApiKey;
    const shouldUseSteamCommunityCookie = communitySessionRequired;
    if (!shouldUseSteamCommunityCookie && String(runOptions.steamCommunityCookie || '').trim()) {
      runOptions = Object.assign({}, runOptions, { steamCommunityCookie: '' });
    }
    if (communitySessionRequired && !String(runOptions.steamCommunityCookie || '').trim()) {
      const error = new Error('个人筛选需要先通过 WallHub 的 Steam 页面登录 Steam Web 会话');
      error.code = 'STEAM_WEB_LOGIN_REQUIRED';
      error.requiresSteamLogin = true;
      throw error;
    }
    if (communitySessionRequired) {
      const steamId = steamIdFromCommunityCookie(runOptions.steamCommunityCookie);
      if (steamId) params.profileSteamId = steamId;
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
        next.source = steamApiKey ? 'webapi-fallback' : 'community-dom-fallback';
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

    if (requestedCreator) {
      // The profile Workshop page is authoritative for author totals.
      // Steam's profile page returns too few items for unsupported page sizes,
      // so use its stable 30-item source page and apply WallHub pagination.
      const startIndex = (page - 1) * numperpage;
      const sourceOffset = startIndex % AUTHOR_SOURCE_PAGE_SIZE;
      const endIndex = sourceOffset + numperpage;
      const sourceParams = sourceParamsForScrape(params);
      const matched = [];
      const seen = new Set();
      let total = 0;
      let sourcePage = Math.floor(startIndex / AUTHOR_SOURCE_PAGE_SIZE) + 1;
      let sourcePageLimit = Infinity;

      while (sourcePage <= sourcePageLimit && matched.length < endIndex) {
        const sourceData = await scrapeGenreOrIds(Object.assign({}, sourceParams, {
          page: sourcePage,
          numperpage: AUTHOR_SOURCE_PAGE_SIZE,
        }), genreOr, runOptions);
        const ids = sourceData.ids || [];
        if (sourceData.totalCount > 0) {
          total = sourceData.totalCount;
          sourcePageLimit = Math.ceil(total / AUTHOR_SOURCE_PAGE_SIZE);
        }
        if (!ids.length) break;

        let details = [];
        try {
          details = await getShortDetails(ids, { totalBudgetMs: 7000, signal: runOptions.signal });
        } catch (error) {
          if (isAbortError(error)) throw error;
          markSteamWebApiWarning(error);
          logger.warn('[Author Search] detail enrichment failed:', error.message);
        }
        if (!details.length) steamWebApiWarning = true;
        const detailMap = detailMapFromList(details);
        for (const item of applyPostFilters(ids
          .filter(id => validDetailForId(detailMap[id], id))
          .map(id => mapWorkshopItem(id, detailMap[id], (sourceData.hints && sourceData.hints[id]) || {})))) {
          const id = String(item.publishedfileid || '');
          if (!id || seen.has(id)) continue;
          seen.add(id);
          matched.push(item);
        }
        if (ids.length < AUTHOR_SOURCE_PAGE_SIZE) break;
        sourcePage += 1;
      }

      const items = matched.slice(sourceOffset, endIndex);
      total = Math.max(items.length, total || matched.length);
      logger.log(`[Author Search] Community profile returned ${items.length}/${total}`);
      return withWarnings({
        response: { publishedfiledetails: items, total, total_count: items.length },
        source: 'community-author',
        page,
        pageSize: numperpage,
        total,
        totalPages: total ? Math.ceil(total / numperpage) : 0,
      });
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

    if (useSteamKitUserFiles) {
      const sourceData = await querySteamKitUserFiles(steamKitPersonalType, {
        appId: parseInt(params.appid, 10) || 431960,
        page,
        numperpage,
        signal: runOptions.signal,
      });
      const ids = Array.isArray(sourceData && sourceData.ids) ? sourceData.ids.map(id => String(id || '')).filter(Boolean) : [];
      const steamKitDetails = Array.isArray(sourceData && sourceData.details) ? sourceData.details : [];
      const useSteamKitDetails = steamKitDetails.length > 0;
      let details = steamKitDetails;
      if (!useSteamKitDetails) {
        try {
          details = await getShortDetails(ids, { totalBudgetMs: 7000, signal: runOptions.signal });
        } catch (error) {
          if (isAbortError(error)) throw error;
          markSteamWebApiWarning(error);
          logger.warn('[SteamKit UserFiles] detail enrichment failed:', error.message);
        }
      }
      const detailMap = detailMapFromList(details);
      const items = applyPostFilters(ids
        .filter(id => validDetailForId(detailMap[id], id))
        .map(id => mapWorkshopItem(id, detailMap[id], {})));
      const total = Math.max(items.length, parseInt(sourceData && sourceData.totalCount, 10) || 0);
      logger.log(`[SteamKit UserFiles] ${steamKitPersonalType} page ${page} returned ${items.length}/${total}`);
      return withWarnings({
        response: { publishedfiledetails: items, total, total_count: total },
        source: 'steamkit-user-files',
        page,
        pageSize: numperpage,
        total,
        totalPages: total ? Math.ceil(total / numperpage) : 0,
        diagnostics: { listType: steamKitPersonalType, detailMode: useSteamKitDetails ? 'steamkit' : 'blocking-for-preview' },
      });
    }

    const targetCount = numperpage;
    const firstScanPage = page;

    if (!hasLocalOr) {
      const matched = [];
      const seen = new Set();
      let total = 0;
      let scanned = 0;
      const maxScanPages = Math.max(page, page + 8);

      for (let scanPage = firstScanPage; scanPage <= maxScanPages && matched.length < targetCount; scanPage += 1) {
        const scanParams = scanPage === page ? params : Object.assign({}, params, { page: scanPage });
        const sourceData = await queryBySteamApiOrCommunity(querySteamApiKey, scanParams, genreOr, scanPage === page ? 'simple' : 'simple page ' + scanPage, runOptions);
        const { ids, totalCount, hints, detailMap: apiDetailMap } = sourceData;
        if (sourceData.warningCode === 'STEAM_WEBAPI_SLOW_OR_FAILED') {
          steamWebApiWarning = true;
          fallbackReason = sourceData.fallbackReason || 'STEAM_WEBAPI_FAILED';
        }
        if (!ids.length) break;
        scanned += 1;
        if (totalCount > 0) total = totalCount;

        let details = [];
        if (!apiDetailMap || !Object.keys(apiDetailMap).length) {
          try {
            details = await getShortDetails(ids, { totalBudgetMs: 7000, signal: runOptions.signal });
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
        if ((ids || []).length < numperpage) break;
      }

      let items = matched;
      if (exactPhraseText && !items.length && !steamApiKey) {
        items = await findExactPhraseFallbackItems(params, exactPhraseText, applyPostFilters, numperpage, runOptions);
      }
      const resultTotal = exactPhraseText && items.length
        ? items.length
        : (total > 0
          ? accessibleWorkshopTotal(total, params)
          : (items.length >= numperpage || pageBeyondAccessibleWorkshopTotal(page, numperpage, params) ? STEAM_WORKSHOP_ACCESSIBLE_ITEMS : items.length));
      logger.log(`[Query] Returning ${items.length} items, total=${resultTotal}, scanned=${scanned}`);
      return withWarnings({ response: { publishedfiledetails: items, total: resultTotal, total_count: items.length } });
    }

    {
      const matched = [];
      const seen = new Set();
      let total = 50000;
      let scanned = 0;
      const maxScanPages = Math.max(page, page + 8);
      for (let scanPage = page; scanPage <= maxScanPages && matched.length < numperpage; scanPage += 1) {
        const scanParams = Object.assign({}, params, { page: scanPage });
        const apiData = Object.assign(
          { hints: {} },
          await queryBySteamApiOrCommunity(querySteamApiKey, scanParams, genreOr, scanPage === page ? 'genre-or' : `genre-or page ${scanPage}`, runOptions)
        );
        if (apiData.warningCode === 'STEAM_WEBAPI_SLOW_OR_FAILED') {
          steamWebApiWarning = true;
          fallbackReason = apiData.fallbackReason || 'STEAM_WEBAPI_FAILED';
        }
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
      logger.log(`[Query] ${steamApiKey ? 'SteamAPI' : 'Community'} genre OR(${genreOr.length}) returning ${matched.length}, total=${total}, scanned=${scanned}`);
      return withWarnings({ response: { publishedfiledetails: matched, total, total_count: matched.length } });
    }
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

  async function search(rawParams = {}, searchOptions = {}) {
    const allowNsfw = !!nsfwEnabled();
    const params = sanitizeWorkshopQueryParams(rawParams || {}, allowNsfw);
    let cacheKey = queryCacheKey(params, allowNsfw);
    const accountSessionRequired = requiresSteamCommunitySession(params);
    if (accountSessionRequired) {
      cacheKey = `${cacheKey}|steamAccount=${steamAccountCacheKeyForRun(searchOptions)}`;
    }
    const forceRefresh = !!(rawParams && (rawParams._refresh || rawParams.refresh || rawParams.force || rawParams.nocache));
    const result = await inFlight.run(cacheKey, {
      forceRefresh,
      rawParams,
      steamCommunityCookie: searchOptions.steamCommunityCookie || '',
      steamAccountKey: searchOptions.steamAccountKey || '',
      skipSteamKitUserFiles: !!searchOptions.skipSteamKitUserFiles,
      steamKitQueryAvailable: !!searchOptions.steamKitQueryAvailable,
      signal: searchOptions.signal,
    });
    return result;
  }

  // 设置变更等场景下强制清除所有正在进行的查询，并递增 generation
  // 旧的 in-flight promise 会被丢弃（调用方仍可能拿到旧结果，但不会再被新请求 join）
  function clearInFlight() {
    inFlight.clear();
  }

  // 为了兼容旧调用，保留 clearCaches / invalidateCaches 的薄包装
  // 实际行为就是清 in-flight + bump generation
  function clearCaches() {
    inFlight.clearCaches();
  }

  function invalidateCaches() {
    // invalidate 语义在这里也等同于清 in-flight（因为没有成功缓存可 invalid）
    inFlight.invalidateCaches();
  }

  return {
    search,
    scrapeIds,
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
  requiresSteamCommunitySession,
  steamKitPersonalListType,
  steamIdFromCommunityCookie,
  steamAccountCacheKey,
  steamAccountCacheKeyForRun,
};
