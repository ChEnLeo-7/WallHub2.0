'use strict';

const { collectArrayLikeParams } = require('../filters');
const { buildSteamCmQueryInput, queryWorkshopBySteamApi, scrapeWorkshopIds } = require('../query');
const { sourceParamsForScrape } = require('./sourceSelection');

const GENRE_FANOUT_LIMIT = 3;

function isAbortError(error) {
  return !!(error && error.code === 'ABORT_ERR');
}

function createWorkshopQuerySources(options = {}) {
  const get = options.get;
  const getFileDetailsSafe = options.getFileDetailsSafe;
  const getSteamWebApiBaseUrl = options.getSteamWebApiBaseUrl;
  const logger = options.logger || console;
  const querySteamKitWorkshop = typeof options.querySteamKitWorkshop === 'function' ? options.querySteamKitWorkshop : null;

  function steamCommunityHeaders(runOptions = {}) {
    const cookie = String(runOptions.steamCommunityCookie || '').trim();
    return cookie ? { Cookie: cookie } : {};
  }

  async function scrapeIds(params, runOptions = {}) {
    const headers = steamCommunityHeaders(runOptions);
    return scrapeWorkshopIds(params, {
      get,
      logger,
      signal: runOptions.signal,
      headers,
      requireSteamLogin: !!headers.Cookie || options.requiresSteamCommunitySession(params),
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
    const genreList = Array.from(new Set((genreOr || []).filter(Boolean)));
    if (genreList.length <= 1 || genreList.length > GENRE_FANOUT_LIMIT) {
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

  function strictSteamWebApiError(error) {
    const message = String(error && error.message || error || 'Steam Web API query failed');
    const invalidKey = /\b(401|403)\b|forbidden|unauthorized|invalid[^\n]*key|access denied/i.test(message);
    const wrapped = new Error(invalidKey
      ? 'Steam Web API Key 无效或无权执行此查询，请在 Steam 相关设置中检查 API Key'
      : `Steam Web API 查询失败：${message}`);
    wrapped.code = invalidKey ? 'STEAM_WEB_API_KEY_INVALID' : 'STEAM_WEB_API_QUERY_FAILED';
    wrapped.statusCode = invalidKey ? 401 : 502;
    wrapped.cause = error;
    return wrapped;
  }

  async function queryBySteamCm(params, genreOr, runOptions = {}) {
    if (!querySteamKitWorkshop) {
      const error = new Error('Steam CM 创意工坊查询桥不可用');
      error.code = 'STEAM_CM_QUERY_UNAVAILABLE';
      error.statusCode = 503;
      throw error;
    }
    const genres = Array.from(new Set((genreOr || []).map(value => String(value || '').trim()).filter(Boolean)));
    const variants = genres.length > 1 && genres.length <= GENRE_FANOUT_LIMIT ? genres : [genres.length === 1 ? genres[0] : ''];
    const results = await Promise.all(variants.map(async genre => {
      const response = await querySteamKitWorkshop(buildSteamCmQueryInput(params, genre), {
        signal: runOptions.signal,
        timeoutMs: runOptions.timeoutMs,
      });
      const details = Array.isArray(response && response.details) ? response.details : [];
      const ids = Array.isArray(response && response.ids) ? response.ids.map(String) : [];
      const detailMap = {};
      details.forEach(detail => {
        if (detail && detail.publishedfileid) detailMap[String(detail.publishedfileid)] = detail;
      });
      return { ids, detailMap, totalCount: parseInt(response && response.totalCount, 10) || 0 };
    }));
    const ids = [];
    const detailMap = {};
    const seen = new Set();
    let totalCount = 0;
    for (const result of results) {
      totalCount += result.totalCount;
      Object.assign(detailMap, result.detailMap);
      for (const id of result.ids) {
        if (!id || seen.has(id)) continue;
        seen.add(id);
        ids.push(id);
      }
    }
    return { ids, detailMap, totalCount, hints: {} };
  }

  async function queryBySteamApiOrCommunity(apiKey, params, genreOr, label, runOptions = {}) {
    if (runOptions.steamDataSource === 'cm') return queryBySteamCm(params, genreOr, runOptions);
    if (runOptions.steamDataSource !== 'webapi') {
      return Object.assign({ detailMap: {}, hints: {} }, await scrapeGenreOrIds(sourceParamsForScrape(params), genreOr, runOptions));
    }
    try {
      return Object.assign({ hints: {} }, await queryBySteamApi(apiKey, params, genreOr, runOptions));
    } catch (error) {
      if (isAbortError(error)) throw error;
      logger.warn(`[Query] SteamAPI ${label || 'query'} failed: ${error.message}`);
      throw strictSteamWebApiError(error);
    }
  }

  function getShortDetails(ids, optionsForRun = {}) {
    return getFileDetailsSafe(ids, Object.assign({ safe: false, ignoreCooldown: true }, optionsForRun));
  }

  return { getShortDetails, queryBySteamApiOrCommunity, scrapeGenreOrIds, scrapeIds };
}

module.exports = { createWorkshopQuerySources, isAbortError };
