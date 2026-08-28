'use strict';

function assembleWorkshopServices(scope) {
  const { createWorkshopHandlers } = scope.require('./src/app/handlers/workshop');
  const { jsonRes, readBody } = scope.require('./src/app/http');
  const { isAndroidHostLikeEnv } = scope.require('./src/config/platform');
  const workshopText = scope.require('./src/domains/workshop/text');

  scope.WORKSHOP_HANDLERS = createWorkshopHandlers({
    jsonRes,
    readBody,
    get: scope.GET,
    post: scope.POST,
    doRequest: scope.doRequest,
    userAgent: scope.UA,
    steamPrefCookie: scope.STEAM_PREF_COOKIE,
    isAndroidHostLikeEnv,
    getSteamApiKey: scope.getSteamApiKey,
    getSteamDataSource: scope.getSteamDataSource,
    getSteamWebApiBaseUrl: scope.getSteamWebApiBaseUrl,
    querySteamKitUserFiles: scope.querySteamKitUserFiles,
    querySteamKitWorkshop: scope.querySteamKitWorkshop,
    steamAccessGatewayEnabled: scope.steamAccessGatewayEnabled,
    getSteamAccessMode: () => scope.state.videoCacheSettings.wallhubSteamAccessMode,
    nsfwEnabled: () => scope.NSFW_ENABLED,
    isSteamAccessGatewayWarmingUp: scope.isSteamAccessGatewayWarmingUp,
    ensureSteamAccessGatewayReady: scope.ensureSteamAccessGatewayReady,
    upstreamCookie: scope.wallhubProxyUpstreamCookie,
    resolveSteamKitCommunityCookie: scope.resolveSteamKitCommunityCookie,
    steamKitPersistentLoginIsUsable: scope.steamKitPersistentLoginIsUsable,
    effectiveDownloaderMode: scope.effectiveDownloaderMode,
    cachedSteamLoginUsername: scope.cachedSteamLoginUsername,
    logger: scope.debugLogger,
  });
  scope.getFileDetails = scope.WORKSHOP_HANDLERS.getFileDetails;
  scope.fmtBytes = workshopText.fmtBytes;
  scope.cleanText = workshopText.cleanText;
  scope.getWorkshopContentDir = () => scope.state.downloadsDir;
  scope.workshopTypeFromDetails = details => {
    const tags = Array.isArray(details && details.tags) ? details.tags : [];
    const values = tags.map(tag => String((tag && tag.tag) || tag || '').trim().toLowerCase());
    if (values.includes('video')) return 'Video';
    if (values.includes('web')) return 'Web';
    if (values.includes('application')) return 'Application';
    return 'Scene';
  };
  scope.detectVideoTag = details => scope.workshopTypeFromDetails(details) === 'Video';
}

module.exports = { assembleWorkshopServices };
