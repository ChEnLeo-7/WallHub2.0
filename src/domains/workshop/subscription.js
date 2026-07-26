'use strict';

const WALLPAPER_ENGINE_APP_ID = 431960;

function normalizePublishedFileId(value) {
  const id = String(value || '').replace(/[^\d]/g, '');
  return /^\d{6,20}$/.test(id) ? id : '';
}

function cookieValue(cookieHeader, name) {
  const target = String(name || '').trim().toLowerCase();
  for (const part of String(cookieHeader || '').split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim().toLowerCase() !== target) continue;
    const raw = part.slice(separator + 1).trim();
    try { return decodeURIComponent(raw); } catch { return raw; }
  }
  return '';
}

function steamLoginRequired(message = 'Steam Community 登录会话不可用，请重新登录') {
  const error = new Error(message);
  error.code = 'STEAM_WEB_LOGIN_REQUIRED';
  error.statusCode = 401;
  error.requiresSteamLogin = true;
  return error;
}

function isSteamLoginResponse(raw) {
  const text = String(raw || '');
  return /window\.UserConfig\s*=\s*\{[^}]*["']logged_in["']\s*:\s*false/i.test(text) ||
    /["']logged_in["']\s*:\s*false/i.test(text) ||
    /\bg_steamID\s*=\s*false\b/i.test(text) ||
    /<form\b[^>]*(?:id|class)=["'][^"']*(?:login_form|loginbox)[^"']*["']/i.test(text);
}

function parseSubscriptionResponse(payload, operation = 'subscribe') {
  const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload || '');
  if (isSteamLoginResponse(raw)) {
    throw steamLoginRequired('Steam Community 登录会话已失效，请重新登录');
  }
  let data;
  try { data = JSON.parse(raw); }
  catch {
    const isFavorite = operation === 'favorite' || operation === 'unfavorite';
    const error = new Error(isFavorite ? 'Steam 未返回有效的收藏结果' : 'Steam 未返回有效的订阅结果');
    error.code = isFavorite ? 'STEAM_FAVORITE_INVALID_RESPONSE' : 'STEAM_SUBSCRIBE_INVALID_RESPONSE';
    error.statusCode = 502;
    throw error;
  }
  const success = data && (data.success === true || data.success === 1 || data.success === '1');
  if (!success) {
    const isFavorite = operation === 'favorite' || operation === 'unfavorite';
    const error = new Error(String(data && (data.error || data.message || data.err_msg) || (isFavorite ? 'Steam 拒绝了收藏请求' : 'Steam 拒绝了订阅请求')));
    error.code = String(data && (data.code || data.eresult) || (isFavorite ? 'STEAM_FAVORITE_FAILED' : 'STEAM_SUBSCRIBE_FAILED'));
    error.statusCode = 502;
    throw error;
  }
  return data;
}

function elementHasClass(raw, id, className) {
  const escapedId = String(id || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tag = String(raw || '').match(new RegExp(`<[^>]*\\bid=["']${escapedId}["'][^>]*>`, 'i'));
  if (!tag) return null;
  const classes = tag[0].match(/\bclass=["']([^"']*)["']/i);
  if (!classes) return false;
  return new RegExp(`(?:^|\\s)${className}(?:\\s|$)`, 'i').test(classes[1]);
}

function parseSubscriptionStatus(payload) {
  const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload || '');
  if (isSteamLoginResponse(raw)) {
    throw steamLoginRequired('Steam Community 登录会话已失效，请重新登录');
  }
  const state = raw.match(/["']subscribed["']\s*:\s*(true|false|1|0)/i);
  if (state) return /^(?:true|1)$/i.test(state[1]);
  if (elementHasClass(raw, 'SubscribeItemOptionSubscribed', 'selected')) return true;
  if (elementHasClass(raw, 'SubscribeItemOptionAdd', 'selected')) return false;
  const error = new Error('Steam 未返回有效的订阅状态');
  error.code = 'STEAM_SUBSCRIPTION_STATUS_INVALID_RESPONSE';
  error.statusCode = 502;
  throw error;
}

function parseFavoriteStatus(payload) {
  const raw = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload || '');
  if (isSteamLoginResponse(raw)) {
    throw steamLoginRequired('Steam Community 登录会话已失效，请重新登录');
  }
  if (elementHasClass(raw, 'FavoriteItemOptionFavorited', 'selected')) return true;
  if (elementHasClass(raw, 'FavoriteItemBtn', 'toggled')) return true;
  if (elementHasClass(raw, 'FavoriteItemOptionAdd', 'selected')) return false;
  if (elementHasClass(raw, 'FavoriteItemBtn', 'toggled') === false) return false;
  const error = new Error('Steam 未返回有效的收藏状态');
  error.code = 'STEAM_FAVORITE_STATUS_INVALID_RESPONSE';
  error.statusCode = 502;
  throw error;
}

function createWorkshopSubscriptionService(options = {}) {
  const get = options.get;
  const post = options.post;
  const getCommunityCookie = options.getCommunityCookie || (async () => '');

  async function requestStatusPage(id, communityCookie) {
    if (typeof get !== 'function') throw new Error('Steam subscription GET dependency missing');
    return get(
      `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
      {
        Cookie: communityCookie,
        Referer: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
        Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        steamAccessRouteOptions: {
          requireApplicationProbe: true,
          connectionReuse: false,
          backgroundRefresh: true,
          maxAgeMs: 5 * 60 * 1000,
        },
      },
      22000,
    );
  }

  async function updateWorkshopState(publishedFileId, action, runOptions = {}) {
    const operation = ['subscribe', 'unsubscribe', 'favorite', 'unfavorite'].includes(action) ? action : 'subscribe';
    if (typeof post !== 'function') throw new Error('Steam subscription POST dependency missing');
    const id = normalizePublishedFileId(publishedFileId);
    if (!id) {
      const error = new Error('无效的 Wallpaper Workshop 项目 ID');
      error.code = 'INVALID_WORKSHOP_ID';
      error.statusCode = 400;
      throw error;
    }
    const communityCookies = Array.from(new Set([
      String(await getCommunityCookie() || '').trim(),
      String(runOptions.steamCommunityCookie || '').trim(),
    ].filter(Boolean)));
    let lastLoginError = null;
    for (const communityCookie of communityCookies) {
      const sessionId = cookieValue(communityCookie, 'sessionid');
      if (!sessionId) continue;
      const body = new URLSearchParams({
        id,
        appid: String(WALLPAPER_ENGINE_APP_ID),
        sessionid: sessionId,
      }).toString();
      try {
        const response = await post(
          `https://steamcommunity.com/sharedfiles/${operation}`,
          body,
          22000,
          {
            Cookie: communityCookie,
            Origin: 'https://steamcommunity.com',
            Referer: `https://steamcommunity.com/sharedfiles/filedetails/?id=${id}`,
            'X-Requested-With': 'XMLHttpRequest',
            Accept: 'application/json, text/javascript, */*; q=0.01',
            steamAccessRouteOptions: {
              requireApplicationProbe: true,
              connectionReuse: false,
              backgroundRefresh: true,
              maxAgeMs: 5 * 60 * 1000,
            },
          },
        );
        try {
          parseSubscriptionResponse(response, operation);
        } catch (error) {
          if (error && error.requiresSteamLogin) throw error;
          if (operation !== 'favorite' && operation !== 'unfavorite') throw error;

          // Steam has served both JSON and empty/HTML success responses for these
          // form endpoints. Verify the resulting state before accepting the latter.
          let verification;
          try {
            verification = await requestStatusPage(id, communityCookie);
          } catch {
            throw error;
          }
          if (parseFavoriteStatus(verification) !== (operation === 'favorite')) throw error;
        }
        const messages = {
          subscribe: '已向 Steam 提交订阅请求',
          unsubscribe: '已向 Steam 提交取消订阅请求',
          favorite: '已向 Steam 提交收藏请求',
          unfavorite: '已向 Steam 提交取消收藏请求',
        };
        return {
          success: true,
          id,
          appid: WALLPAPER_ENGINE_APP_ID,
          message: messages[operation],
        };
      } catch (error) {
        if (!error || !error.requiresSteamLogin) throw error;
        lastLoginError = error;
      }
    }
    throw lastLoginError || steamLoginRequired();
  }

  async function status(publishedFileId, runOptions = {}) {
    if (typeof get !== 'function') throw new Error('Steam subscription GET dependency missing');
    const id = normalizePublishedFileId(publishedFileId);
    if (!id) {
      const error = new Error('无效的 Wallpaper Workshop 项目 ID');
      error.code = 'INVALID_WORKSHOP_ID';
      error.statusCode = 400;
      throw error;
    }
    const communityCookies = Array.from(new Set([
      String(await getCommunityCookie() || '').trim(),
      String(runOptions.steamCommunityCookie || '').trim(),
    ].filter(Boolean)));
    let lastLoginError = null;
    for (const communityCookie of communityCookies) {
      try {
        const response = await requestStatusPage(id, communityCookie);
        return {
          success: true,
          id,
          appid: WALLPAPER_ENGINE_APP_ID,
          subscribed: parseSubscriptionStatus(response),
          favorited: parseFavoriteStatus(response),
        };
      } catch (error) {
        if (!error || !error.requiresSteamLogin) throw error;
        lastLoginError = error;
      }
    }
    throw lastLoginError || steamLoginRequired();
  }

  return {
    subscribe: (publishedFileId, runOptions) => updateWorkshopState(publishedFileId, 'subscribe', runOptions),
    unsubscribe: (publishedFileId, runOptions) => updateWorkshopState(publishedFileId, 'unsubscribe', runOptions),
    favorite: (publishedFileId, runOptions) => updateWorkshopState(publishedFileId, 'favorite', runOptions),
    unfavorite: (publishedFileId, runOptions) => updateWorkshopState(publishedFileId, 'unfavorite', runOptions),
    status,
  };
}

module.exports = {
  WALLPAPER_ENGINE_APP_ID,
  normalizePublishedFileId,
  cookieValue,
  parseSubscriptionResponse,
  parseSubscriptionStatus,
  parseFavoriteStatus,
  createWorkshopSubscriptionService,
};
