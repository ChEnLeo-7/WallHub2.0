'use strict';

const { sanitizeWorkshopQueryParams } = require('./filters');
const { runAuthorQuery } = require('./search/authorFlow');
const { createSearchCacheCoordinator } = require('./search/cacheCoordinator');
const { runCommunityHtmlQuery } = require('./search/communityHtmlQuery');
const { createFallbackCoordinator } = require('./search/fallbackCoordinator');
const { detailMapFromList, mapWorkshopItem } = require('./search/itemMapping');
const { runPersonalQuery } = require('./search/personalQuery');
const { runPublicQuery } = require('./search/publicQuery');
const { createQueryCriteria } = require('./search/queryCriteria');
const { createWorkshopQuerySources, isAbortError } = require('./search/querySources');
const {
  requiresSteamCommunitySession,
  resolveSourceSelection,
  steamAccountCacheKey,
  steamAccountCacheKeyForRun,
  steamIdFromCommunityCookie,
  steamKitPersonalListType,
} = require('./search/sourceSelection');

function createWorkshopSearchService(options = {}) {
  const getSteamApiKey = options.getSteamApiKey || (() => '');
  const getSteamWebApiBaseUrl = options.getSteamWebApiBaseUrl || (() => 'https://api.steampowered.com');
  const nsfwEnabled = options.nsfwEnabled || (() => false);
  const logger = options.logger || console;
  const querySteamKitUserFiles = typeof options.querySteamKitUserFiles === 'function' ? options.querySteamKitUserFiles : null;
  const querySteamKitWorkshop = typeof options.querySteamKitWorkshop === 'function' ? options.querySteamKitWorkshop : null;
  const sources = createWorkshopQuerySources({
    get: options.get,
    getFileDetailsSafe: options.getFileDetailsSafe,
    getSteamWebApiBaseUrl,
    logger,
    requiresSteamCommunitySession,
    querySteamKitWorkshop,
  });

  async function doSearch(rawParams = {}, initialRunOptions = {}) {
    const allowNsfw = !!nsfwEnabled();
    const params = sanitizeWorkshopQueryParams(rawParams || {}, allowNsfw, initialRunOptions.steamDataSource);
    const criteria = createQueryCriteria(params, allowNsfw);
    const sourceSelection = resolveSourceSelection(params, initialRunOptions, {
      getSteamApiKey,
      querySteamKitUserFiles,
      querySteamKitWorkshop,
    });
    const runOptions = sourceSelection.runOptions;
    const coordinator = createFallbackCoordinator({
      steamApiKey: sourceSelection.steamApiKey,
      page: criteria.page,
      numperpage: criteria.numperpage,
    });
    const context = {
      coordinator,
      criteria,
      logger,
      params,
      querySteamKitUserFiles,
      runOptions,
      sourceSelection,
      sources,
    };

    if (criteria.requestedCreator && sourceSelection.configuredSource === 'community') return runAuthorQuery(context);

    if (criteria.directWorkshopId) {
      const id = criteria.directWorkshopId;
      const details = await options.getFileDetailsSafe([id], { safe: false, signal: runOptions.signal }).catch((error) => {
        if (isAbortError(error)) throw error;
        if (sourceSelection.configuredSource !== 'community') {
          const wrapped = new Error(`Steam 创意工坊项目详情查询失败：${error && error.message ? error.message : 'unknown error'}`);
          wrapped.code = 'STEAM_WORKSHOP_DETAILS_FAILED';
          wrapped.statusCode = 502;
          wrapped.cause = error;
          throw wrapped;
        }
        coordinator.markSteamWebApiWarning(error);
        logger.warn('[FileDetails Error]', error.message);
        return [];
      });
      if (!details.length) coordinator.setSteamWebApiWarning();
      const detail = details.find(item => item && String(item.publishedfileid) === id);
      const items = criteria.applyPostFilters(detail && detail.result === 1 ? [mapWorkshopItem(id, detail, {})] : []);
      logger.log(`[Query] Workshop ID ${id} returning ${items.length}`);
      return coordinator.withWarnings({ response: { publishedfiledetails: items, total: items.length, total_count: items.length } });
    }

    if (sourceSelection.useSteamKitUserFiles) return runPersonalQuery(context);
    if (sourceSelection.configuredSource === 'community') return runCommunityHtmlQuery(context);
    return runPublicQuery(context);
  }

  const cache = createSearchCacheCoordinator({
    execute: doSearch,
    logger,
    nsfwEnabled,
    resultCacheMaxEntries: options.resultCacheMaxEntries,
    resultTtlMs: options.resultTtlMs,
  });

  return {
    search: cache.search,
    scrapeIds: sources.scrapeIds,
    clearCaches: cache.clearCaches,
    invalidateCaches: cache.invalidateCaches,
    clearInFlight: cache.clearInFlight,
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
