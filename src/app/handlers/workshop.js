'use strict';

const { createSteamPersonaService } = require('../../domains/steam/persona');
const { createWorkshopCommentsService } = require('../../domains/workshop/comments');
const { createWorkshopDetailService } = require('../../domains/workshop/detail');
const { createPublishedFileDetailsService } = require('../../domains/workshop/fileDetails');
const {
  createWorkshopSearchService,
  mapWorkshopItem,
  requiresSteamCommunitySession,
} = require('../../domains/workshop/search');
const { parseFriendFavoriteSteamIds, buildPersonalSourceLabel } = require('../../domains/workshop/personalSource');
const { createWorkshopSubscriptionService } = require('../../domains/workshop/subscription');

function createWorkshopHandlers(options = {}) {
  const {
    jsonRes,
    readBody,
    get,
    post,
    doRequest,
    userAgent,
    steamPrefCookie,
    isAndroidHostLikeEnv,
    getSteamApiKey,
    getSteamDataSource = () => 'community',
    getSteamWebApiBaseUrl,
    querySteamKitUserFiles,
    querySteamKitWorkshop,
    steamAccessGatewayEnabled,
    getSteamAccessMode,
    nsfwEnabled,
    isSteamAccessGatewayWarmingUp,
    ensureSteamAccessGatewayReady,
    upstreamCookie,
    resolveSteamKitCommunityCookie,
    steamKitPersistentLoginIsUsable,
    effectiveDownloaderMode,
    cachedSteamLoginUsername,
    logger = console,
  } = options;

  const fileDetailsService = createPublishedFileDetailsService({
    post,
    getSteamWebApiBaseUrl,
    logger,
  });
  const commentsService = createWorkshopCommentsService({
    doRequest,
    userAgent,
    steamPrefCookie,
    logger,
    isAndroidHostLikeEnv,
  });
  const personaService = createSteamPersonaService({ get, logger });
  const subscriptionService = createWorkshopSubscriptionService({
    get,
    post,
    getCommunityCookie: resolveSteamKitCommunityCookie,
  });
  let searchService = null;
  let detailService = null;
  let rejectedProxyCommunityCookie = '';

  function getFileDetails(ids, timeoutMs) {
    return fileDetailsService.get(ids, timeoutMs);
  }

  function getFileDetailsSafe(ids, runOptions) {
    return fileDetailsService.getSafe(ids, runOptions);
  }

  function getSearchService() {
    if (!searchService) {
      searchService = createWorkshopSearchService({
        get,
        getFileDetailsSafe,
        getSteamApiKey,
        getSteamWebApiBaseUrl,
        querySteamKitUserFiles,
        querySteamKitWorkshop,
        steamAccessGatewayEnabled,
        getSteamAccessMode,
        isAndroidHostLikeEnv,
        nsfwEnabled,
        logger,
      });
    }
    return searchService;
  }

  function resolvePersonaName(steamId) {
    return personaService.resolveName(steamId);
  }

  function fetchWorkshopCommentsPage(id, start, count, ownerId) {
    return commentsService.fetchPage(id, start, count, ownerId);
  }

  function getDetailService() {
    if (!detailService) {
      detailService = createWorkshopDetailService({
        get,
        getFileDetails,
        fetchCommentsPage: fetchWorkshopCommentsPage,
        resolvePersonaName,
        isAndroidHostLikeEnv,
        logger,
      });
    }
    return detailService;
  }

  async function handleQuery(req, res) {
    let payload;
    try { payload = JSON.parse(await readBody(req)); }
    catch { return jsonRes(res, 400, { error: 'Bad JSON' }); }

    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    let finished = false;
    const abortSearch = () => {
      if (!finished && controller && typeof controller.abort === 'function') controller.abort();
    };
    res.on('close', abortSearch);

    try {
      const params = payload.params || {};
      const steamDataSource = getSteamDataSource();
      if (steamDataSource !== 'community' && steamAccessGatewayEnabled() && !isSteamAccessGatewayWarmingUp()) {
        await ensureSteamAccessGatewayReady('query-core', 1500);
      }
      const resolvedProxyCommunityCookie = upstreamCookie(req.headers.cookie || '', 'steamcommunity.com');
      const proxyCommunityCookie = resolvedProxyCommunityCookie === rejectedProxyCommunityCookie
        ? ''
        : resolvedProxyCommunityCookie;
      const steamKitQueryAvailable = steamDataSource === 'cm' && steamKitPersistentLoginIsUsable() && effectiveDownloaderMode() === 'steamkit';
      let steamCommunityCookie = '';
      let steamKitCommunityCookie = '';
      const prepareSteamCommunityCookie = async () => {
        steamKitCommunityCookie = await resolveSteamKitCommunityCookie();
        steamCommunityCookie = steamKitCommunityCookie || proxyCommunityCookie;
        if (steamKitCommunityCookie) logger.log('[Query] Using Steam community cookie from SteamKit session');
        else if (proxyCommunityCookie) logger.log('[Query] Using Steam community cookie from WallHub proxy session');
        else logger.warn('[Query] Steam community cookie unavailable; using anonymous community page request');
      };
      if (steamDataSource === 'community') await prepareSteamCommunityCookie();
      if (steamDataSource === 'community' && steamKitPersistentLoginIsUsable() && !steamCommunityCookie) {
        const error = new Error('Steam Community 登录会话不可用，请重新登录 Steam 后重试');
        error.code = 'STEAM_WEB_LOGIN_REQUIRED';
        error.statusCode = 401;
        error.requiresSteamLogin = true;
        throw error;
      }

      let result;
      try {
        result = await getSearchService().search(params, {
          steamCommunityCookie,
          steamAccountKey: steamDataSource === 'cm' ? `steamkit:${cachedSteamLoginUsername()}` : '',
          steamKitQueryAvailable,
          steamDataSource,
          signal: controller ? controller.signal : undefined,
        });
      } catch (error) {
        const canRetryProxyCookie = error && error.code === 'STEAM_WEB_LOGIN_REQUIRED' &&
          steamKitCommunityCookie && proxyCommunityCookie && proxyCommunityCookie !== steamKitCommunityCookie;
        if (canRetryProxyCookie) {
          logger.warn('[Query] SteamKit Web cookie was rejected; retrying once with WallHub proxy session cookie');
          result = await getSearchService().search(params, {
            steamCommunityCookie: proxyCommunityCookie,
            steamKitQueryAvailable,
            steamDataSource,
            signal: controller ? controller.signal : undefined,
          });
        } else {
          const canRetryAnonymous = error && error.code === 'STEAM_WEB_LOGIN_REQUIRED' &&
            steamDataSource === 'community' && !steamKitCommunityCookie && proxyCommunityCookie &&
            !steamKitPersistentLoginIsUsable() && !requiresSteamCommunitySession(params);
          if (!canRetryAnonymous) throw error;
          rejectedProxyCommunityCookie = proxyCommunityCookie;
          logger.warn('[Query] WallHub proxy session cookie was rejected; retrying public Community query anonymously');
          result = await getSearchService().search(params, {
            steamCommunityCookie: '',
            steamKitQueryAvailable,
            steamDataSource,
            signal: controller ? controller.signal : undefined,
          });
        }
      }
      finished = true;
      jsonRes(res, 200, result);
    } catch (error) {
      if (error && error.code === 'ABORT_ERR') {
        finished = true;
        return jsonRes(res, 409, { error: 'Search aborted by settings change', aborted: true });
      }
      if (error && error.code === 'STEAM_WEB_LOGIN_REQUIRED') {
        finished = true;
        return jsonRes(res, 401, {
          error: error.message,
          code: error.code,
          requiresSteamLogin: true,
        });
      }
      logger.error('[Query Error]', error.message);
      finished = true;
      jsonRes(res, error.statusCode || 502, { error: error.message, code: error.code || '' });
    } finally {
      res.off('close', abortSearch);
    }
  }

  async function handleDetails(res, id) {
    jsonRes(res, 200, await getDetailService().fetchDetail(id));
  }

  async function handlePersonalSource(req, res, id, personalFilter) {
    const publishedFileId = String(id || '').replace(/[^\d]/g, '');
    const filter = String(personalFilter || '').trim().toLowerCase();
    const allowed = new Set(['mysubscriptions', 'myfavorites', 'voted', 'friendsfavorites', 'friendscreated', 'followedcreated']);
    if (!publishedFileId || !allowed.has(filter)) return jsonRes(res, 400, { error: 'Invalid personal source request' });

    try {
      if (filter === 'mysubscriptions' || filter === 'myfavorites' || filter === 'voted') {
        return jsonRes(res, 200, { filter, label: buildPersonalSourceLabel(filter) });
      }
      if (filter === 'friendscreated' || filter === 'followedcreated') {
        const detail = await getDetailService().fetchDetail(publishedFileId);
        return jsonRes(res, 200, {
          filter,
          label: buildPersonalSourceLabel(filter, { author: detail && detail.author }),
          names: detail && detail.author ? [detail.author] : [],
        });
      }

      const proxyCommunityCookie = upstreamCookie(req.headers.cookie || '', 'steamcommunity.com');
      const steamKitCommunityCookie = await resolveSteamKitCommunityCookie();
      const steamCommunityCookie = steamKitCommunityCookie || proxyCommunityCookie;
      if (!steamCommunityCookie) {
        return jsonRes(res, 200, {
          filter,
          label: buildPersonalSourceLabel(filter),
          names: [],
          warningCode: 'STEAM_WEB_LOGIN_REQUIRED',
        });
      }
      const actionUrl = new URL('https://steamcommunity.com/workshop/actions');
      actionUrl.searchParams.set('q', 'GetFriendsWhoFavoritedItem');
      actionUrl.searchParams.set('qp', JSON.stringify([431960, publishedFileId]));
      const payload = (await get(actionUrl.toString(), {
        Cookie: steamCommunityCookie,
        Accept: 'application/json, text/plain, */*',
        'x-valve-request-type': 'queryAction',
        steamAccessRouteOptions: {
          requireApplicationProbe: true,
          connectionReuse: false,
          backgroundRefresh: true,
          maxAgeMs: 5 * 60 * 1000,
        },
      }, 22000)).toString('utf8');
      const steamIds = parseFriendFavoriteSteamIds(payload);
      const resolvedNames = await Promise.all(steamIds.slice(0, 6).map(steamId => resolvePersonaName(steamId).catch(() => '')));
      const names = resolvedNames.map(name => String(name || '').trim()).filter(Boolean);
      return jsonRes(res, 200, {
        filter,
        label: buildPersonalSourceLabel(filter, { names }),
        names,
        steamIds,
      });
    } catch (error) {
      logger.warn(`[PersonalSource] ${filter} ${publishedFileId} failed: ${error.message}`);
      return jsonRes(res, 200, {
        filter,
        label: buildPersonalSourceLabel(filter),
        names: [],
        warningCode: 'PERSONAL_SOURCE_UNAVAILABLE',
      });
    }
  }

  async function handleDetailsBatch(req, res) {
    let payload;
    try { payload = JSON.parse(await readBody(req)); }
    catch { return jsonRes(res, 400, { error: 'Bad JSON' }); }
    const ids = Array.from(new Set((payload.ids || [])
      .map(value => String(value || '').replace(/[^\d]/g, ''))
      .filter(Boolean))).slice(0, 60);
    if (!ids.length) return jsonRes(res, 200, { items: [] });
    try {
      const details = await getFileDetailsSafe(ids);
      const detailMap = {};
      details.forEach(detail => {
        if (detail && String(detail.result || '') === '1' && detail.publishedfileid) {
          detailMap[String(detail.publishedfileid)] = detail;
        }
      });
      jsonRes(res, 200, {
        items: ids.filter(id => detailMap[id]).map(id => mapWorkshopItem(id, detailMap[id], {})),
      });
    } catch (error) {
      logger.warn('[FileDetails Batch API]', error.message);
      jsonRes(res, 200, { items: [] });
    }
  }

  async function handleCommentsPage(res, id, start, count, ownerId) {
    jsonRes(res, 200, await fetchWorkshopCommentsPage(id, start, count, ownerId));
  }

  async function handleSteamSubscription(req, res, action) {
    let payload;
    try { payload = JSON.parse(await readBody(req)); }
    catch { return jsonRes(res, 400, { error: 'Bad JSON' }); }
    const operation = ['subscribe', 'unsubscribe', 'favorite', 'unfavorite'].includes(action) ? action : 'subscribe';
    try {
      const steamCommunityCookie = upstreamCookie(req.headers.cookie || '', 'steamcommunity.com');
      jsonRes(res, 200, await subscriptionService[operation](payload.id, { steamCommunityCookie }));
    } catch (error) {
      const fallbackErrors = {
        subscribe: ['Steam 订阅请求失败', 'STEAM_SUBSCRIBE_FAILED'],
        unsubscribe: ['Steam 取消订阅请求失败', 'STEAM_UNSUBSCRIBE_FAILED'],
        favorite: ['Steam 收藏请求失败', 'STEAM_FAVORITE_FAILED'],
        unfavorite: ['Steam 取消收藏请求失败', 'STEAM_UNFAVORITE_FAILED'],
      };
      const fallback = fallbackErrors[operation];
      jsonRes(res, Number(error && error.statusCode) || 502, {
        error: error && error.message ? error.message : fallback[0],
        code: error && error.code ? error.code : fallback[1],
        requiresSteamLogin: !!(error && error.requiresSteamLogin),
      });
    }
  }

  async function handleSteamSubscriptionStatus(req, res, id) {
    try {
      const steamCommunityCookie = upstreamCookie(req.headers.cookie || '', 'steamcommunity.com');
      jsonRes(res, 200, await subscriptionService.status(id, { steamCommunityCookie }));
    } catch (error) {
      jsonRes(res, Number(error && error.statusCode) || 502, {
        error: error && error.message ? error.message : 'Steam 订阅状态查询失败',
        code: error && error.code ? error.code : 'STEAM_SUBSCRIPTION_STATUS_FAILED',
        requiresSteamLogin: !!(error && error.requiresSteamLogin),
      });
    }
  }

  return {
    getFileDetails,
    getFileDetailsSafe,
    clearCaches: () => searchService?.clearCaches?.(),
    handleQuery,
    handleDetails,
    handlePersonalSource,
    handleDetailsBatch,
    handleCommentsPage,
    handleSteamSubscribe: (req, res) => handleSteamSubscription(req, res, 'subscribe'),
    handleSteamUnsubscribe: (req, res) => handleSteamSubscription(req, res, 'unsubscribe'),
    handleSteamFavorite: (req, res) => handleSteamSubscription(req, res, 'favorite'),
    handleSteamUnfavorite: (req, res) => handleSteamSubscription(req, res, 'unfavorite'),
    handleSteamSubscriptionStatus,
  };
}

module.exports = { createWorkshopHandlers };
