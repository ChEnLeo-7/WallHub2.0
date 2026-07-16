'use strict';

const { cleanText } = require('./text');

const BLOCKED_NSFW_TAGS = new Set([
  'mature',
  'adult',
  'adult only sexual content',
  'sexual content',
  'nudity',
  'r18',
  'r-18',
  '18+',
  'nsfw',
]);

const CONTENT_RATING_TAGS = new Set(['Everyone', 'Questionable', 'Mature']);
const WORKSHOP_TYPE_TAGS = new Set(['Scene', 'Video', 'Web', 'Application']);

function workshopTagName(tag) {
  return String((tag && tag.tag) || tag || '').trim();
}

function isBlockedNsfwTag(tag) {
  const raw = workshopTagName(tag).toLowerCase();
  if (!raw) return false;
  return BLOCKED_NSFW_TAGS.has(raw) ||
    /\br[-\s]?18\b/i.test(raw) ||
    /\bnsfw\b/i.test(raw) ||
    raw.includes('sexual content');
}

function itemAllowedByContentSafety(item, nsfwEnabled = false) {
  if (nsfwEnabled) return true;
  const tags = Array.isArray(item && item.tags) ? item.tags : [];
  return !tags.some(isBlockedNsfwTag);
}

function filterItemsByContentSafety(items, nsfwEnabled = false) {
  if (nsfwEnabled || !Array.isArray(items)) return items || [];
  return items.filter(item => itemAllowedByContentSafety(item, nsfwEnabled));
}

function collectArrayLikeParams(params, name) {
  const out = [];
  const pushValue = (value) => {
    if (Array.isArray(value)) return value.forEach(pushValue);
    const tag = workshopTagName(value);
    if (tag) out.push(tag);
  };
  if (params && Object.prototype.hasOwnProperty.call(params, name)) pushValue(params[name]);
  for (const [key, value] of Object.entries(params || {})) {
    if (new RegExp(`^${name}\\[\\d+\\]$`).test(key)) pushValue(value);
  }
  return Array.from(new Set(out));
}

function itemTagSet(item) {
  return new Set((Array.isArray(item && item.tags) ? item.tags : [])
    .map(tag => workshopTagName(tag).toLowerCase())
    .filter(Boolean));
}

function itemMatchesAnyTag(item, tags) {
  const normalized = (tags || []).map(tag => workshopTagName(tag).toLowerCase()).filter(Boolean);
  if (!normalized.length) return true;
  const tagSet = itemTagSet(item);
  return normalized.some(tag => tagSet.has(tag));
}

function collectRatingOrParams(params, nsfwEnabled = false) {
  return collectArrayLikeParams(params, 'rating_or')
    .filter(tag => CONTENT_RATING_TAGS.has(tag))
    .filter(tag => nsfwEnabled || !isBlockedNsfwTag(tag));
}

function itemMatchesExactPhrase(item, phrase) {
  const query = cleanText(phrase).toLowerCase();
  if (!query) return true;
  const haystack = [
    item && item.title,
    item && item.short_description,
    item && item.description,
    item && item.author,
    item && item.creator,
    item && item.publishedfileid,
  ].map(value => cleanText(value).toLowerCase()).join('\n');
  return haystack.includes(query);
}

function sanitizeWorkshopQueryParams(params, nsfwEnabled = false) {
  const clean = Object.assign({}, params || {});
  if (clean.workshop_id) clean.workshop_id = String(clean.workshop_id || '').replace(/[^\d]/g, '');
  if (nsfwEnabled) return clean;

  const requiredTags = [];
  const excludedTags = [];
  for (const [key, value] of Object.entries(clean)) {
    if (!/^requiredtags/.test(key) && !/^excludedtags/.test(key)) continue;
    delete clean[key];
    const tag = workshopTagName(value);
    if (!tag || isBlockedNsfwTag(tag)) continue;
    if (/^requiredtags/.test(key)) requiredTags.push(tag);
    else excludedTags.push(tag);
  }

  ['Mature', 'Adult Only Sexual Content', 'Sexual Content', 'Nudity', 'R18', 'NSFW'].forEach(tag => excludedTags.push(tag));
  Array.from(new Set(requiredTags)).forEach((tag, index) => { clean[`requiredtags[${index}]`] = tag; });
  Array.from(new Set(excludedTags)).forEach((tag, index) => { clean[`excludedtags[${index}]`] = tag; });
  return clean;
}

function normalizeWorkshopIdSearch(value) {
  const raw = String(value || '').trim();
  if (/^\d{6,}$/.test(raw)) return raw;
  const match = raw.match(/(?:publishedfileid|id)=([0-9]{6,})/i) ||
    raw.match(/sharedfiles\/filedetails\/\?id=([0-9]{6,})/i);
  return match ? match[1] : '';
}

module.exports = {
  BLOCKED_NSFW_TAGS,
  CONTENT_RATING_TAGS,
  WORKSHOP_TYPE_TAGS,
  workshopTagName,
  isBlockedNsfwTag,
  itemAllowedByContentSafety,
  filterItemsByContentSafety,
  collectArrayLikeParams,
  itemTagSet,
  itemMatchesAnyTag,
  collectRatingOrParams,
  itemMatchesExactPhrase,
  sanitizeWorkshopQueryParams,
  normalizeWorkshopIdSearch,
};
