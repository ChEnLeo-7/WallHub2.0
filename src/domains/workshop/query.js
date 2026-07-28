'use strict';

const { CONTENT_RATING_TAGS, WORKSHOP_TYPE_TAGS, collectArrayLikeParams } = require('./filters');
const { parseWorkshopBrowseHtml } = require('./parse');

const COMMUNITY_SORT_MAP = { 0: 'toprated', 1: 'trend', 2: 'mostrecent', 11: 'mostvotes', 16: 'totaluniquesubscribers' };
const PERSONAL_SORT_METHODS = new Set(['subscriptiondate', 'alpha', 'lastupdated', 'creationorder']);
const DEFAULT_COMMUNITY_PAGE_TIMEOUT_MS = Math.max(8000, parseInt(process.env.WALLHUB_COMMUNITY_PAGE_TIMEOUT_MS || '22000', 10) || 22000);
const COMMUNITY_TRANSIENT_RETRIES = Math.max(0, Math.min(2, parseInt(process.env.WALLHUB_COMMUNITY_TRANSIENT_RETRIES || '1', 10) || 0));

function isSteamCommunityLoginHtml(html) {
  const text = String(html || '');
  return /(?:url=|location(?:\.href)?\s*=)[^>"']*https?:\/\/steamcommunity\.com\/login\/home/i.test(text) ||
    /<form\b[^>]*(?:id|class)=["'][^"']*(?:login_form|loginbox)[^"']*["']/i.test(text) ||
    /window\.UserConfig\s*=\s*\{[^}]*["']logged_in["']\s*:\s*false/i.test(text);
}

function normalizeCommunityTagList(values = []) {
  const out = [];
  const seen = new Set();
  for (const value of values) {
    const tag = String(value || '').trim();
    const key = tag.toLowerCase();
    if (!tag || key === 'mobile' || seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }
  return out;
}

function normalizeSteamId(value) {
  const id = String(value || '').replace(/[^\d]/g, '');
  return /^7656119\d{10}$/.test(id) ? id : '';
}

function normalizePersonalSortMethod(value) {
  const method = String(value || '').trim().toLowerCase();
  return PERSONAL_SORT_METHODS.has(method) ? method : 'lastupdated';
}

function isAbortError(error) {
  return !!(error && error.code === 'ABORT_ERR');
}

function isTransientCommunityError(error) {
  const message = String(error && error.message || error || '').toLowerCase();
  return /curl:\s*\(56\)|receiving data from the peer|econnreset|socket hang up|connection reset|connection aborted|timed out|timeout|econnrefused|enetunreach|ehostunreach/.test(message);
}

function waitForCommunityRetry(delayMs, signal) {
  return new Promise((resolve, reject) => {
    if (signal && signal.aborted) {
      reject(Object.assign(new Error('Request aborted'), { code: 'ABORT_ERR' }));
      return;
    }
    const timer = setTimeout(resolve, delayMs);
    if (signal) signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(Object.assign(new Error('Request aborted'), { code: 'ABORT_ERR' }));
    }, { once: true });
  });
}

async function getCommunityHtml(url, helpers = {}) {
  const get = helpers.get;
  const logger = helpers.logger || console;
  const headers = Object.assign({}, helpers.headers || {});
  if (helpers.signal) headers.signal = helpers.signal;
  const timeoutMs = helpers.timeoutMs || DEFAULT_COMMUNITY_PAGE_TIMEOUT_MS;
  let lastError;
  for (let attempt = 0; attempt <= COMMUNITY_TRANSIENT_RETRIES; attempt += 1) {
    try {
      const requestHeaders = attempt === 0
        ? headers
        : Object.assign({}, headers, { wallhubDisableCurlProxy: true });
      return (await get(url, requestHeaders, timeoutMs)).toString('utf8');
    } catch (error) {
      if (isAbortError(error) || !isTransientCommunityError(error) || attempt >= COMMUNITY_TRANSIENT_RETRIES) throw error;
      lastError = error;
      logger.warn(`[Community] transient browse request failure; retrying with native HTTP (${attempt + 1}/${COMMUNITY_TRANSIENT_RETRIES}): ${error.message}`);
      await waitForCommunityRetry(200 * (attempt + 1), helpers.signal);
    }
  }
  throw lastError || new Error('Steam Community browse request failed');
}

function buildCommunityWorkshopBrowseUrl(params = {}) {
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(params.pageSize || params.numperpage, 10) || 30));
  const appId = parseInt(params.appid, 10) || 431960;
  const pathMode = String(params.path || '').trim().toLowerCase();
  const requestedSort = String(params.actualsort || params.browsesort || '').trim().toLowerCase();
  const personalSort = normalizePersonalSortMethod(params.sortmethod);
  if (params.creator) {
    return `https://steamcommunity.com/profiles/${encodeURIComponent(String(params.creator))}/myworkshopfiles/?appid=${appId}&p=${page}&numperpage=${pageSize}`;
  }
  if (pathMode === 'myfiles' || requestedSort === 'mysubscriptions') {
    const search = new URLSearchParams();
    search.set('appid', String(appId));
    search.set('p', String(page));
    search.set('numperpage', String(pageSize));
    const browseFilter = String(params.browsefilter || (requestedSort === 'mysubscriptions' ? 'mysubscriptions' : '')).trim();
    if (browseFilter) search.set('browsefilter', browseFilter);
    search.set('sortmethod', personalSort);
    normalizeCommunityTagList((params.tags || []).concat(collectArrayLikeParams(params, 'requiredtags')))
      .forEach(tag => search.append('requiredtags[]', tag));
    const steamId = normalizeSteamId(params.steamid || params.profileSteamId);
    const basePath = steamId ? `/profiles/${steamId}/myworkshopfiles/` : '/my/myworkshopfiles/';
    return `https://steamcommunity.com${basePath}?${search.toString()}`;
  }
  if (pathMode === 'votingqueue') {
    const search = new URLSearchParams();
    search.set('appid', String(appId));
    search.set('p', String(page));
    search.set('numperpage', String(pageSize));
    return `https://steamcommunity.com/sharedfiles/votingqueue/?${search.toString()}`;
  }

  const sort = params.sortmethod ? personalSort : requestedSort || COMMUNITY_SORT_MAP[parseInt(params.query_type, 10)] || 'trend';
  const search = new URLSearchParams();
  search.set('appid', String(appId));
  search.set('browsesort', sort);
  search.set('section', params.section || 'readytouseitems');
  search.set('actualsort', sort);
  search.set('p', String(page));
  search.set('num_per_page', String(pageSize));
  const searchText = String(params.searchText || params.search_text || '').trim();
  if (searchText) search.set('searchtext', searchText);
  if (params.browsefilter) search.set('browsefilter', String(params.browsefilter));
  if (params.special_filter) search.set('special_filter', String(params.special_filter));
  if (params.days && sort === 'trend' && String(params.days) !== '0') search.set('days', String(params.days));

  normalizeCommunityTagList((params.tags || []).concat(collectArrayLikeParams(params, 'requiredtags')))
    .forEach(tag => search.append('requiredtags[]', tag));
  normalizeCommunityTagList((params.excludedTags || []).concat(collectArrayLikeParams(params, 'excludedtags')))
    .forEach(tag => search.append('excludedtags[]', tag));
  collectArrayLikeParams(params, 'required_appids').forEach(appid => search.append('required_appids[]', appid));
  return `https://steamcommunity.com/workshop/browse/?${search.toString()}`;
}

async function scrapeWorkshopIds(params, helpers = {}) {
  const get = helpers.get;
  const logger = helpers.logger || console;
  if (typeof get !== 'function') throw new Error('Workshop scraper GET dependency missing');
  const url = buildCommunityWorkshopBrowseUrl(params);
  logger.log(`[Scrape] ${url}`);
  const html = await getCommunityHtml(url, helpers);
  if (helpers.requireSteamLogin && isSteamCommunityLoginHtml(html)) {
    const error = new Error('Steam Community 登录会话已失效，请重新登录');
    error.code = 'STEAM_WEB_LOGIN_REQUIRED';
    error.requiresSteamLogin = true;
    throw error;
  }
  const result = parseWorkshopBrowseHtml(html);
  logger.log(`[Scrape] Found ${result.ids.length} IDs, totalCount from HTML: ${result.totalCount}`);
  if (result.foundFirstItem) {
    logger.log(`[Scrape] img tags near first item: ${result.debugImages.length}`);
    result.debugImages.forEach((tag, i) => logger.log(`  img[${i}]: ${String(tag).substring(0, 150)}`));
  } else {
    logger.log('[Scrape] 鈿狅笍 No publishedfileid found! HTML length:', result.htmlLength);
  }
  return { ids: result.ids, totalCount: result.totalCount, hints: result.hints };
}

function mapLocalQueryTypeToSteamApi(localType) {
  const n = parseInt(localType, 10);
  if (n === 0) return 0;
  if (n === 11) return 11;
  if (n === 1) return 3;
  if (n === 2) return 1;
  if (n === 16) return 9;
  return 3;
}

function buildSteamApiQueryFields(params = {}, singleGenreTag, singleResolutionTag) {
  const requiredTags = [];
  const excludedTags = [];
  let typeTag = '';
  let ratingTag = '';

  for (const [key, value] of Object.entries(params || {})) {
    if (/^excludedtags/.test(key) && value) {
      const tag = String(value).trim();
      if (tag) excludedTags.push(tag);
      continue;
    }
    if (!/^requiredtags/.test(key) || !value) continue;
    const tag = String(value).trim();
    if (!tag) continue;
    if (tag.toLowerCase() === 'mobile') continue;
    if (WORKSHOP_TYPE_TAGS.has(tag)) {
      typeTag = tag;
      continue;
    }
    if (CONTENT_RATING_TAGS.has(tag)) {
      ratingTag = tag;
      continue;
    }
    requiredTags.push(tag);
  }

  if (typeTag) requiredTags.push(typeTag);
  if (ratingTag) requiredTags.push(ratingTag);
  if (singleGenreTag) requiredTags.push(String(singleGenreTag).trim());
  if (singleResolutionTag) requiredTags.push(String(singleResolutionTag).trim());

  return {
    query_type: mapLocalQueryTypeToSteamApi(params.query_type),
    page: Math.max(1, parseInt(params.page, 10) || 1),
    numperpage: Math.max(1, Math.min(100, parseInt(params.numperpage, 10) || 30)),
    appid: parseInt(params.appid, 10) || 431960,
    search_text: String(params.search_text || '').trim(),
    days: parseInt(params.days, 10) || 0,
    requiredTags: Array.from(new Set(requiredTags)),
    excludedTags: Array.from(new Set(excludedTags)),
  };
}

function normalizeSteamApiTrendDays(days) {
  const parsed = parseInt(days, 10) || 0;
  if (parsed <= 0) return 0;
  return Math.max(1, Math.min(365, parsed));
}

function buildSteamApiQueryInput(params = {}, singleGenreTag, singleResolutionTag) {
  const q = buildSteamApiQueryFields(params, singleGenreTag, singleResolutionTag);
  const input = {
    query_type: q.search_text ? 12 : q.query_type,
    page: q.page,
    numperpage: q.numperpage,
    creator_appid: q.appid,
    appid: q.appid,
    filetype: 0,
    match_all_tags: true,
    requiredtags: q.requiredTags,
    excludedtags: q.excludedTags,
    return_tags: true,
    return_previews: true,
    return_short_description: true,
    return_metadata: true,
    return_vote_data: true,
  };
  if (q.search_text) input.search_text = q.search_text;
  if (input.query_type === 3) {
    const days = normalizeSteamApiTrendDays(q.days);
    if (days > 0) {
      input.days = days;
      input.include_recent_votes_only = true;
    }
  }
  return input;
}

function appendBooleanParam(search, name, value) {
  search.set(name, value ? '1' : '0');
}

function normalizeSteamWebApiBaseUrl(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) return 'https://api.steampowered.com';
  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return 'https://api.steampowered.com';
    return `${parsed.protocol}//${parsed.host}`;
  } catch {
    return 'https://api.steampowered.com';
  }
}

function buildSteamApiQueryUrl(apiKey, params = {}, singleGenreTag, singleResolutionTag, baseUrl) {
  const input = buildSteamApiQueryInput(params, singleGenreTag, singleResolutionTag);
  const search = new URLSearchParams();
  search.set('key', apiKey);
  search.set('format', 'json');
  search.set('query_type', String(input.query_type));
  search.set('page', String(input.page));
  search.set('numperpage', String(input.numperpage));
  search.set('creator_appid', String(input.creator_appid));
  search.set('appid', String(input.appid));
  search.set('filetype', String(input.filetype));
  appendBooleanParam(search, 'match_all_tags', input.match_all_tags);
  appendBooleanParam(search, 'return_tags', input.return_tags);
  appendBooleanParam(search, 'return_previews', input.return_previews);
  appendBooleanParam(search, 'return_short_description', input.return_short_description);
  appendBooleanParam(search, 'return_metadata', input.return_metadata);
  appendBooleanParam(search, 'return_vote_data', input.return_vote_data);
  if (input.search_text) search.set('search_text', input.search_text);
  if (input.days > 0) search.set('days', String(input.days));
  if (input.include_recent_votes_only) appendBooleanParam(search, 'include_recent_votes_only', true);
  input.requiredtags.forEach((tag, index) => search.set(`requiredtags[${index}]`, tag));
  input.excludedtags.forEach((tag, index) => search.set(`excludedtags[${index}]`, tag));
  return `${normalizeSteamWebApiBaseUrl(baseUrl)}/IPublishedFileService/QueryFiles/v1/?${search.toString()}`;
}

function steamApiServiceUrl(interfaceName, methodName, apiKey, input, baseUrl) {
  const search = new URLSearchParams();
  if (apiKey) search.set('key', apiKey);
  search.set('format', 'json');
  search.set('input_json', JSON.stringify(input || {}));
  return `${normalizeSteamWebApiBaseUrl(baseUrl)}/${interfaceName}/${methodName}/v1/?${search.toString()}`;
}

function steamApiHeaders(apiKey, extra = {}) {
  return Object.assign({
    Accept: 'application/json',
    'x-webapi-key': apiKey,
  }, extra || {});
}

async function queryWorkshopBySteamApi(apiKey, params = {}, genreOr = [], helpers = {}) {
  const get = helpers.get;
  const logger = helpers.logger || console;
  const baseUrl = typeof helpers.getSteamWebApiBaseUrl === 'function' ? helpers.getSteamWebApiBaseUrl() : helpers.steamWebApiBaseUrl;
  if (typeof get !== 'function') throw new Error('Workshop Steam API GET dependency missing');

  if (params.creator) {
    const input = {
      steamid: String(params.creator),
      appid: parseInt(params.appid, 10) || 431960,
      page: Math.max(1, parseInt(params.page, 10) || 1),
      numperpage: Math.max(1, Math.min(100, parseInt(params.numperpage, 10) || 30)),
      return_details: true,
      return_tags: true,
      return_previews: true,
      return_short_description: true,
      return_metadata: true,
    };
    const raw = await get(
      steamApiServiceUrl('IPublishedFileService', 'GetUserFiles', apiKey, input, baseUrl),
      steamApiHeaders(apiKey, helpers.signal ? { signal: helpers.signal } : {}),
      Number(helpers.timeoutMs || 22000)
    );
    const response = JSON.parse(raw.toString('utf8')).response || {};
    const details = Array.isArray(response.publishedfiledetails) ? response.publishedfiledetails : [];
    const detailMap = {};
    details.forEach((detail) => {
      if (detail && detail.result === 1) detailMap[String(detail.publishedfileid)] = detail;
    });
    return {
      ids: details.map(detail => String(detail && detail.publishedfileid || '')).filter(Boolean),
      totalCount: parseInt(response.total, 10) || 0,
      detailMap,
    };
  }

  const genres = Array.from(new Set((genreOr || []).map(value => String(value || '').trim()).filter(Boolean)));
  const variants = genres.length > 1 && genres.length <= 48
    ? genres.map(genre => ({ genre, resolution: '' }))
    : [{ genre: genres.length === 1 ? genres[0] : '', resolution: '' }];
  if (genres.length > 48) logger.log(`[Query] SteamAPI genre OR(${genres.length}) uses broad query + local filtering`);
  const results = await Promise.all(variants.map(async ({ genre, resolution }) => {
    const raw = await get(
      buildSteamApiQueryUrl(apiKey, params, genre, resolution, baseUrl),
      steamApiHeaders(apiKey, helpers.signal ? { signal: helpers.signal } : {}),
      Number(helpers.timeoutMs || 22000)
    );
    const response = JSON.parse(raw.toString('utf8')).response || {};
    const details = Array.isArray(response.publishedfiledetails) ? response.publishedfiledetails : [];
    const ids = Array.isArray(response.publishedfileids) && response.publishedfileids.length
      ? response.publishedfileids.map(value => String(value))
      : details.map(detail => String(detail && detail.publishedfileid || '')).filter(Boolean);
    const detailMap = {};
    details.forEach((detail) => {
      if (detail && detail.result === 1 && detail.publishedfileid) detailMap[String(detail.publishedfileid)] = detail;
    });
    return { ids, totalCount: parseInt(response.total, 10) || 0, detailMap };
  }));

  const ids = [];
  const detailMap = {};
  const seen = new Set();
  let totalCount = 0;
  for (const result of results) {
    totalCount += result.totalCount;
    Object.assign(detailMap, result.detailMap);
    for (const id of result.ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      ids.push(id);
    }
  }
  return { ids, totalCount, detailMap };
}

module.exports = {
  buildCommunityWorkshopBrowseUrl,
  scrapeWorkshopIds,
  mapLocalQueryTypeToSteamApi,
  buildSteamApiQueryFields,
  buildSteamApiQueryInput,
  buildSteamApiQueryUrl,
  normalizeSteamWebApiBaseUrl,
  steamApiServiceUrl,
  queryWorkshopBySteamApi,
  normalizeSteamId,
  normalizePersonalSortMethod,
};
