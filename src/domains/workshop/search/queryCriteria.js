'use strict';

const {
  CONTENT_RATING_TAGS,
  WORKSHOP_TYPE_TAGS,
  collectArrayLikeParams,
  collectRatingOrParams,
  filterItemsByContentSafety,
  itemMatchesAnyTag,
  itemMatchesExactPhrase,
  normalizeWorkshopIdSearch,
} = require('../filters');

function itemHasTags(item) {
  return Array.isArray(item && item.tags) && item.tags.length > 0;
}

function itemMatchesAnyKnownTag(item, tags) {
  if (!itemHasTags(item)) return true;
  return itemMatchesAnyTag(item, tags);
}

function itemMatchesAllKnownTags(item, tags) {
  const normalized = (tags || []).map(tag => String(tag || '').trim().toLowerCase()).filter(Boolean);
  if (!normalized.length) return true;
  if (!itemHasTags(item)) return false;
  const tagSet = new Set((item.tags || []).map(tag => String((tag && tag.tag) || tag || '').trim().toLowerCase()).filter(Boolean));
  return normalized.every(tag => tagSet.has(tag));
}

function itemExcludesAnyKnownTag(item, tags) {
  if (!itemHasTags(item)) return true;
  return !itemMatchesAnyTag(item, tags);
}

function detailFilterRequiredTags(tags) {
  return (tags || []).filter(tag => String(tag || '').trim().toLowerCase() !== 'mobile');
}

function createQueryCriteria(params, allowNsfw) {
  const page = parseInt(params.page, 10) || 1;
  const numperpage = parseInt(params.numperpage, 10) || 30;
  const requestedCreator = String(params.creator || '').trim();
  const genreOr = collectArrayLikeParams(params, 'genre_or').map(tag => tag.toLowerCase());
  const typeOr = collectArrayLikeParams(params, 'type_or').filter(tag => WORKSHOP_TYPE_TAGS.has(tag));
  const ratingOr = collectRatingOrParams(params, allowNsfw);
  const requiredTags = detailFilterRequiredTags(collectArrayLikeParams(params, 'requiredtags'));
  const excludedRatings = collectArrayLikeParams(params, 'excludedtags').filter(tag => CONTENT_RATING_TAGS.has(tag));
  const exactPhraseEnabled = ['1', 'true', 'yes', 'on'].includes(String(params.exact_phrase || '').toLowerCase());
  const exactPhraseText = exactPhraseEnabled ? String(params.search_text || '').trim() : '';

  function applyPostFilters(items) {
    return filterItemsByContentSafety(items || [], allowNsfw)
      .filter(item => !requestedCreator || String(item && item.creator || '').trim() === requestedCreator)
      .filter(item => itemMatchesAllKnownTags(item, requiredTags))
      .filter(item => typeOr.length ? itemMatchesAnyKnownTag(item, typeOr) : true)
      .filter(item => ratingOr.length ? itemMatchesAnyKnownTag(item, ratingOr) : true)
      .filter(item => excludedRatings.length ? itemExcludesAnyKnownTag(item, excludedRatings) : true)
      .filter(item => genreOr.length > 1 ? itemMatchesAnyKnownTag(item, genreOr) : true)
      .filter(item => exactPhraseText ? itemMatchesExactPhrase(item, exactPhraseText) : true);
  }

  return {
    applyPostFilters,
    directWorkshopId: normalizeWorkshopIdSearch(params.workshop_id || params.search_text || ''),
    exactPhraseText,
    genreOr,
    hasLocalOr: genreOr.length > 1 || typeOr.length > 1 || ratingOr.length > 1,
    numperpage,
    page,
    requestedCreator,
  };
}

module.exports = { createQueryCriteria };
