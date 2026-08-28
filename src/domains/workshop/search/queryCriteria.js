'use strict';

const {
  collectArrayLikeParams,
  filterItemsByContentSafety,
  normalizeWorkshopIdSearch,
} = require('../filters');
const { WORKSHOP_TYPE_TAG_LIST } = require('../filterCatalog');

function itemHasTags(item) {
  return Array.isArray(item && item.tags) && item.tags.length > 0;
}

function itemMatchesAllKnownTags(item, tags) {
  const normalized = (tags || []).map(tag => String(tag || '').trim().toLowerCase()).filter(Boolean);
  if (!normalized.length) return true;
  if (!itemHasTags(item)) return false;
  const tagSet = new Set((item.tags || []).map(tag => String((tag && tag.tag) || tag || '').trim().toLowerCase()).filter(Boolean));
  return normalized.every(tag => tagSet.has(tag));
}

function detailFilterRequiredTags(tags) {
  return (tags || []).filter(tag => !['mobile', 'wallpaper'].includes(String(tag || '').trim().toLowerCase()));
}

function itemMatchesWallpaperTypes(item, allowedTypes) {
  if (!itemHasTags(item)) return false;
  const tagSet = new Set((item.tags || []).map(tag => String((tag && tag.tag) || tag || '').trim().toLowerCase()).filter(Boolean));
  if (tagSet.has('asset')) return false;
  return allowedTypes.some(type => tagSet.has(type.toLowerCase()));
}

function createQueryCriteria(params, allowNsfw) {
  const page = parseInt(params.page, 10) || 1;
  const numperpage = parseInt(params.numperpage, 10) || 30;
  const requestedCreator = String(params.creator || '').trim();
  const requiredTags = detailFilterRequiredTags(collectArrayLikeParams(params, 'requiredtags'));
  const excludedTags = new Set(collectArrayLikeParams(params, 'excludedtags').map(tag => tag.toLowerCase()));
  const allowedWallpaperTypes = WORKSHOP_TYPE_TAG_LIST.filter(type => !excludedTags.has(type.toLowerCase()));

  function applyPostFilters(items) {
    return filterItemsByContentSafety(items || [], allowNsfw)
      .filter(item => !requestedCreator || String(item && item.creator || '').trim() === requestedCreator)
      .filter(item => itemMatchesAllKnownTags(item, requiredTags));
  }

  function applyWallpaperPostFilters(items) {
    return applyPostFilters(items).filter(item => itemMatchesWallpaperTypes(item, allowedWallpaperTypes));
  }

  return {
    applyPostFilters,
    applyWallpaperPostFilters,
    directWorkshopId: normalizeWorkshopIdSearch(params.workshop_id || params.search_text || ''),
    numperpage,
    page,
    requestedCreator,
  };
}

module.exports = { createQueryCriteria, itemMatchesWallpaperTypes };
