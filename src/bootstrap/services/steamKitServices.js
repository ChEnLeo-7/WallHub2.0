'use strict';

function assembleSteamKitServices(scope) {
  const { getQrCodeModule, getJsQrModule } = scope.require('./src/shared/dependencies');
  const {
    isTermuxLikeEnv,
    isAndroidHostLikeEnv,
    shouldRejectDepotAppHostForAndroid,
  } = scope.require('./src/config/platform');
  const { createSteamKitRuntimeBuildService } = scope.require('./src/domains/steamkit/runtimeBuild');
  const { createSteamKitLoginService } = scope.require('./src/domains/steamkit/login');
  const { createSteamKitPersonalWorkshopService } = scope.require('./src/domains/steamkit/personalWorkshop');
  const { createSteamKitQueryBridge } = scope.require('./src/domains/steamkit/queryBridge');

  let runtimeBuildService = null;
  let loginService = null;
  let queryBridge = null;
  let personalWorkshopService = null;
  let loginRevalidationPromise = null;

  scope.ensureSteamConfigDir = () => {
    try {
      const dirs = [scope.state.downloadsDir, scope.ACTIVE_CONFIG_DIR];
      if (scope.startupDownloaderMode() === 'steamkit') dirs.push(scope.DEPOT_STREAM_CACHE_DIR);
      for (const dir of dirs) {
        if (!scope.fs.existsSync(dir)) {
          scope.fs.mkdirSync(dir, { recursive: true });
          console.log(`[Runtime] Created directory: ${dir}`);
        }
      }
      scope.migrateExistingWorkshopContent();
      scope.cleanupRuntimeDownloadResidues(431960, scope.state.taskQueue.map(task => task.id));
    } catch (error) {
      console.warn('[Runtime] Failed to create runtime directories:', error.message);
    }
  };
  scope.migrateExistingWorkshopContent = () => {
    const roots = [scope.path.join(scope.STEAMKIT_CONFIG_DIR, 'steamapps', 'workshop', 'content', '431960')];
    for (const root of roots) {
      if (!scope.fs.existsSync(root)) continue;
      let entries = [];
      try { entries = scope.fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
        const src = scope.path.join(root, entry.name);
        const dest = scope.path.join(scope.state.downloadsDir, entry.name);
        if (scope.fs.existsSync(dest)) continue;
        try {
          scope.copyDirContents(src, dest);
          console.log(`[Runtime] Migrated cached workshop item ${entry.name} -> ${dest}`);
        } catch (error) {
          console.warn(`[Runtime] Failed to migrate workshop item ${entry.name}:`, error.message);
        }
      }
    }
  };
  scope.setValidatedPersistentLogin = (username, backend) => {
    const user = String(username || '').trim();
    if (!user) return;
    Object.assign(scope.STEAM_CREDENTIALS, {
      username: user,
      password: '',
      steamGuardCode: '',
      isPersistent: true,
      pendingPersistentUsername: '',
    });
    if (scope.steamAppOwnership.username !== user) {
      scope.steamAppOwnership = { username: user, status: 'unknown', checkedAt: 0, error: '' };
    }
    scope.state.videoCacheSettings.steamUsername = user;
    scope.state.videoCacheSettings.steamIsPersistent = true;
    scope.state.videoCacheSettings.authBackend = backend || scope.startupDownloaderMode();
    scope.saveCacheSettings();
  };
  scope.cachedSteamLoginUsername = () => String(
    scope.STEAM_CREDENTIALS.username ||
    scope.STEAM_CREDENTIALS.pendingPersistentUsername ||
    scope.state.videoCacheSettings.steamUsername || '',
  ).trim();
  scope.steamKitPersistentLoginIsUsable = () => !!(
    scope.cachedSteamLoginUsername() && (
      scope.STEAM_CREDENTIALS.isPersistent ||
      scope.STEAM_CREDENTIALS.pendingPersistentUsername ||
      scope.state.videoCacheSettings.steamIsPersistent
    )
  );
  scope.shouldRetrySteamLoginRequiredError = error => !!(
    error && error.requiresSteamLogin && !error.requiresSteamGuard &&
    error.code === 'STEAM_LOGIN_REQUIRED' && scope.cachedSteamLoginUsername()
  );
  scope.refreshPersistentSteamLoginForRetry = async reason => {
    const username = scope.cachedSteamLoginUsername();
    if (!username) return false;
    if (loginRevalidationPromise) return loginRevalidationPromise;
    console.log(`[SteamKit Login] Revalidating cached Steam session for retry (${reason || 'download'}): ${username}`);
    loginRevalidationPromise = (async () => {
      try {
        await scope.getSteamKitLoginService().verifyRememberedSession(username);
        scope.setValidatedPersistentLogin(username, 'steamkit');
        return true;
      } catch (error) {
        const normalized = scope.normalizeDepotError(error);
        console.warn(`[SteamKit Login] Cached session retry validation failed: ${normalized.message || error.message}`);
        return false;
      } finally {
        loginRevalidationPromise = null;
      }
    })();
    return loginRevalidationPromise;
  };
  scope.reconcileCachedSteamLogin = async mode => {
    const cachedUser = String(scope.state.videoCacheSettings.steamUsername || scope.STEAM_CREDENTIALS.pendingPersistentUsername || '').trim();
    if (!cachedUser || !scope.state.videoCacheSettings.steamIsPersistent) return;
    scope.updateRuntimeSetup({
      mode, status: 'validating-login', progress: 90, message: `正在验证本地 Steam 登录会话: ${cachedUser}`,
    });
    try {
      await scope.getSteamKitLoginService().verifyRememberedSession(cachedUser);
      scope.setValidatedPersistentLogin(cachedUser, 'steamkit');
      scope.updateRuntimeSetup({ mode, status: 'ready', progress: 100, message: `SteamKit 运行文件已就绪，已恢复登录: ${cachedUser}` });
      console.log(`[Steam Init] Validated SteamKit remembered session: ${cachedUser}`);
    } catch (error) {
      Object.assign(scope.STEAM_CREDENTIALS, {
        username: cachedUser, password: '', steamGuardCode: '', isPersistent: false, pendingPersistentUsername: cachedUser,
      });
      scope.updateRuntimeSetup({
        mode, status: 'ready', progress: 100,
        message: `SteamKit 运行文件已就绪，本地登录会话未验证，请重新登录: ${cachedUser}`,
      });
      console.warn(`[Steam Init] SteamKit cached login is not usable until re-login: ${error.message}`);
    }
  };

  scope.getSteamKitRuntimeBuildService = () => {
    if (!runtimeBuildService) {
      runtimeBuildService = createSteamKitRuntimeBuildService({
        env: process.env,
        logger: console,
        STEAMKIT_ROOT: scope.STEAMKIT_ROOT,
        STEAMKIT_CONFIG_DIR: scope.STEAMKIT_CONFIG_DIR,
        DOWNLOADS_DIR: scope.state.downloadsDir,
        DEPOT_DOWNLOADER_DIR: scope.DEPOT_DOWNLOADER_DIR,
        DEPOT_STREAM_DOWNLOADER_DIR: scope.DEPOT_STREAM_DOWNLOADER_DIR,
        DEPOT_JSON_PROGRESS_DIR: scope.DEPOT_JSON_PROGRESS_DIR,
        DEPOT_JSON_PROGRESS_SOURCE_ZIP: scope.DEPOT_JSON_PROGRESS_SOURCE_ZIP,
        DEPOT_JSON_PROGRESS_PATCH_VERSION: scope.DEPOT_JSON_PROGRESS_PATCH_VERSION,
        DEPOT_STREAM_PATCH_VERSION: scope.DEPOT_STREAM_PATCH_VERSION,
        DEPOT_CONFIG_DIR: scope.DEPOT_CONFIG_DIR,
        DEPOT_HOME_DIR: scope.DEPOT_HOME_DIR,
        DEPOT_DOTNET_CLI_HOME_DIR: scope.DEPOT_DOTNET_CLI_HOME_DIR,
        DEPOT_XDG_DATA_HOME_DIR: scope.DEPOT_XDG_DATA_HOME_DIR,
        DEPOT_XDG_CONFIG_HOME_DIR: scope.DEPOT_XDG_CONFIG_HOME_DIR,
        DEPOT_LOCALAPPDATA_DIR: scope.DEPOT_LOCALAPPDATA_DIR,
        DEPOT_APPDATA_DIR: scope.DEPOT_APPDATA_DIR,
        GITHUB_ACCELERATOR_MODE: scope.GITHUB_ACCELERATOR_MODE,
        UA: scope.UA,
        GET: scope.GET,
        ensureDir: scope.ensureDir,
        runProcess: scope.runProcess,
        psQuote: scope.psQuote,
        updateRuntimeSetup: scope.updateRuntimeSetup,
        runtimeSetupSnapshot: scope.runtimeSetupSnapshot,
        effectiveDownloaderMode: scope.effectiveDownloaderMode,
        startupDownloaderMode: scope.startupDownloaderMode,
        ensureSteamConfigDir: scope.ensureSteamConfigDir,
        reconcileCachedSteamLogin: scope.reconcileCachedSteamLogin,
        warmupSteamKitQueryBridge: scope.warmupSteamKitQueryBridge,
        VIDEO_CACHE_SETTINGS: scope.state.videoCacheSettings,
        getVideoCacheSettings: () => scope.state.videoCacheSettings,
        makeSteamKitJsonProgressRequiredError: scope.makeSteamKitJsonProgressRequiredError,
        isTermuxLikeEnv,
        isAndroidHostLikeEnv,
        shouldRejectDepotAppHostForAndroid,
      });
    }
    return runtimeBuildService;
  };
  scope.prepareRuntimeOnStartup = () => scope.getSteamKitRuntimeBuildService().prepareRuntimeOnStartup();
  scope.waitForStartupPreparationForDownload = task => scope.getSteamKitRuntimeBuildService().waitForStartupPreparationForDownload(task);
  scope.resolveDepotDownloaderPath = () => scope.getSteamKitRuntimeBuildService().resolveDepotDownloaderPath();
  scope.depotDotnetMissingMessage = (...args) => scope.getSteamKitRuntimeBuildService().depotDotnetMissingMessage(...args);
  scope.ensureDepotStreamDownloaderReady = () => scope.getSteamKitRuntimeBuildService().ensureDepotStreamDownloaderReady();
  scope.warmupDepotStreamDownloader = (reason = '') => scope.getSteamKitRuntimeBuildService().warmupDepotStreamDownloader(reason);
  scope.ensureDepotDownloaderReady = () => scope.getSteamKitRuntimeBuildService().ensureDepotDownloaderReady();
  scope.ensureJsonProgressDepotDownloaderReady = () => scope.getSteamKitRuntimeBuildService().ensureJsonProgressDepotDownloaderReady();
  scope.buildDepotStreamDownloader = () => scope.getSteamKitRuntimeBuildService().buildDepotStreamDownloader();
  scope.depotCommandFor = executable => scope.getSteamKitRuntimeBuildService().depotCommandFor(executable);
  scope.buildDepotDotnetEnv = () => scope.getSteamKitRuntimeBuildService().buildDepotDotnetEnv();

  scope.getSteamKitLoginService = () => {
    if (!loginService) {
      loginService = createSteamKitLoginService({
        ensureDepotDownloaderReady: scope.ensureDepotDownloaderReady,
        ensureDir: scope.ensureDir,
        depotCommandFor: scope.depotCommandFor,
        runProcess: scope.runProcess,
        buildDepotDotnetEnv: scope.buildDepotDotnetEnv,
        makeDepotLoginId: scope.makeDepotLoginId,
        normalizeDepotError: scope.normalizeDepotError,
        isDepotLoginVerifiedDespiteCanceled: scope.isDepotLoginVerifiedDespiteCanceled,
        setValidatedPersistentLogin: scope.setValidatedPersistentLogin,
        getQrCodeModule,
        getJsQrModule,
        effectiveDownloaderMode: scope.effectiveDownloaderMode,
        configDir: scope.DEPOT_CONFIG_DIR,
        logger: console,
        debugLogger: scope.debugLogger,
      });
      scope.state.steamKitLoginService = loginService;
    }
    return loginService;
  };
  scope.getSteamKitQueryBridge = () => {
    if (!queryBridge) {
      queryBridge = createSteamKitQueryBridge({
        ensureDepotDownloaderReady: scope.ensureDepotDownloaderReady,
        depotCommandFor: scope.depotCommandFor,
        buildDepotDotnetEnv: scope.buildDepotDotnetEnv,
        buildSteamAuthEnv: scope.buildSteamAuthEnv,
        validateRememberedSession: async username => {
          if (!scope.STEAM_CREDENTIALS.pendingPersistentUsername) return false;
          try {
            await scope.getSteamKitLoginService().verifyRememberedSession(username);
          } catch (error) {
            if (error && (error.code === 'STEAM_NETWORK_UNREACHABLE' || error.code === 'STEAM_LOGIN_TIMEOUT')) throw error;
            const loginError = new Error('Steam 登录已失效，请重新登录后再使用 Steam CM WebSocket。');
            loginError.code = 'STEAM_CM_LOGIN_REQUIRED';
            loginError.statusCode = 401;
            loginError.requiresSteamLogin = true;
            loginError.cause = error;
            throw loginError;
          }
          return true;
        },
        onRememberedSessionValidated: username => scope.setValidatedPersistentLogin(username, 'steamkit'),
        makeDepotLoginId: scope.makeDepotLoginId,
        ensureDir: scope.ensureDir,
        configDir: scope.DEPOT_CONFIG_DIR,
        logger: scope.debugLogger,
      });
    }
    return queryBridge;
  };
  scope.stopSteamKitQueryBridge = reason => { if (queryBridge) queryBridge.shutdown(reason); };
  scope.getSteamKitPersonalWorkshopService = () => {
    if (!personalWorkshopService) {
      personalWorkshopService = createSteamKitPersonalWorkshopService({
        ensureDepotDownloaderReady: scope.ensureDepotDownloaderReady,
        depotCommandFor: scope.depotCommandFor,
        runProcess: scope.runProcess,
        buildDepotDotnetEnv: scope.buildDepotDotnetEnv,
        makeDepotLoginId: scope.makeDepotLoginId,
        ensureDir: scope.ensureDir,
        configDir: scope.DEPOT_CONFIG_DIR,
        queryBridge: scope.getSteamKitQueryBridge(),
        logger: scope.debugLogger,
      });
    }
    return personalWorkshopService;
  };
  scope.querySteamKitUserFiles = async (listType, options = {}) => {
    if (scope.effectiveDownloaderMode() !== 'steamkit') {
      const error = new Error('SteamKit is not the active downloader mode');
      error.code = 'STEAMKIT_USER_FILES_UNAVAILABLE';
      error.requiresSteamLogin = true;
      throw error;
    }
    const username = scope.cachedSteamLoginUsername();
    if (!username || !scope.steamKitPersistentLoginIsUsable()) {
      const error = new Error('SteamKit remembered account is unavailable');
      error.code = 'STEAMKIT_USER_FILES_UNAVAILABLE';
      error.requiresSteamLogin = true;
      throw error;
    }
    return scope.getSteamKitPersonalWorkshopService().getUserFiles(listType, Object.assign({}, options, { username }));
  };
  scope.querySteamKitWorkshop = async (query, options = {}) => {
    if (scope.effectiveDownloaderMode() !== 'steamkit') {
      const error = new Error('SteamKit is not the active downloader mode');
      error.code = 'STEAM_CM_QUERY_UNAVAILABLE';
      error.statusCode = 503;
      throw error;
    }
    const username = scope.cachedSteamLoginUsername();
    if (!username || !scope.steamKitPersistentLoginIsUsable()) {
      const error = new Error('Steam CM 模式需要有效的 SteamKit 登录会话，请重新登录 Steam 后重试');
      error.code = 'STEAM_CM_LOGIN_REQUIRED';
      error.statusCode = 401;
      error.requiresSteamLogin = true;
      throw error;
    }
    return scope.getSteamKitPersonalWorkshopService().queryWorkshop(query, Object.assign({}, options, { username }));
  };
  scope.resolveSteamKitCommunityCookie = async () => {
    if (scope.effectiveDownloaderMode() !== 'steamkit') {
      console.warn('[SteamKit Web] SteamKit is not the active downloader mode; cannot derive Steam community cookie');
      return '';
    }
    const username = scope.cachedSteamLoginUsername();
    const canUsePersistentLogin = !!username && (
      scope.STEAM_CREDENTIALS.isPersistent ||
      !!scope.STEAM_CREDENTIALS.pendingPersistentUsername ||
      !!scope.state.videoCacheSettings.steamIsPersistent
    );
    if (!username) {
      console.warn('[SteamKit Web] No cached SteamKit username; cannot derive Steam community cookie');
      return '';
    }
    if (!canUsePersistentLogin) {
      console.warn(`[SteamKit Web] Cached SteamKit login is not persistent yet: ${username}`);
      return '';
    }
    try {
      scope.debugLogger.log(`[SteamKit Web] Preparing Steam community cookie from cached login: ${username}`);
      return await scope.getSteamKitLoginService().getWebSessionCookie(username);
    } catch (error) {
      const normalized = scope.normalizeDepotError(error);
      console.warn(`[SteamKit Web] Failed to generate Steam community web session: ${normalized.message}`);
      return '';
    }
  };
  scope.initializeSteamCredentials = () => {
    const cachedUser = String(scope.state.videoCacheSettings.steamUsername || '').trim();
    const cachedPersistent = !!scope.state.videoCacheSettings.steamIsPersistent;
    if (cachedUser && cachedPersistent) {
      Object.assign(scope.STEAM_CREDENTIALS, {
        username: cachedUser, password: '', steamGuardCode: '', isPersistent: true, pendingPersistentUsername: cachedUser,
      });
      console.log(`[Steam Init] Found cached username, pending runtime session validation: ${cachedUser}`);
    }
    if (!scope.STEAM_CREDENTIALS.pendingPersistentUsername) console.log('[Steam Init] No persistent login found, using anonymous or env credentials');
    if (scope.steamAccessGatewayEnabled()) {
      if (scope.state.videoCacheSettings.wallhubSteamAccessEnhance) scope.warmupSteamAccessGatewayCore('startup', { forceRefresh: false });
      setTimeout(() => scope.warmupSteamAccessGatewayCdnBackground('startup-cdn').catch(() => {}), 8000).unref?.();
    }
  };
}

module.exports = { assembleSteamKitServices };
