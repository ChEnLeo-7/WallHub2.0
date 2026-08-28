'use strict';

const crypto = require('node:crypto');

const { normalizeSteamId } = require('../query');
const { collectArrayLikeParams, normalizeWorkshopIdSearch } = require('../filters');

const STEAM_WORKSHOP_ACCESSIBLE_ITEMS = 50000;
const STEAM_WORKSHOP_ACCESSIBLE_PAGES = 1000;

function usesOfficialCommunityTagFilter(params = {}) {
  return ['1', 'true', 'yes', 'on'].includes(String(params.community_tag_filter || '').toLowerCase());
}

function accessibleWorkshopTotal(total, params = {}) {
  const value = Math.max(0, parseInt(total, 10) || 0);
  if (!value || params.creator || usesOfficialCommunityTagFilter(params)) return value;
  return Math.min(value, STEAM_WORKSHOP_ACCESSIBLE_ITEMS);
}

function pageBeyondAccessibleWorkshopTotal(page, numperpage, params = {}) {
  if (params.creator || usesOfficialCommunityTagFilter(params)) return false;
  const safePage = Math.max(1, parseInt(page, 10) || 1);
  return safePage > STEAM_WORKSHOP_ACCESSIBLE_PAGES;
}

function accessibleWorkshopPages(total, numperpage) {
  const value = Math.max(0, parseInt(total, 10) || 0);
  const pageSize = Math.max(1, parseInt(numperpage, 10) || 30);
  return value ? Math.min(STEAM_WORKSHOP_ACCESSIBLE_PAGES, Math.ceil(value / pageSize)) : 0;
}

function requiresSteamCommunitySession(params = {}) {
  const pathMode = String(params.path || '').trim().toLowerCase();
  const requestedSort = String(params.actualsort || params.browsesort || '').trim().toLowerCase();
  return !!String(params.browsefilter || '').trim() ||
    !!String(params.special_filter || '').trim() ||
    pathMode === 'myfiles' ||
    pathMode === 'votingqueue' ||
    requestedSort === 'mysubscriptions';
}

function steamKitPersonalListType(params = {}) {
  const browseFilter = String(params.browsefilter || '').trim().toLowerCase();
  if (browseFilter === 'mysubscriptions' || browseFilter === 'myfavorites') return browseFilter;
  return '';
}

function steamIdFromCommunityCookie(cookieHeader) {
  for (const part of String(cookieHeader || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0 || part.slice(0, separator).trim().toLowerCase() !== 'steamloginsecure') continue;
    const raw = part.slice(separator + 1).trim();
    let decoded = raw;
    try { decoded = decodeURIComponent(raw); } catch {}
    const steamId = normalizeSteamId(String(decoded).split('||')[0]);
    if (steamId) return steamId;
  }
  return '';
}

function steamAccountCacheKey(cookieHeader) {
  const cookie = String(cookieHeader || '').trim();
  if (!cookie) return 'anonymous';
  const steamId = steamIdFromCommunityCookie(cookie);
  if (steamId) return steamId;
  return `cookie-${crypto.createHash('sha256').update(cookie).digest('hex').slice(0, 16)}`;
}

function steamAccountCacheKeyForRun(runOptions = {}) {
  const explicit = String(runOptions.steamAccountKey || '').trim();
  return explicit || steamAccountCacheKey(runOptions.steamCommunityCookie);
}

function sourceParamsForScrape(params) {
  const next = Object.assign({}, params || {});
  for (const key of Object.keys(params || {})) {
    if (/^requiredtags(?:\[\d+\])?$/.test(key)) delete next[key];
  }
  const kept = collectArrayLikeParams(params, 'requiredtags')
    .filter(tag => tag.toLowerCase() !== 'mobile');
  const seen = new Set();
  kept.filter(tag => {
    const normalized = tag.toLowerCase();
    if (seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  }).forEach((tag, index) => { next[`requiredtags[${index}]`] = tag; });
  return next;
}

function resolveSourceSelection(params, runOptions = {}, options = {}) {
  const configuredSource = ['community', 'webapi', 'cm'].includes(String(runOptions.steamDataSource || '').trim().toLowerCase())
    ? String(runOptions.steamDataSource).trim().toLowerCase()
    : 'community';
  const accountSessionRequired = requiresSteamCommunitySession(params);
  const steamKitPersonalType = steamKitPersonalListType(params);
  const steamApiKey = String(options.getSteamApiKey() || '').trim();
  const needsConfiguredQuerySource = !normalizeWorkshopIdSearch(params.workshop_id || params.search_text || '');
  if (configuredSource === 'webapi' && needsConfiguredQuerySource && !steamApiKey) {
    const error = new Error('Steam Web API 模式需要有效的 API Key，请先在 Steam 相关设置中配置');
    error.code = 'STEAM_WEB_API_KEY_REQUIRED';
    error.statusCode = 400;
    throw error;
  }
  if (configuredSource === 'cm' && needsConfiguredQuerySource && (!options.querySteamKitWorkshop || !runOptions.steamKitQueryAvailable)) {
    const error = new Error('Steam CM 模式需要有效的 SteamKit 登录会话，请重新登录 Steam 后重试');
    error.code = 'STEAM_CM_LOGIN_REQUIRED';
    error.statusCode = 401;
    error.requiresSteamLogin = true;
    throw error;
  }
  const communitySessionRequired = configuredSource === 'community' && accountSessionRequired;
  const effectiveRunOptions = runOptions;
  if (communitySessionRequired && !String(effectiveRunOptions.steamCommunityCookie || '').trim()) {
    const error = new Error('个人筛选需要先通过 WallHub 的 Steam 页面登录 Steam Web 会话');
    error.code = 'STEAM_WEB_LOGIN_REQUIRED';
    error.requiresSteamLogin = true;
    throw error;
  }
  if (communitySessionRequired) {
    const steamId = steamIdFromCommunityCookie(effectiveRunOptions.steamCommunityCookie);
    if (steamId) params.profileSteamId = steamId;
  }

  return {
    runOptions: effectiveRunOptions,
    configuredSource,
    steamApiKey,
    querySteamApiKey: configuredSource === 'webapi' ? steamApiKey : '',
    steamKitPersonalType,
    useSteamKitUserFiles: false,
  };
}

module.exports = {
  STEAM_WORKSHOP_ACCESSIBLE_ITEMS,
  STEAM_WORKSHOP_ACCESSIBLE_PAGES,
  accessibleWorkshopTotal,
  accessibleWorkshopPages,
  pageBeyondAccessibleWorkshopTotal,
  requiresSteamCommunitySession,
  resolveSourceSelection,
  sourceParamsForScrape,
  steamAccountCacheKey,
  steamAccountCacheKeyForRun,
  steamIdFromCommunityCookie,
  steamKitPersonalListType,
};
