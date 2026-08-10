'use strict';

const { createStaticHandler } = require('../static');
const { createAppRouter } = require('../router');
const { createDownloadVideoHandlers } = require('./downloadVideo');
const { createOnboardingHandlers } = require('./onboarding');
const { createRuntimeHandlers } = require('./runtime');
const { createServerControlHandlers } = require('./serverControl');
const { createSettingsHandlers } = require('./settings');
const { createSteamSessionHandlers } = require('./steamSession');
const { createUpdateHandlers } = require('./update');

function composeHttpHandlers(config) {
  const runtimeHandlers = createRuntimeHandlers(config.runtimeHandlers);
  const updateHandlers = createUpdateHandlers(config.updateHandlers);
  const onboardingHandlers = createOnboardingHandlers(config.onboardingHandlers);
  const steamSessionHandlers = createSteamSessionHandlers(config.steamSessionHandlers);
  const settingsHandlers = createSettingsHandlers(config.settingsHandlers);
  const downloadVideoHandlers = createDownloadVideoHandlers(config.downloadVideoHandlers);
  const serverControlHandlers = createServerControlHandlers(config.serverControlHandlers);
  const serveStatic = createStaticHandler(config.staticHandler);
  const routeHttpRequest = createAppRouter({
    jsonRes: config.router.jsonRes,
    send: config.router.send,
    virtualHostParam: config.router.virtualHostParam,
    isWallhubProxyVirtualSteamPath: config.router.isWallhubProxyVirtualSteamPath,
    ...config.router.steamProxyHandlers,
    ...runtimeHandlers,
    ...onboardingHandlers,
    ...updateHandlers,
    ...serverControlHandlers,
    handleInternalSteamResolve: config.router.handleInternalSteamResolve,
    handleInternalSteamWebApi: config.router.handleInternalSteamWebApi,
    ...config.router.workshopHandlers,
    ...downloadVideoHandlers,
    listCachedItems: config.router.listCachedItems,
    ...steamSessionHandlers,
    ...settingsHandlers,
    serveStatic,
  });

  return config.requestHandler.tracker.createHandler({
    jsonRes: config.requestHandler.jsonRes,
    isAllowedHost: config.requestHandler.isAllowedHost,
    getUpdateInstallPending: config.requestHandler.getUpdateInstallPending,
    routeHttpRequest,
  });
}

module.exports = { composeHttpHandlers };
