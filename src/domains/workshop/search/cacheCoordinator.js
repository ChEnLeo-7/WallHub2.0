'use strict';

const { createInFlightCoalescer } = require('../../../shared/inFlight');
const { sanitizeWorkshopQueryParams } = require('../filters');
const {
  requiresSteamCommunitySession,
  steamAccountCacheKeyForRun,
} = require('./sourceSelection');

function queryCacheKey(params, allowNsfw, steamDataSource = 'community') {
  const stable = {};
  for (const key of Object.keys(params || {}).sort()) {
    if (key === '_' || key === 't' || key === '_refresh' || key === 'refresh' || key === 'force' || key === 'nocache') continue;
    stable[key] = params[key];
  }
  stable.__nsfw = !!allowNsfw;
  stable.__mode = 'normal';
  stable.__steamDataSource = steamDataSource;
  return JSON.stringify(stable);
}

function createSearchCacheCoordinator(options = {}) {
  const logger = options.logger || console;
  const execute = async (cacheKey, runOptions = {}) => {
      const result = await options.execute(runOptions.rawParams || {}, runOptions);
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
    };
  const createCache = resultTtlMs => createInFlightCoalescer({
    label: '[Search]',
    logger,
    resultTtlMs,
    resultCacheMaxEntries: Number(options.resultCacheMaxEntries || 60),
    execute,
  });
  const configuredTtlMs = Number(options.resultTtlMs || 0);
  const communityCache = createCache(configuredTtlMs || 30 * 1000);
  const strictSourceCache = createCache(configuredTtlMs || 60 * 1000);

  async function search(rawParams = {}, searchOptions = {}) {
    const allowNsfw = !!options.nsfwEnabled();
    const configuredSource = ['community', 'webapi', 'cm'].includes(String(searchOptions.steamDataSource || '').trim().toLowerCase())
      ? String(searchOptions.steamDataSource).trim().toLowerCase()
      : 'community';
    const params = sanitizeWorkshopQueryParams(rawParams || {}, allowNsfw, configuredSource);
    let cacheKey = queryCacheKey(params, allowNsfw, configuredSource);
    const authenticatedCommunityQuery = configuredSource === 'community' && !!String(searchOptions.steamCommunityCookie || '').trim();
    if (requiresSteamCommunitySession(params) || authenticatedCommunityQuery) {
      cacheKey = `${cacheKey}|steamAccount=${steamAccountCacheKeyForRun(searchOptions)}`;
    }
    const forceRefresh = !!(rawParams && (rawParams._refresh || rawParams.refresh || rawParams.force || rawParams.nocache));
    const cache = configuredSource === 'community' ? communityCache : strictSourceCache;
    return cache.run(cacheKey, {
      forceRefresh,
      rawParams,
      steamCommunityCookie: searchOptions.steamCommunityCookie || '',
      steamAccountKey: searchOptions.steamAccountKey || '',
      skipSteamKitUserFiles: !!searchOptions.skipSteamKitUserFiles,
      steamKitQueryAvailable: !!searchOptions.steamKitQueryAvailable,
      steamDataSource: configuredSource,
      signal: searchOptions.signal,
    });
  }

  return {
    search,
    clearInFlight: () => {
      communityCache.clear();
      strictSourceCache.clear();
    },
    clearCaches: () => {
      communityCache.clearCaches();
      strictSourceCache.clearCaches();
    },
    invalidateCaches: () => {
      communityCache.invalidateCaches();
      strictSourceCache.invalidateCaches();
    },
  };
}

module.exports = { createSearchCacheCoordinator, queryCacheKey };
