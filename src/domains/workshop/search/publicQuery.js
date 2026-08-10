'use strict';

const { itemMatchesExactPhrase } = require('../filters');
const { detailMapFromList, mapWorkshopItem, validDetailForId } = require('./itemMapping');
const { isAbortError } = require('./querySources');
const {
  STEAM_WORKSHOP_ACCESSIBLE_ITEMS,
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

function appendUniqueItems(target, seen, items, targetCount) {
  for (const item of items) {
    const id = String(item && item.publishedfileid || '');
    if (!id || seen.has(id)) continue;
    seen.add(id);
    target.push(item);
    if (target.length >= targetCount) break;
  }
}

async function findExactPhraseFallbackItems(context) {
  const { coordinator, criteria, logger, params, runOptions, sources } = context;
  const probeParams = Object.assign({}, params, { page: 1, search_text: '' });
  const sourceData = await sources.scrapeIds(probeParams, runOptions);
  if (!sourceData.ids || !sourceData.ids.length) return [];
  let details = [];
  try {
    details = await sources.getShortDetails(sourceData.ids, { totalBudgetMs: 5000, signal: runOptions.signal });
  } catch (error) {
    if (isAbortError(error)) throw error;
    logger.warn('[ExactPhrase] fallback details failed:', error.message);
  }
  const detailMap = detailMapFromList(details);
  return criteria.applyPostFilters(sourceData.ids
    .filter(id => validDetailForId(detailMap[id], id))
    .map(id => mapWorkshopItem(id, detailMap[id], (sourceData.hints && sourceData.hints[id]) || {})))
    .filter(item => itemMatchesExactPhrase(item, criteria.exactPhraseText))
    .slice(0, criteria.numperpage);
}

async function runSimplePublicQuery(context) {
  const { coordinator, criteria, logger, params, runOptions, sourceSelection, sources } = context;
  const { applyPostFilters, exactPhraseText, genreOr, numperpage, page } = criteria;
  const matched = [];
  const seen = new Set();
  let total = 0;
  let scanned = 0;
  const maxScanPages = Math.max(page, page + 8);

  for (let scanPage = page; scanPage <= maxScanPages && matched.length < numperpage; scanPage += 1) {
    const scanParams = scanPage === page ? params : Object.assign({}, params, { page: scanPage });
    const sourceData = await sources.queryBySteamApiOrCommunity(
      sourceSelection.querySteamApiKey,
      scanParams,
      genreOr,
      scanPage === page ? 'simple' : 'simple page ' + scanPage,
      runOptions
    );
    coordinator.noteSourceData(sourceData);
    const { ids, totalCount, hints } = sourceData;
    if (!ids.length) break;
    scanned += 1;
    if (totalCount > 0) total = totalCount;
    const details = await detailsForSource(sourceData, context, 7000);
    const detailMap = detailMapFromList(details);
    appendUniqueItems(matched, seen, applyPostFilters(ids
      .filter(id => validDetailForId(detailMap[id], id))
      .map(id => mapWorkshopItem(id, detailMap[id], (hints && hints[id]) || {}))), numperpage);
    if (ids.length < numperpage) break;
  }

  let items = matched;
  if (exactPhraseText && !items.length && sourceSelection.configuredSource === 'community') {
    items = await findExactPhraseFallbackItems(context);
  }
  const resultTotal = exactPhraseText && items.length
    ? items.length
    : (total > 0
      ? accessibleWorkshopTotal(total, params)
      : (items.length >= numperpage || pageBeyondAccessibleWorkshopTotal(page, numperpage, params) ? STEAM_WORKSHOP_ACCESSIBLE_ITEMS : items.length));
  logger.log(`[Query] Returning ${items.length} items, total=${resultTotal}, scanned=${scanned}`);
  return coordinator.withWarnings({ response: { publishedfiledetails: items, total: resultTotal, total_count: items.length } });
}

async function runLocalOrPublicQuery(context) {
  const { coordinator, criteria, logger, params, runOptions, sourceSelection, sources } = context;
  const { applyPostFilters, genreOr, numperpage, page } = criteria;
  const matched = [];
  const seen = new Set();
  let total = 50000;
  let scanned = 0;
  const maxScanPages = Math.max(page, page + 8);

  for (let scanPage = page; scanPage <= maxScanPages && matched.length < numperpage; scanPage += 1) {
    const scanParams = Object.assign({}, params, { page: scanPage });
    const sourceData = Object.assign({ hints: {} }, await sources.queryBySteamApiOrCommunity(
      sourceSelection.querySteamApiKey,
      scanParams,
      genreOr,
      scanPage === page ? 'genre-or' : `genre-or page ${scanPage}`,
      runOptions
    ));
    coordinator.noteSourceData(sourceData);
    if (!sourceData.ids.length) break;
    scanned += 1;
    if (sourceData.totalCount > 0) total = sourceData.totalCount;
    const details = await detailsForSource(sourceData, context, 2500);
    const detailMap = detailMapFromList(details);
    appendUniqueItems(matched, seen, applyPostFilters(sourceData.ids
      .filter(id => validDetailForId(detailMap[id], id))
      .map(id => mapWorkshopItem(id, detailMap[id], {}))), numperpage);
    if (sourceData.ids.length < numperpage) break;
  }

  total = accessibleWorkshopTotal(total, params);
  logger.log(`[Query] ${sourceSelection.querySteamApiKey ? 'SteamAPI' : 'Community'} genre OR(${genreOr.length}) returning ${matched.length}, total=${total}, scanned=${scanned}`);
  return coordinator.withWarnings({ response: { publishedfiledetails: matched, total, total_count: matched.length } });
}

function runPublicQuery(context) {
  return context.criteria.hasLocalOr ? runLocalOrPublicQuery(context) : runSimplePublicQuery(context);
}

module.exports = { runPublicQuery };
