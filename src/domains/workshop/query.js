'use strict';

const { CONTENT_RATING_TAGS, WORKSHOP_TYPE_TAGS, collectArrayLikeParams } = require('./filters');
const { parseWorkshopBrowseHtml, parseWorkshopBrowseSsr } = require('./parse');

const COMMUNITY_SORT_MAP = { 0: 'toprated', 1: 'trend', 2: 'mostrecent', 11: 'mostvotes', 16: 'totaluniquesubscribers' };
const DEFAULT_COMMUNITY_PAGE_TIMEOUT_MS = Math.max(8000, parseInt(process.env.WALLHUB_COMMUNITY_PAGE_TIMEOUT_MS || '22000', 10) || 22000);

function isSteamCommunityLoginHtml(html) {
  const text = String(html || '');
  return /(?:url=|location(?:\.href)?\s*=)[^>"']*https?:\/\/steamcommunity\.com\/login\/home/i.test(text) ||
    /<form\b[^>]*(?:id|class)=["'][^"']*(?:login_form|loginbox)[^"']*["']/i.test(text);
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

function buildCommunityWorkshopBrowseUrl(params = {}) {
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const pageSize = Math.max(1, Math.min(100, parseInt(params.pageSize || params.numperpage, 10) || 30));
  const appId = parseInt(params.appid, 10) || 431960;
  const pathMode = String(params.path || '').trim().toLowerCase();
  if (params.creator) {
    return `https://steamcommunity.com/profiles/${encodeURIComponent(String(params.creator))}/myworkshopfiles/?appid=${appId}&p=${page}&numperpage=${pageSize}`;
  }
  if (pathMode === 'myfiles') {
    const search = new URLSearchParams();
    search.set('appid', String(appId));
    search.set('p', String(page));
    search.set('numperpage', String(pageSize));
    if (params.browsefilter) search.set('browsefilter', String(params.browsefilter));
    return `https://steamcommunity.com/my/myworkshopfiles/?${search.toString()}`;
  }
  if (pathMode === 'votingqueue') {
    const search = new URLSearchParams();
    search.set('appid', String(appId));
    search.set('p', String(page));
    search.set('numperpage', String(pageSize));
    return `https://steamcommunity.com/sharedfiles/votingqueue/?${search.toString()}`;
  }

  const requestedSort = String(params.actualsort || params.browsesort || '').trim();
  const sort = requestedSort || COMMUNITY_SORT_MAP[parseInt(params.query_type, 10)] || 'trend';
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

function buildWorkshopBrowseUrl(params = {}) {
  const page = parseInt(params.page, 10) || 1;
  const appId = params.appid || 431960;
  if (params.creator) {
    return `https://steamcommunity.com/profiles/${params.creator}/myworkshopfiles/?appid=${appId}&p=${page}&numperpage=${params.numperpage || 30}`;
  }

  const sort = COMMUNITY_SORT_MAP[parseInt(params.query_type, 10)] || 'trend';
  const qs = [
    `appid=${appId}`,
    `browsesort=${sort}`,
    'section=readytouseitems',
    `actualsort=${sort}`,
    `p=${page}`,
    `num_per_page=${params.numperpage || 30}`,
  ];
  if (params.search_text) qs.push(`searchtext=${encodeURIComponent(params.search_text)}`);
  if (params.browsefilter) qs.push(`browsefilter=${encodeURIComponent(String(params.browsefilter))}`);
  if (params.special_filter) qs.push(`special_filter=${encodeURIComponent(String(params.special_filter))}`);
  if (params.days && sort === 'trend' && String(params.days) !== '0') qs.push(`days=${params.days}`);

  const tags = [];
  const excludedTags = [];
  const requiredAppIds = [];
  for (const [key, value] of Object.entries(params || {})) {
    if (/^requiredtags/.test(key) && value) tags.push(String(value));
    if (/^excludedtags/.test(key) && value) excludedTags.push(String(value));
    if (/^required_appids/.test(key) && value) requiredAppIds.push(String(value));
  }
  normalizeCommunityTagList(tags).forEach(tag => qs.push(`requiredtags[]=${encodeURIComponent(tag)}`));
  excludedTags.forEach(tag => qs.push(`excludedtags[]=${encodeURIComponent(tag)}`));
  requiredAppIds.forEach(appid => qs.push(`required_appids[]=${encodeURIComponent(appid)}`));
  return `https://steamcommunity.com/workshop/browse/?${qs.join('&')}`;
}

async function fetchWorkshopBrowsePage(params, helpers = {}) {
  const get = helpers.get;
  const logger = helpers.logger || console;
  if (typeof get !== 'function') throw new Error('Workshop browse GET dependency missing');
  const url = buildCommunityWorkshopBrowseUrl(params);
  logger.log(`[Community] ${url}`);
  const headers = Object.assign({}, helpers.headers || {});
  if (helpers.signal) headers.signal = helpers.signal;
  const startedAt = Date.now();
  const html = (await get(url, headers, helpers.timeoutMs || DEFAULT_COMMUNITY_PAGE_TIMEOUT_MS)).toString('utf8');
  if (helpers.requireSteamLogin && isSteamCommunityLoginHtml(html)) {
    const error = new Error('Steam Community 登录会话已失效，请重新登录');
    error.code = 'STEAM_WEB_LOGIN_REQUIRED';
    error.requiresSteamLogin = true;
    throw error;
  }
  const requestMs = Date.now() - startedAt;
  const parseStartedAt = Date.now();
  const ssr = parseWorkshopBrowseSsr(html);
  const parseMs = Date.now() - parseStartedAt;
  return { url, html, ssr, requestMs, parseMs };
}

async function scrapeWorkshopIds(params, helpers = {}) {
  const get = helpers.get;
  const logger = helpers.logger || console;
  if (typeof get !== 'function') throw new Error('Workshop scraper GET dependency missing');
  const url = buildWorkshopBrowseUrl(params);
  logger.log(`[Scrape] ${url}`);
  const headers = Object.assign({}, helpers.headers || {});
  if (helpers.signal) headers.signal = helpers.signal;
  const html = (await get(url, headers)).toString('utf8');
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
  input.requiredtags.forEach((tag, i) => search.set(`requiredtags[${i}]`, tag));
  input.excludedtags.forEach((tag, i) => search.set(`excludedtags[${i}]`, tag));
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
    const url = steamApiServiceUrl('IPublishedFileService', 'GetUserFiles', apiKey, input, baseUrl);
    const timeoutMs = Number(helpers.timeoutMs || 22000);
    const raw = await get(url, steamApiHeaders(apiKey, helpers.signal ? { signal: helpers.signal } : {}), timeoutMs);
    const data = JSON.parse(raw.toString('utf8'));
    const resp = data.response || {};
    const details = Array.isArray(resp.publishedfiledetails) ? resp.publishedfiledetails : [];
    const ids = details.map(detail => String(detail.publishedfileid)).filter(Boolean);
    const detailMap = {};
    details.forEach(detail => {
      if (detail.result === 1) detailMap[detail.publishedfileid] = detail;
    });
    return { ids, totalCount: parseInt(resp.total, 10) || 0, detailMap };
  }

  const genreList = Array.from(new Set((genreOr || []).map(value => String(value || '').trim()).filter(Boolean)));
  const fanoutLimit = 48;
  const effectiveGenres = genreList.length > 1 ? genreList : [genreList.length === 1 ? genreList[0] : ''];
  const variants = [];
  for (const genre of effectiveGenres) {
    variants.push({ genre, resolution: '' });
  }
  const shouldFanout = variants.length > 1 && variants.length <= fanoutLimit;
  const effectiveVariants = shouldFanout ? variants : [{ genre: genreList.length === 1 ? genreList[0] : '', resolution: '' }];
  if (variants.length > fanoutLimit) {
    logger.log(`[Query] SteamAPI genre OR(${variants.length}) uses broad query + local filtering`);
  }

  const requestOne = async ({ genre, resolution }) => {
    const url = buildSteamApiQueryUrl(apiKey, params, genre, resolution, baseUrl);
    const timeoutMs = Number(helpers.timeoutMs || 22000);
    const raw = await get(url, steamApiHeaders(apiKey, helpers.signal ? { signal: helpers.signal } : {}), timeoutMs);
    const data = JSON.parse(raw.toString('utf8'));
    const resp = data && data.response ? data.response : {};
    const details = Array.isArray(resp.publishedfiledetails) ? resp.publishedfiledetails : [];
    const ids = Array.isArray(resp.publishedfileids) && resp.publishedfileids.length
      ? resp.publishedfileids.map(value => String(value))
      : details.map(detail => String(detail && detail.publishedfileid || '')).filter(Boolean);
    const detailMap = {};
    details.forEach(detail => {
      if (!detail || !detail.publishedfileid || detail.result !== 1) return;
      detailMap[String(detail.publishedfileid)] = detail;
    });
    return { ids, totalCount: parseInt(resp.total || 0, 10) || 0, detailMap };
  };

  const results = await Promise.all(effectiveVariants.map(requestOne));
  const mergedIds = [];
  const seen = new Set();
  const mergedDetailMap = {};
  let total = 0;
  for (const result of results) {
    total += result.totalCount;
    Object.assign(mergedDetailMap, result.detailMap || {});
    for (const id of result.ids || []) {
      if (seen.has(id)) continue;
      seen.add(id);
      mergedIds.push(id);
    }
  }

  return { ids: mergedIds, totalCount: total, detailMap: mergedDetailMap };
}

module.exports = {
  buildCommunityWorkshopBrowseUrl,
  buildWorkshopBrowseUrl,
  fetchWorkshopBrowsePage,
  scrapeWorkshopIds,
  mapLocalQueryTypeToSteamApi,
  buildSteamApiQueryFields,
  buildSteamApiQueryInput,
  buildSteamApiQueryUrl,
  normalizeSteamWebApiBaseUrl,
  steamApiServiceUrl,
  queryWorkshopBySteamApi,
};
