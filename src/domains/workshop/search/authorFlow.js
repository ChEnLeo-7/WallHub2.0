'use strict';

const { detailMapFromList, mapWorkshopItem, validDetailForId } = require('./itemMapping');
const { isAbortError } = require('./querySources');
const { sourceParamsForScrape } = require('./sourceSelection');

const AUTHOR_SOURCE_PAGE_SIZE = 30;

async function runAuthorQuery(context) {
  const { coordinator, criteria, logger, params, runOptions, sources } = context;
  const { applyPostFilters, genreOr, numperpage, page } = criteria;
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
    const sourceData = await sources.scrapeGenreOrIds(Object.assign({}, sourceParams, {
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
      details = await sources.getShortDetails(ids, { totalBudgetMs: 7000, signal: runOptions.signal });
    } catch (error) {
      if (isAbortError(error)) throw error;
      coordinator.markSteamWebApiWarning(error);
      logger.warn('[Author Search] detail enrichment failed:', error.message);
    }
    if (!details.length) coordinator.setSteamWebApiWarning();
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
  return coordinator.withWarnings({
    response: { publishedfiledetails: items, total, total_count: items.length },
    source: 'community-author',
    page,
    pageSize: numperpage,
    total,
    totalPages: total ? Math.ceil(total / numperpage) : 0,
  });
}

module.exports = { runAuthorQuery };
