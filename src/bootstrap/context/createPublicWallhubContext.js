'use strict';

function createPublicWallhubContext(scope) {
  const { send, jsonRes, readBody } = scope.require('./src/app/http');
  const { mimeType } = scope.require('./src/shared/mime');
  const { isTermuxLikeEnv } = scope.require('./src/config/platform');
  const { truncateClientEventValue, shouldLogClientEvent } = scope.require('./src/domains/clientEvents');
  const { createStartupOnboardingSession } = scope.require('./src/domains/onboarding/session');
  const { isSteamAccessGatewayHost, isSteamStaticCdnHost } = scope.require('./src/domains/steam/hosts');
  const { isAllowedWallhubHost, isWallhubReadAllowed, isUpdateMutationAllowed } = scope.require('./src/domains/updates/service');

  function persistOnboardingCompletion({ payload, result, session }) {
    if (scope.state.videoCacheSettings.wallhubOnboardingCompletedAt) return;
    const previousSettings = scope.state.videoCacheSettings;
    scope.getRuntimeSettings().setState(previousSettings);
    const patch = {
      ...(payload.networkDecision === 'enhanced' ? session.testedNetworkSettings() || {} : {}),
      wallhubSteamAccessEnhance: payload.networkDecision === 'enhanced',
    };
    scope.state.videoCacheSettings = Object.assign({}, scope.getRuntimeSettings().applyPatch(patch).settings, {
      wallhubOnboardingCompletedAt: result.completedAt,
    });
    if (scope.saveCacheSettingsChecked()) return;
    scope.state.videoCacheSettings = previousSettings;
    scope.getRuntimeSettings().setState(previousSettings);
    scope.CACHE_SETTINGS_STORE.setState(previousSettings);
    const error = new Error('无法保存启动引导设置，请检查配置文件权限后重试');
    error.code = 'ONBOARDING_SAVE_FAILED';
    error.statusCode = 500;
    throw error;
  }

  function createHttpCompositionConfig(controls = {}) {
    return {
      staticHandler: { publicDir: scope.PUBLIC, send, mimeType },
      runtimeHandlers: {
        jsonRes,
        send,
        get: scope.GET,
        isDockerLikeEnv: controls.isDockerLikeEnv,
        isTermuxLikeEnv,
        runtimeSetupSnapshot: scope.runtimeSetupSnapshot,
        steamCdnStatusSnapshot: scope.steamCdnStatusSnapshot,
        steamAccessRuntimeSnapshot: scope.steamAccessRuntimeSnapshot,
        steamAccessDiagnosticSnapshot: scope.steamAccessDiagnosticSnapshot,
        steamKitDepotStreamingEnabled: scope.steamKitDepotStreamingEnabled,
        getDepotStreamWorkerCount: () => scope.getDepotStreamService().workers.size,
        getDepotStreamCacheMaxMb: scope.getDepotStreamCacheMaxMb,
        updateService: scope.UPDATE_SERVICE,
        platform: process.platform,
        arch: process.arch,
        supervised: scope.IS_SUPERVISOR_CHILD,
        version: scope.PACKAGE_JSON.version,
        getDownloaderMode: scope.getDownloaderMode,
        nsfwEnabled: scope.NSFW_ENABLED,
        getDownloadsDir: () => scope.state.downloadsDir,
        resolveDepotDownloaderPath: scope.resolveDepotDownloaderPath,
        depotStreamCacheDir: scope.DEPOT_STREAM_CACHE_DIR,
        depotStreamFirstRangeBytes: scope.DEPOT_STREAM_FIRST_RANGE_BYTES,
        depotStreamMaxRangeBytes: scope.DEPOT_STREAM_MAX_RANGE_BYTES,
        ensureSteamAccessGatewayReady: scope.ensureSteamAccessGatewayReady,
        steamAccessGatewayEnabled: scope.steamAccessGatewayEnabled,
      },
      updateHandlers: {
        jsonRes,
        isMutationAllowed: isUpdateMutationAllowed,
        updateService: scope.UPDATE_SERVICE,
      },
      onboardingHandlers: {
        jsonRes,
        readBody,
        isReadAllowed: isWallhubReadAllowed,
        isMutationAllowed: isUpdateMutationAllowed,
        getSession: () => scope.state.startupOnboarding,
        getSettings: () => scope.state.videoCacheSettings,
        getSteamAccessExperimental: () => scope.getRuntimeSettings().getSteamAccessExperimental(),
        hostsUpdater: scope.STEAM_ACCESS_HOSTS_UPDATER,
        configDir: scope.STEAMKIT_CONFIG_DIR,
        isGatewayHost: isSteamAccessGatewayHost,
        isStaticCdnHost: isSteamStaticCdnHost,
        requestDirect: scope.GET,
        userAgent: scope.UA,
        getCachedUsername: scope.cachedSteamLoginUsername,
        isLoginUsable: scope.steamKitPersistentLoginIsUsable,
        checkAppOwnership: (username, appId) => scope.getSteamKitLoginService().checkAppOwnership(username, appId),
        normalizeLoginError: scope.normalizeDepotError,
        setAppOwnership: value => { scope.steamAppOwnership = value; },
        persistCompletion: persistOnboardingCompletion,
        clearGateway: () => scope.STEAM_ACCESS_GATEWAY.clear(),
        clearWorkshopCaches: scope.WORKSHOP_HANDLERS.clearCaches,
        scheduleHostsUpdate: () => scope.STEAM_ACCESS_HOSTS_UPDATER.schedule(),
        logger: console,
      },
      steamSessionHandlers: {
        jsonRes,
        readBody,
        credentials: scope.STEAM_CREDENTIALS,
        getOwnership: () => scope.steamAppOwnership,
        setOwnership: value => { scope.steamAppOwnership = value; },
        getSettings: () => scope.state.videoCacheSettings,
        saveSettings: scope.saveCacheSettings,
        verifyLogin: (username, password, steamGuardCode) => scope.getSteamKitLoginService().verifyLogin(username, password, steamGuardCode),
        startPasswordSession: payload => scope.getSteamKitLoginService().startPasswordSession(
          String(payload && payload.username || '').trim(),
          String(payload && payload.password || ''),
          String(payload && payload.steamGuardCode || '').trim(),
        ),
        getPasswordSession: id => scope.getSteamKitLoginService().getPasswordSession(id),
        startQrSession: () => scope.getSteamKitLoginService().startQrSession(),
        getQrSession: id => scope.getSteamKitLoginService().getQrSession(id),
        cancelQrSession: id => scope.getSteamKitLoginService().cancelQrSession(id),
        normalizeError: scope.normalizeDepotError,
        stopQueryBridge: scope.stopSteamKitQueryBridge,
        clearAuth: () => scope.getSteamKitLoginService().clearDepotDownloaderAuth(),
        getRuntimeSetupStatus: () => scope.RUNTIME_SETUP.status,
        effectiveDownloaderMode: scope.effectiveDownloaderMode,
        getDownloaderMode: scope.getDownloaderMode,
        logger: console,
      },
      settingsHandlers: {
        jsonRes,
        readBody,
        isReadAllowed: isWallhubReadAllowed,
        isMutationAllowed: isUpdateMutationAllowed,
        getSettings: () => scope.state.videoCacheSettings,
        setSettings: value => { scope.state.videoCacheSettings = value; },
        getRuntimeSettings: scope.getRuntimeSettings,
        saveSettings: scope.saveCacheSettings,
        settingsSnapshot: scope.cacheSettingsSnapshotWithMpkgCapabilities,
        steamAccessGateway: scope.STEAM_ACCESS_GATEWAY,
        clearWorkshopCaches: scope.WORKSHOP_HANDLERS.clearCaches,
        updateService: scope.UPDATE_SERVICE,
        hostsUpdater: scope.STEAM_ACCESS_HOSTS_UPDATER,
        warmupSteamAccessGatewayCore: scope.warmupSteamAccessGatewayCore,
        warmupSteamAccessGatewayCdnBackground: scope.warmupSteamAccessGatewayCdnBackground,
        logSteamAccessResolvedRoutes: scope.logSteamAccessResolvedRoutes,
        cleanupDepotStreamCache: scope.cleanupDepotStreamCache,
        depotStreamCacheCleanupTarget: scope.DEPOT_STREAM_CACHE_CLEANUP_TARGET,
        stopAllDepotStreamWorkers: scope.stopAllDepotStreamWorkers,
        stopSteamKitQueryBridge: scope.stopSteamKitQueryBridge,
        warmupDepotStreamDownloader: scope.warmupDepotStreamDownloader,
        triggerQueue: scope.triggerQueue,
        clearDepotStreamCacheNow: scope.clearDepotStreamCacheNow,
        getSteamCdnRouteStrategy: scope.getSteamCdnRouteStrategy,
        getSteamKitMaxDownloads: scope.getSteamKitMaxDownloads,
        truncateClientEventValue,
        shouldLogClientEvent,
        debugEnabled: scope.DEBUG_ENABLED,
        logger: console,
      },
      downloadVideoHandlers: {
        getVideoController: scope.getVideoController,
        getCacheItemsService: scope.getCacheItemsService,
        getDownloadsController: scope.getDownloadsController,
      },
      serverControlHandlers: {
        jsonRes,
        getRestartServer: controls.getRestartServer,
        getShutdownServer: controls.getShutdownServer,
      },
      router: {
        jsonRes,
        send,
        virtualHostParam: scope.WALLHUB_PROXY_VIRTUAL_HOST_PARAM,
        isWallhubProxyVirtualSteamPath: scope.isWallhubProxyVirtualSteamPath,
        steamProxyHandlers: scope.STEAM_PROXY_HANDLERS,
        handleInternalSteamResolve: scope.handleInternalSteamResolve,
        handleInternalSteamWebApi: scope.handleInternalSteamWebApi,
        workshopHandlers: scope.WORKSHOP_HANDLERS,
        listCachedItems: scope.listCachedItems,
      },
      requestHandler: {
        tracker: scope.HTTP_REQUEST_TRACKER,
        jsonRes,
        isAllowedHost: isAllowedWallhubHost,
        getUpdateInstallPending: () => scope.state.updateInstallPending,
      },
    };
  }

  function onHttpListening() {
    scope.loadCacheSettings();
    scope.state.startupOnboarding = createStartupOnboardingSession({
      completedAt: scope.state.videoCacheSettings.wallhubOnboardingCompletedAt,
    });
    scope.STEAM_ACCESS_HOSTS_UPDATER.schedule();
    scope.UPDATE_SERVICE.schedule();

    console.log('\n  ===========================================');
    console.log(`  WallHub v${scope.PACKAGE_JSON.version}  -  http://localhost:${scope.port}`);
    console.log('  ===========================================\n');
    console.log(`  public : ${scope.PUBLIC}`);
    console.log(`  debug  : http://localhost:${scope.port}/api/debug`);
    console.log(`  Node   : ${process.version}`);
    console.log(`  OS     : ${process.platform}`);
    console.log(`  Runner : ${scope.ACTIVE_RUNNER_DIR}`);
    console.log(`  Files  : ${scope.state.downloadsDir}`);
    const requestedDownloader = scope.getDownloaderMode();
    const effectiveDownloader = scope.effectiveDownloaderMode();
    const downloaderLabel = requestedDownloader === effectiveDownloader
      ? effectiveDownloader
      : `${requestedDownloader} -> ${effectiveDownloader}`;
    console.log(`  DL     : ${downloaderLabel}${isTermuxLikeEnv() ? ' (Termux)' : ''}`);
    console.log(`  CDN    : ${scope.describeSteamCdnRouteStrategy()}${effectiveDownloader === 'steamkit' ? ` - SteamKit max ${scope.getSteamKitMaxDownloads()}` : ''}`);
    console.log(`  NSFW   : ${scope.NSFW_ENABLED ? 'enabled' : 'disabled'}`);
    console.log(`  Debug  : ${scope.DEBUG_ENABLED ? 'enabled' : 'disabled'}`);
    console.log(`  Guard  : ${scope.IS_SUPERVISOR_CHILD ? 'supervised' : 'disabled'}\n`);

    scope.ensureSteamConfigDir();
    scope.initializeSteamCredentials();
    scope.prepareRuntimeOnStartup();
  }

  async function buildDepotRuntime() {
    scope.loadCacheSettings();
    scope.ensureSteamConfigDir();
    const json = await scope.ensureJsonProgressDepotDownloaderReady();
    const stream = await scope.buildDepotStreamDownloader();
    return { json, stream };
  }

  return {
    port: scope.port,
    projectRoot: scope.PROJECT_ROOT,
    isSupervisorChild: scope.IS_SUPERVISOR_CHILD,
    isRestartChild: scope.IS_RESTART_CHILD,
    cors: scope.cors,
    createHttpCompositionConfig,
    onHttpListening,
    markServerStopping: () => { scope.state.serverStopping = true; },
    stopRuntimeWorkers: reason => {
      scope.stopSteamKitQueryBridge(reason || 'WallHub server stopping');
      scope.stopAllDepotStreamWorkers(reason);
    },
    buildDepotRuntime,
    setRequestUpdateShutdown(callback) {
      scope.state.requestUpdateShutdown = callback;
    },
  };
}

module.exports = { createPublicWallhubContext };
