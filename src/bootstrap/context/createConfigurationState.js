'use strict';

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

function createConfigurationState({ rootRequire: require, projectRoot }) {
  const { parseNsfwEnabledArg, parseDebugEnabledArg } = require('./src/config/cli');
  const { resolveConfiguredDownloadsDir: resolveDownloadsPath } = require('./src/config/paths');
  const RUNTIME_TUNING = require('./src/config/runtime');
  const {
    normalizeMaxConcurrentDownloads,
    normalizeSteamCdnRouteStrategy,
    normalizeSteamKitMaxDownloads,
    normalizeDepotStreamCacheMaxMb,
    normalizeSteamContentCellId,
    getDefaultSteamKitMaxDownloads,
  } = require('./src/config/normalizers');
  const { cors } = require('./src/app/http');
  const { createHttpRequestTracker } = require('./src/app/handlers/serverControl');
  const { createSteamCdnStatusStore } = require('./src/domains/serverStatus/steamCdnStatus');
  const { DEFAULT_CACHE_SETTINGS } = require('./src/domains/settings/schema');
  const { createCacheSettingsStore } = require('./src/domains/settings/store');
  const { createRuntimeSettings } = require('./src/domains/settings/runtimeSettings');
  const { createRuntimeSetupState, getDownloaderMode } = require('./src/domains/runtime/setupState');
  const { createStartupOnboardingSession } = require('./src/domains/onboarding/session');
  const { createPreparedDownloadStore } = require('./src/domains/downloads/preparedDownloads');
  const { createUpdateService } = require('./src/domains/updates/service');
  const {
    applySteamHttpProxyEnvFromUrl,
    buildSteamContentEnvForStrategy,
  } = require('./src/infrastructure/steam/contentEnv');
  const PACKAGE_JSON = require('./package.json');

  const scope = { require, fs, path, projectRoot, RUNTIME_TUNING, PACKAGE_JSON, cors };
  const port = process.env.PORT ? parseInt(process.env.PORT) : 3090;
  const resolverToken = crypto.randomBytes(24).toString('hex');
  process.env.WALLHUB_DEPOT_RESOLVER_URL = `http://127.0.0.1:${port}/api/internal/steam/resolve`;
  process.env.WALLHUB_DEPOT_RESOLVER_TOKEN = resolverToken;
  process.env.WALLHUB_DEPOT_WEBAPI_BROKER_URL = `http://127.0.0.1:${port}/api/internal/steam/webapi`;
  process.env.WALLHUB_DEPOT_WEBAPI_BROKER_TOKEN = resolverToken;

  const steamKitRoot = process.env.STEAMKIT_DIR || path.join(projectRoot, 'SteamKit');
  const defaultDownloadsDir = path.join(projectRoot, 'Downloads');
  const steamKitConfigDir = process.env.DEPOTDOWNLOADER_CONFIG_DIR || path.join(steamKitRoot, 'account');
  const depotDownloaderDir = process.env.DEPOTDOWNLOADER_DIR || path.join(steamKitRoot, 'DepotDownloader');
  const depotStreamDownloaderDir = process.env.WALLHUB_DEPOT_STREAM_DIR || path.join(steamKitRoot, 'DepotDownloaderStream');
  const downloadsDir = resolveDownloadsPath(process.env.WALLHUB_DOWNLOADS_DIR || '', projectRoot, defaultDownloadsDir);
  const githubAcceleratorMode = String(process.env.WALLHUB_GITHUB_ACCELERATOR || 'auto').trim().toLowerCase();

  Object.assign(scope, {
    port,
    resolverToken,
    PUBLIC: path.join(projectRoot, 'public'),
    IS_RESTART_CHILD: process.env.WALLHUB_RESTART_CHILD === '1',
    IS_SUPERVISOR_CHILD: process.env.WALLHUB_SUPERVISOR_CHILD === '1',
    NSFW_ENABLED: parseNsfwEnabledArg(),
    DEBUG_ENABLED: parseDebugEnabledArg(),
    PROJECT_ROOT: projectRoot,
    STEAMKIT_ROOT: steamKitRoot,
    DEFAULT_DOWNLOADS_DIR: defaultDownloadsDir,
    STEAMKIT_CONFIG_DIR: steamKitConfigDir,
    ACTIVE_RUNNER_DIR: steamKitRoot,
    ACTIVE_CONFIG_DIR: steamKitConfigDir,
    TOOLS_DIR: path.join(projectRoot, 'tools'),
    DEPOT_DOWNLOADER_DIR: depotDownloaderDir,
    DEPOT_STREAM_DOWNLOADER_DIR: depotStreamDownloaderDir,
    DEPOT_JSON_PROGRESS_DIR: depotDownloaderDir,
    DEPOT_JSON_PROGRESS_SOURCE_ZIP: process.env.WALLHUB_DEPOT_SOURCE_ZIP || 'https://github.com/SteamRE/DepotDownloader/archive/refs/heads/master.zip',
    DEPOT_JSON_PROGRESS_PATCH_VERSION: 'wallhub-network-v72-official-query-semantics',
    DEPOT_STREAM_PATCH_VERSION: 'wallhub-network-v77-official-query-semantics',
    DEPOT_CONFIG_DIR: steamKitConfigDir,
    DEPOT_HOME_DIR: process.env.WALLHUB_DEPOT_HOME_DIR || path.join(steamKitConfigDir, 'home'),
    DEPOT_DOTNET_CLI_HOME_DIR: process.env.WALLHUB_DEPOT_DOTNET_CLI_HOME || path.join(steamKitConfigDir, 'dotnet-home'),
    DEPOT_XDG_DATA_HOME_DIR: process.env.WALLHUB_DEPOT_XDG_DATA_HOME || path.join(steamKitConfigDir, 'xdg-data'),
    DEPOT_XDG_CONFIG_HOME_DIR: process.env.WALLHUB_DEPOT_XDG_CONFIG_HOME || path.join(steamKitConfigDir, 'xdg-config'),
    DEPOT_LOCALAPPDATA_DIR: process.env.WALLHUB_DEPOT_LOCALAPPDATA || path.join(steamKitConfigDir, 'localappdata'),
    DEPOT_APPDATA_DIR: process.env.WALLHUB_DEPOT_APPDATA || path.join(steamKitConfigDir, 'appdata'),
    DEPOT_STREAM_CACHE_DIR: process.env.WALLHUB_DEPOT_STREAM_CACHE_DIR || path.join(steamKitConfigDir, 'depot-stream-cache'),
    GITHUB_ACCELERATOR_MODE: githubAcceleratorMode,
  });
  Object.assign(scope, {
    DEPOT_STREAM_MAX_RANGE_BYTES: RUNTIME_TUNING.DEPOT_STREAM.maxRangeBytes,
    DEPOT_STREAM_FIRST_RANGE_BYTES: RUNTIME_TUNING.DEPOT_STREAM.firstRangeBytes,
    DEPOT_STREAM_TAIL_BYTES: RUNTIME_TUNING.DEPOT_STREAM.tailBytes,
    DEPOT_STREAM_INITIAL_BUFFER_BYTES: RUNTIME_TUNING.DEPOT_STREAM.initialBufferBytes,
    DEPOT_STREAM_AHEAD_BYTES: RUNTIME_TUNING.DEPOT_STREAM.aheadBytes,
    DEPOT_STREAM_CHUNK_BUFFER_BYTES: RUNTIME_TUNING.DEPOT_STREAM.chunkBufferBytes,
    DEPOT_STREAM_READ_THROUGH: RUNTIME_TUNING.DEPOT_STREAM.readThrough,
    DEPOT_STREAM_READ_WINDOW_BYTES: RUNTIME_TUNING.DEPOT_STREAM.readWindowBytes,
    DEPOT_STREAM_WORKER_IDLE_MS: RUNTIME_TUNING.DEPOT_STREAM.workerIdleMs,
    DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK: RUNTIME_TUNING.DEPOT_STREAM.cleanupHighWatermark,
    DEPOT_STREAM_CACHE_CLEANUP_TARGET: RUNTIME_TUNING.DEPOT_STREAM.cleanupTarget,
    DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS: RUNTIME_TUNING.DEPOT_STREAM.cleanupDebounceMs,
  });

  const runtimeSetupStore = createRuntimeSetupState({
    mode: 'steamkit', requestedMode: 'steamkit', status: 'idle', message: '', progress: 0,
    runnerDir: steamKitRoot, downloadsDir, executablePath: '', error: '', updatedAt: Date.now(),
  });
  const cacheSettingsStore = createCacheSettingsStore({
    settingsFile: path.join(projectRoot, 'cache-settings.json'),
    defaultSettings: DEFAULT_CACHE_SETTINGS,
    logger: console,
  });
  const state = {
    startupOnboarding: createStartupOnboardingSession(),
    serverStopping: false,
    updateInstallPending: false,
    requestUpdateShutdown: null,
    downloadsDir,
    workshopCacheDir: downloadsDir,
    videoCacheSettings: cacheSettingsStore.state,
    runtimeSettings: null,
    taskQueue: [],
    downloadQueueService: null,
    mpkgPreparationService: null,
    mpkgService: null,
    steamKitLoginService: null,
  };
  Object.assign(scope, {
    state,
    RUNTIME_SETUP_STORE: runtimeSetupStore,
    RUNTIME_SETUP: runtimeSetupStore.state,
    CACHE_SETTINGS_STORE: cacheSettingsStore,
    PREPARED_DOWNLOAD_STORE: createPreparedDownloadStore(),
    HTTP_REQUEST_TRACKER: createHttpRequestTracker(),
    STEAM_CREDENTIALS: { username: '', password: '', steamGuardCode: '', isPersistent: false, pendingPersistentUsername: '' },
    steamAppOwnership: { username: '', status: 'unknown', checkedAt: 0, error: '' },
  });

  scope.resolveConfiguredDownloadsDir = raw => resolveDownloadsPath(raw, projectRoot, defaultDownloadsDir);
  scope.setDownloadsDir = (raw, options = {}) => {
    const nextDir = scope.resolveConfiguredDownloadsDir(raw);
    if (fs.existsSync(nextDir) && !fs.statSync(nextDir).isDirectory()) throw new Error(`下载目录不是文件夹: ${nextDir}`);
    fs.mkdirSync(nextDir, { recursive: true });
    state.downloadsDir = nextDir;
    state.workshopCacheDir = nextDir;
    scope.RUNTIME_SETUP.downloadsDir = nextDir;
    if (options.persist !== false) {
      state.videoCacheSettings.downloadDir = nextDir;
      scope.saveCacheSettings();
    }
    return nextDir;
  };
  scope.getRuntimeSettings = () => {
    if (!state.runtimeSettings) {
      state.runtimeSettings = createRuntimeSettings({
        cacheSettingsStore,
        getSettings: () => state.videoCacheSettings,
        setSettings: next => { state.videoCacheSettings = next; },
        env: process.env,
        normalizeMaxConcurrentDownloads,
        normalizeDepotStreamCacheMaxMb,
        normalizeSteamContentCellId,
        normalizeSteamKitMaxDownloads,
        normalizeSteamCdnRouteStrategy,
        getDefaultSteamKitMaxDownloads,
        applySteamHttpProxyEnvFromUrl,
        buildSteamContentEnvForStrategy,
        applyDownloadDir: (raw, options) => scope.setDownloadsDir(raw || defaultDownloadsDir, options),
        getCurrentDownloadDir: () => state.downloadsDir,
        getNsfwEnabled: () => scope.NSFW_ENABLED,
      });
    }
    return state.runtimeSettings;
  };
  scope.loadCacheSettings = () => { state.videoCacheSettings = scope.getRuntimeSettings().load(); };
  scope.saveCacheSettings = () => { state.videoCacheSettings = scope.getRuntimeSettings().save(); };
  scope.saveCacheSettingsChecked = () => scope.getRuntimeSettings().saveChecked();
  scope.cacheSettingsSnapshot = (extra = {}) => scope.getRuntimeSettings().snapshot(extra);
  scope.cacheSettingsSnapshotWithMpkgCapabilities = (extra = {}, options = {}) => {
    const capabilities = scope.getMpkgService().getCapabilities();
    const snapshot = scope.cacheSettingsSnapshot({
      mpkgCompactAvailable: capabilities.compactAvailable,
      mpkgCompactUnavailableReason: capabilities.compactUnavailableReason,
      ...extra,
    });
    if (!options.includeSteamAccessHosts) {
      delete snapshot.wallhubSteamAccessHosts;
      snapshot.wallhubSteamAccessHostsDeferred = true;
    }
    return snapshot;
  };
  scope.debugLogEnabled = () => {
    const configured = String(state.videoCacheSettings.wallhubLogLevel || process.env.WALLHUB_LOG_LEVEL || '').trim().toLowerCase();
    return scope.DEBUG_ENABLED || configured === 'debug';
  };
  scope.debugLogger = {
    log: (...args) => { if (scope.debugLogEnabled()) console.log(...args); },
    info: (...args) => console.info(...args),
    warn: (...args) => console.warn(...args),
    error: (...args) => console.error(...args),
    traceLog: (...args) => {
      if (/^(?:1|true|yes|on)$/i.test(String(process.env.DEPOTDOWNLOADER_DEBUG || '').trim())) console.log(...args);
    },
  };
  scope.mpkgDebugEnabled = () => scope.debugLogEnabled() || /^(?:1|true|yes|on|debug)$/i.test(String(process.env.WALLHUB_MPKG_DEBUG || '').trim());
  scope.getMaxConcurrentDownloads = () => scope.getRuntimeSettings().getMaxConcurrentDownloads();
  scope.getDepotStreamCacheMaxMb = () => scope.getRuntimeSettings().getDepotStreamCacheMaxMb();
  scope.getDepotStreamCacheMaxBytes = () => scope.getRuntimeSettings().getDepotStreamCacheMaxBytes();
  scope.getSteamContentCellId = () => scope.getRuntimeSettings().getSteamContentCellId();
  scope.getSteamKitMaxDownloads = () => scope.getRuntimeSettings().getSteamKitMaxDownloads();
  scope.getSteamKitStreamMaxDownloads = scope.getSteamKitMaxDownloads;
  scope.applySteamHttpProxyEnv = (baseEnv = process.env) => scope.getRuntimeSettings().applySteamHttpProxyEnv(baseEnv);
  scope.buildDepotResolverEnv = (baseEnv = process.env) => scope.getRuntimeSettings().buildDepotResolverEnv(baseEnv);
  scope.buildSteamAuthEnv = (baseEnv = process.env) => scope.buildDepotResolverEnv(scope.applySteamHttpProxyEnv(baseEnv));
  scope.getSteamCdnRouteStrategy = () => scope.getRuntimeSettings().getSteamCdnRouteStrategy();
  scope.buildSteamContentEnv = (baseEnv = process.env) => scope.getRuntimeSettings().buildSteamContentEnv(baseEnv);
  scope.describeSteamCdnRouteStrategy = () => scope.getRuntimeSettings().describeSteamCdnRouteStrategy();
  scope.getDownloaderMode = getDownloaderMode;
  scope.startupDownloaderMode = getDownloaderMode;
  scope.effectiveDownloaderMode = getDownloaderMode;
  scope.updateRuntimeSetup = patch => runtimeSetupStore.update(patch);
  scope.runtimeSetupSnapshot = () => runtimeSetupStore.snapshot({
    runnerDir: steamKitRoot,
    accountDir: steamKitConfigDir,
    downloadsDir: state.downloadsDir,
    executablePath: (scope.resolveDepotDownloaderPath && scope.resolveDepotDownloaderPath()) || scope.RUNTIME_SETUP.executablePath || '',
  });
  scope.sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

  const steamCdnStatusStore = createSteamCdnStatusStore({
    limit: RUNTIME_TUNING.STEAM_CDN_RECENT_LIMIT,
    getStrategy: scope.getSteamCdnRouteStrategy,
    getMode: scope.startupDownloaderMode,
  });
  scope.updateSteamCdnStatus = (data = {}) => steamCdnStatusStore.update(data);
  scope.steamCdnStatusSnapshot = () => steamCdnStatusStore.snapshot();
  scope.updateSteamCdnStatusFromText = (text, meta = {}) => steamCdnStatusStore.updateFromText(text, meta);

  scope.UPDATE_SERVICE = createUpdateService({
    currentVersion: PACKAGE_JSON.version,
    projectRoot,
    env: process.env,
    platform: process.platform,
    arch: process.arch,
    githubAcceleratorMode,
    supervised: scope.IS_SUPERVISOR_CHILD,
    logger: console,
    getAutoUpdateEnabled: () => !!state.videoCacheSettings.wallhubAutoUpdateEnabled,
    getProxyUrl: () => String(state.videoCacheSettings.steamHttpProxyUrl || ''),
    isInstallSafe: () => {
      const queueBusy = state.taskQueue.some(task => (
        ['pending', 'downloading', 'moving'].includes(String(task && task.status || '')) ||
        !!(task && (task.livePaused || task.processPromise || task._runnerActive))
      ));
      const conversionBusy = !!(state.mpkgPreparationService && Array.from(state.mpkgPreparationService.jobs.values()).some(job => job.status === 'preparing'));
      const directConversionBusy = !!(state.mpkgService && state.mpkgService.buildPromises.size > 0);
      const steamLoginBusy = !!(state.steamKitLoginService && Array.from(state.steamKitLoginService.sessions.values()).some(session => !session.done && session.processPromise));
      return !queueBusy && !conversionBusy && !directConversionBusy && !steamLoginBusy && scope.HTTP_REQUEST_TRACKER.activeCount() === 0;
    },
    onInstallStarting: () => { state.updateInstallPending = true; },
    onInstallCancelled: () => { state.updateInstallPending = false; },
    onInstallPrepared: () => {
      if (typeof state.requestUpdateShutdown === 'function') state.requestUpdateShutdown();
    },
  });

  return scope;
}

module.exports = { createConfigurationState };
