'use strict';

const { buildSteamCmQueryInput, queryWorkshopBySteamApi, scrapeWorkshopIds } = require('../query');
const { sourceParamsForScrape } = require('./sourceSelection');

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

  async function queryBySteamApi(apiKey, params, runOptions = {}) {
    return queryWorkshopBySteamApi(apiKey, params, undefined, {
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

  async function queryBySteamCm(params, runOptions = {}) {
    if (!querySteamKitWorkshop) {
      const error = new Error('Steam CM 创意工坊查询桥不可用');
      error.code = 'STEAM_CM_QUERY_UNAVAILABLE';
      error.statusCode = 503;
      throw error;
    }
    const response = await querySteamKitWorkshop(buildSteamCmQueryInput(params), {
      signal: runOptions.signal,
      timeoutMs: runOptions.timeoutMs,
    });
    const details = Array.isArray(response && response.details) ? response.details : [];
    const ids = Array.isArray(response && response.ids) ? response.ids.map(String) : [];
    const detailMap = {};
    details.forEach(detail => {
      if (detail && detail.publishedfileid) detailMap[String(detail.publishedfileid)] = detail;
    });
    return {
      ids,
      detailMap,
      totalCount: parseInt(response && response.totalCount, 10) || 0,
      hints: {},
      upstreamRequests: 1,
    };
  }

  async function queryBySteamApiOrCommunity(apiKey, params, label, runOptions = {}) {
    if (runOptions.steamDataSource === 'cm') return queryBySteamCm(params, runOptions);
    if (runOptions.steamDataSource !== 'webapi') {
      return Object.assign({ detailMap: {}, hints: {}, upstreamRequests: 1 }, await scrapeIds(sourceParamsForScrape(params), runOptions));
    }
    try {
      return Object.assign({ hints: {} }, await queryBySteamApi(apiKey, params, runOptions));
    } catch (error) {
      if (isAbortError(error)) throw error;
      logger.warn(`[Query] SteamAPI ${label || 'query'} failed: ${error.message}`);
      throw strictSteamWebApiError(error);
    }
  }

  function getShortDetails(ids, optionsForRun = {}) {
    return getFileDetailsSafe(ids, Object.assign({ safe: false, ignoreCooldown: true }, optionsForRun));
  }

  return { getShortDetails, queryBySteamApiOrCommunity, scrapeIds };
}

module.exports = { createWorkshopQuerySources, isAbortError };
