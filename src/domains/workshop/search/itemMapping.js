'use strict';

const { cleanText } = require('../text');

function detailMapFromList(details) {
  const detailMap = {};
  (details || []).forEach(detail => {
    if (detail && detail.publishedfileid) detailMap[detail.publishedfileid] = detail;
  });
  return detailMap;
}

function validDetailForId(detail, id) {
  return !!(detail && String(detail.result || '') === '1' && String(detail.publishedfileid || '') === String(id || ''));
}

function usableDetailForId(detail, id) {
  return validDetailForId(detail, id) ? detail : null;
}

function mapWorkshopItem(id, detail, hint = {}) {
  const hintAuthor = cleanText(hint && hint.author);
  const hintCreator = cleanText(hint && hint.creator);
  const hintTitle = cleanText(hint && hint.title);
  const hintPreview = cleanText(hint && hint.preview_url);
  if (detail && detail.result === 1) {
    return { publishedfileid: id, title: detail.title || id, preview_url: detail.preview_url || '', subscriptions: detail.subscriptions || 0, lifetime_subscriptions: detail.lifetime_subscriptions || detail.subscriptions || 0, views: detail.views || 0, favorited: detail.favorited || 0, lifetime_favorited: detail.lifetime_favorited || detail.favorited || 0, file_size: detail.file_size || 0, time_updated: detail.time_updated || 0, time_created: detail.time_created || 0, short_description: detail.short_description || '', tags: detail.tags || [], author: hintAuthor || '', creator: detail.creator || hintCreator || '' };
  }
  return { publishedfileid: id, title: hintTitle || `壁纸 ${id}`, preview_url: hintPreview || '', subscriptions: 0, lifetime_subscriptions: 0, views: 0, favorited: 0, lifetime_favorited: 0, file_size: 0, time_updated: 0, time_created: 0, short_description: '', tags: [], author: hintAuthor || '', creator: hintCreator || '', detailsPending: true };
}

module.exports = { detailMapFromList, validDetailForId, usableDetailForId, mapWorkshopItem };
