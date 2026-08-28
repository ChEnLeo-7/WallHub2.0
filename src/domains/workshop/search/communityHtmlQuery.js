'use strict';

const { mapWorkshopItem } = require('./itemMapping');
const { collectArrayLikeParams } = require('../filters');
const { sourceParamsForScrape } = require('./sourceSelection');

async function runCommunityHtmlQuery(context) {
  const { coordinator, criteria, logger, params, runOptions, sources } = context;
  let sourceData = await sources.scrapeIds(sourceParamsForScrape(params), runOptions);
  coordinator.noteSourceData(sourceData);
  let ratingFallback = '';
  const excludedRatings = new Set(collectArrayLikeParams(params, 'excludedtags'));
  if (!(sourceData.ids || []).length && excludedRatings.has('Everyone') && excludedRatings.has('Questionable')) {
    sourceData = await sources.scrapeIds(sourceParamsForScrape(withoutExcludedTag(params, 'Questionable')), runOptions);
    coordinator.noteSourceData(sourceData);
    ratingFallback = 'allow-questionable';
  }

  const ids = Array.isArray(sourceData.ids) ? sourceData.ids : [];
  const hints = sourceData.hints || {};
  const items = ids.map(id => mapWorkshopItem(id, null, Object.assign({}, hints[id] || {}, {
    // The Community browse page only exposes a reduced thumbnail. Keep it out
    // of the card so the full details cover is the first image users see.
    preview_url: '',
  })));
  const total = sourceData.totalCount > 0 ? sourceData.totalCount : items.length;
  const totalPages = sourceData.totalPagesExact
    ? sourceData.totalPages
    : (sourceData.totalCount > 0
      ? Math.ceil(total / criteria.numperpage)
      : Math.max(0, sourceData.totalPages || 0));

  logger.log(`[Query] Community HTML page ${criteria.page} returned ${items.length}/${total}`);
  return coordinator.withWarnings({
    response: {
      publishedfiledetails: items,
      total,
      total_count: items.length,
      totalPages,
    },
    source: 'community-html',
    page: criteria.page,
    pageSize: criteria.numperpage,
    totalPages,
    diagnostics: {
      detailMode: 'background',
      pageLoadMode: 'community-html-single-page',
      upstreamRequests: ratingFallback ? 2 : 1,
      ...(ratingFallback ? { ratingFallback } : {}),
    },
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

module.exports = { runCommunityHtmlQuery };
