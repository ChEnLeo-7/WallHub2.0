'use strict';

const { detailMapFromList, mapWorkshopItem, validDetailForId } = require('./itemMapping');
const { collectArrayLikeParams } = require('../filters');
const { isAbortError } = require('./querySources');
const {
  STEAM_WORKSHOP_ACCESSIBLE_ITEMS,
  accessibleWorkshopPages,
  accessibleWorkshopTotal,
  pageBeyondAccessibleWorkshopTotal,
} = require('./sourceSelection');

async function detailsForSource(sourceData, context, totalBudgetMs) {
  const { coordinator, logger, runOptions, sources } = context;
  const ids = sourceData.ids || [];
  if (sourceData.detailMap && Object.keys(sourceData.detailMap).length) {
    return ids.map(id => sourceData.detailMap[id]).filter(Boolean);
  }
  let details = [];
  try {
    details = await sources.getShortDetails(ids, { totalBudgetMs, signal: runOptions.signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (context.sourceSelection.configuredSource !== 'community') {
      const wrapped = new Error(`Steam 创意工坊项目详情查询失败：${error && error.message ? error.message : 'unknown error'}`);
      wrapped.code = 'STEAM_WORKSHOP_DETAILS_FAILED';
      wrapped.statusCode = 502;
      wrapped.cause = error;
      throw wrapped;
    }
    coordinator.markSteamWebApiWarning(error);
    logger.warn('[FileDetails Error]', error.message);
  }
  if (ids.length && !details.length) {
    if (context.sourceSelection.configuredSource !== 'community') {
      const error = new Error('Steam 创意工坊项目详情查询失败：上游未返回项目详情');
      error.code = 'STEAM_WORKSHOP_DETAILS_FAILED';
      error.statusCode = 502;
      throw error;
    }
    coordinator.setSteamWebApiWarning();
  }
  return details;
}

function strictSourceName(configuredSource) {
  if (configuredSource === 'cm') return 'steam-cm';
  if (configuredSource === 'webapi') return 'steam-webapi';
  return '';
}

async function runSimplePublicQuery(context) {
  const { coordinator, criteria, logger, params, runOptions, sourceSelection, sources } = context;
  let sourceData = await sources.queryBySteamApiOrCommunity(
    sourceSelection.querySteamApiKey,
    params,
    'simple',
    runOptions
  );
  coordinator.noteSourceData(sourceData);
  let ratingFallback = '';
  const excludedRatings = new Set(collectArrayLikeParams(params, 'excludedtags'));
  if (!(sourceData.ids || []).length && excludedRatings.has('Everyone') && excludedRatings.has('Questionable')) {
    const relaxedParams = withoutExcludedTag(params, 'Questionable');
    sourceData = await sources.queryBySteamApiOrCommunity(
      sourceSelection.querySteamApiKey,
      relaxedParams,
      'mature rating fallback',
      runOptions
    );
    coordinator.noteSourceData(sourceData);
    ratingFallback = 'allow-questionable';
  }
  const details = await detailsForSource(sourceData, context, 7000);
  const detailMap = detailMapFromList(details);
  const items = criteria.applyWallpaperPostFilters((sourceData.ids || [])
    .filter(id => validDetailForId(detailMap[id], id))
    .map(id => mapWorkshopItem(id, detailMap[id], (sourceData.hints && sourceData.hints[id]) || {})))
    .slice(0, criteria.numperpage);
  const upstreamTotal = parseInt(sourceData.totalCount, 10) || 0;
  const preserveUpstreamTotal = sourceSelection.configuredSource === 'cm' || sourceSelection.configuredSource === 'webapi';
  const total = upstreamTotal > 0
    ? (preserveUpstreamTotal ? upstreamTotal : accessibleWorkshopTotal(upstreamTotal, params))
    : (items.length >= criteria.numperpage || pageBeyondAccessibleWorkshopTotal(criteria.page, criteria.numperpage, params)
      ? STEAM_WORKSHOP_ACCESSIBLE_ITEMS
      : items.length);
  const totalPages = accessibleWorkshopPages(total, criteria.numperpage);
  logger.log(`[Query] Returning ${items.length} items, total=${total}`);
  return coordinator.withWarnings({
    response: { publishedfiledetails: items, total, total_count: items.length, totalPages },
    totalPages,
    source: strictSourceName(sourceSelection.configuredSource),
    diagnostics: sourceData.strategy || sourceData.upstreamRequests || ratingFallback ? {
      ...(sourceData.strategy ? { strategy: sourceData.strategy } : {}),
      upstreamRequests: (sourceData.upstreamRequests || 1) + (ratingFallback ? 1 : 0),
      ...(ratingFallback ? { ratingFallback } : {}),
    } : undefined,
  });
}

function withoutExcludedTag(params, removedTag) {
  const next = {};
  const exclusions = collectArrayLikeParams(params, 'excludedtags').filter(tag => tag !== removedTag);
  for (const [key, value] of Object.entries(params || {})) {
    if (!/^excludedtags(?:\[\d+\])?$/.test(key)) next[key] = value;
  }
  exclusions.forEach((tag, index) => { next[`excludedtags[${index}]`] = tag; });
  return next;
}

function runPublicQuery(context) {
  return runSimplePublicQuery(context);
}

module.exports = { runPublicQuery };
