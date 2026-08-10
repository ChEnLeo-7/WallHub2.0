'use strict';

const { detailMapFromList, mapWorkshopItem, validDetailForId } = require('./itemMapping');
const { isAbortError } = require('./querySources');

async function runPersonalQuery(context) {
  const { coordinator, criteria, logger, params, querySteamKitUserFiles, runOptions, sourceSelection, sources } = context;
  const { applyPostFilters, numperpage, page } = criteria;
  const listType = sourceSelection.steamKitPersonalType;
  const sourceData = await querySteamKitUserFiles(listType, {
    appId: parseInt(params.appid, 10) || 431960,
    page,
    numperpage,
    sortmethod: params.sortmethod,
    signal: runOptions.signal,
  });
  const ids = Array.isArray(sourceData && sourceData.ids) ? sourceData.ids.map(id => String(id || '')).filter(Boolean) : [];
  const steamKitDetails = Array.isArray(sourceData && sourceData.details) ? sourceData.details : [];
  const useSteamKitDetails = steamKitDetails.length > 0;
  let details = steamKitDetails;
  if (!useSteamKitDetails) {
    try {
      details = await sources.getShortDetails(ids, { totalBudgetMs: 7000, signal: runOptions.signal });
    } catch (error) {
      if (isAbortError(error)) throw error;
      coordinator.markSteamWebApiWarning(error);
      logger.warn('[SteamKit UserFiles] detail enrichment failed:', error.message);
    }
  }
  const detailMap = detailMapFromList(details);
  const items = applyPostFilters(ids
    .filter(id => validDetailForId(detailMap[id], id))
    .map(id => mapWorkshopItem(id, detailMap[id], {})));
  const total = Math.max(items.length, parseInt(sourceData && sourceData.totalCount, 10) || 0);
  logger.log(`[SteamKit UserFiles] ${listType} page ${page} returned ${items.length}/${total}`);
  return coordinator.withWarnings({
    response: { publishedfiledetails: items, total, total_count: total },
    source: 'steamkit-user-files',
    page,
    pageSize: numperpage,
    total,
    totalPages: total ? Math.ceil(total / numperpage) : 0,
    diagnostics: { listType, detailMode: useSteamKitDetails ? 'steamkit' : 'blocking-for-preview' },
  });
}

module.exports = { runPersonalQuery };
