'use strict';

const {
  CONTENT_RATING_TAG_LIST,
  LEGACY_RESOLUTION_TAG_MAP,
  STEAM_RESOLUTION_TAG_LIST,
  WORKSHOP_CATEGORY_TAG_LIST,
  WORKSHOP_GENRE_TAG_LIST,
  WORKSHOP_TYPE_TAG_LIST,
  WORKSHOP_UTILITY_TAG_LIST,
} = require('./filterCatalog');

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

const CONTENT_RATING_TAGS = new Set(CONTENT_RATING_TAG_LIST);
const WORKSHOP_TYPE_TAGS = new Set(WORKSHOP_TYPE_TAG_LIST);
const FILTER_GROUPS = [
  { name: 'type_or', tags: WORKSHOP_TYPE_TAG_LIST },
  { name: 'rating_or', tags: CONTENT_RATING_TAG_LIST },
  { name: 'genre_or', tags: WORKSHOP_GENRE_TAG_LIST },
  { name: 'resolution_or', tags: STEAM_RESOLUTION_TAG_LIST, aliases: LEGACY_RESOLUTION_TAG_MAP },
  { name: 'category_or', tags: WORKSHOP_CATEGORY_TAG_LIST, fixedSelection: ['Wallpaper'] },
];
const OFFICIAL_TAG_ORDER = new Map([
  ...WORKSHOP_TYPE_TAG_LIST,
  ...CONTENT_RATING_TAG_LIST,
  ...WORKSHOP_GENRE_TAG_LIST,
  ...STEAM_RESOLUTION_TAG_LIST,
  ...WORKSHOP_CATEGORY_TAG_LIST,
  ...WORKSHOP_UTILITY_TAG_LIST,
].map((tag, index) => [tag.toLowerCase(), index]));

function compareWorkshopTags(left, right) {
  const leftText = workshopTagName(left);
  const rightText = workshopTagName(right);
  const leftRank = OFFICIAL_TAG_ORDER.get(leftText.toLowerCase());
  const rightRank = OFFICIAL_TAG_ORDER.get(rightText.toLowerCase());
  if (leftRank !== undefined || rightRank !== undefined) {
    if (leftRank === undefined) return 1;
    if (rightRank === undefined) return -1;
    return leftRank - rightRank;
  }
  return leftText.localeCompare(rightText, 'en', { sensitivity: 'base' });
}

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

function sanitizeWorkshopQueryParams(params, nsfwEnabled = false, steamDataSource = 'community') {
  const clean = Object.assign({}, params || {});
  if (clean.workshop_id) clean.workshop_id = String(clean.workshop_id || '').replace(/[^\d]/g, '');
  const requiredTags = collectArrayLikeParams(clean, 'requiredtags')
    .map(tag => LEGACY_RESOLUTION_TAG_MAP[tag] || tag);
  const excludedTags = collectArrayLikeParams(clean, 'excludedtags')
    .map(tag => LEGACY_RESOLUTION_TAG_MAP[tag] || tag);
  for (const key of Object.keys(clean)) {
    if (/^(?:requiredtags|excludedtags)(?:\[\d+\])?$/.test(key)) delete clean[key];
  }
  for (const group of FILTER_GROUPS) {
    const allowed = new Set(group.tags);
    const selected = group.fixedSelection || [
      ...collectArrayLikeParams(clean, group.name),
      ...requiredTags,
    ]
      .map(tag => group.aliases && group.aliases[tag] || tag)
      .filter(tag => allowed.has(tag));
    for (const key of Object.keys(clean)) {
      if (new RegExp(`^${group.name}(?:\\[\\d+\\])?$`).test(key)) delete clean[key];
    }
    if (!selected.length || selected.length >= group.tags.length) continue;
    const selectedSet = new Set(selected);
    group.tags.forEach((tag) => {
      if (!selectedSet.has(tag)) excludedTags.push(tag);
    });
  }

  const groupedTags = new Set(FILTER_GROUPS.flatMap(group => group.tags));
  const filteredRequiredTags = (nsfwEnabled ? requiredTags : requiredTags.filter(tag => !isBlockedNsfwTag(tag)))
    .filter(tag => !groupedTags.has(tag));
  // Wallpaper Engine sanitizes normal browse results before exposing them to
  // the UI. Steam's public query surfaces do not expose that native switch, so
  // keep non-wallpaper Workshop categories out at the source.
  filteredRequiredTags.push('Wallpaper');
  const filteredExcludedTags = nsfwEnabled ? excludedTags : excludedTags.filter(tag => !isBlockedNsfwTag(tag));

  const mobileCompatible = steamDataSource !== 'community' && ['1', 'true', 'yes', 'on'].includes(String(clean.mobile_compatible || '').toLowerCase());
  if (mobileCompatible) {
    filteredExcludedTags.push('Application', 'Web');
    clean.mobile_compatible = 1;
  } else {
    delete clean.mobile_compatible;
  }
  if (steamDataSource === 'community') delete clean.search_text_target;
  else if (parseInt(clean.search_text_target, 10) === 1) clean.search_text_target = 1;
  else delete clean.search_text_target;

  if (!nsfwEnabled) {
    ['Mature', 'Adult Only Sexual Content', 'Sexual Content', 'Nudity', 'R18', 'NSFW'].forEach(tag => filteredExcludedTags.push(tag));
  }
  Array.from(new Set(filteredRequiredTags)).sort(compareWorkshopTags)
    .forEach((tag, index) => { clean[`requiredtags[${index}]`] = tag; });
  Array.from(new Set(filteredExcludedTags)).sort(compareWorkshopTags)
    .forEach((tag, index) => { clean[`excludedtags[${index}]`] = tag; });
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
  STEAM_RESOLUTION_TAG_LIST,
  WORKSHOP_TYPE_TAGS,
  workshopTagName,
  isBlockedNsfwTag,
  itemAllowedByContentSafety,
  filterItemsByContentSafety,
  collectArrayLikeParams,
  sanitizeWorkshopQueryParams,
  normalizeWorkshopIdSearch,
};
