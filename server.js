'use strict';
/*
  WallHub server.js
  HTTP composition root. Domain and infrastructure details are being moved
  into src/ modules while route behavior remains stable.
*/

const http   = require('http');
const https  = require('https');
const tls    = require('tls');
const net    = require('net');
const fs     = require('fs');
const path   = require('path');
const crypto = require('crypto');
const childProcess = require('child_process');
const { URL } = require('url');

function readProcessStartToken(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return '';
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const closeParen = stat.lastIndexOf(')');
      const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
      return String(fields[19] || '');
    } catch {}
  }
  if (process.platform === 'win32') {
    try {
      const result = childProcess.spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `$p=Get-Process -Id ${pid} -ErrorAction Stop; $p.StartTime.ToUniversalTime().Ticks`,
      ], { encoding: 'utf8', windowsHide: true });
      if (result.status === 0) return String(result.stdout || '').trim();
    } catch {}
  }
  return '';
}

function matchesProcessIdentity(pid, identity) {
  const expected = String(identity && identity.startToken || '');
  return !!expected && readProcessStartToken(pid) === expected;
}

function handOffInterruptedSourceUpdate() {
  if (process.env.WALLHUB_UPDATE_RESTART === '1') return false;
  const updateRoot = path.join(__dirname, 'updates');
  const requestFile = path.join(updateRoot, 'update-request.json');
  const transactionFile = path.join(updateRoot, 'update-transaction.json');
  if (!fs.existsSync(requestFile)) {
    if (fs.existsSync(transactionFile)) {
      console.error('[Update] WallHub found a pending transaction but update-request.json is missing; refusing normal startup. Restore the request file or reinstall WallHub.');
      return true;
    }
    return false;
  }
  try {
    const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
    if (!request || request.mode !== 'source') {
      if (fs.existsSync(transactionFile)) {
        console.error('[Update] WallHub found a pending transaction with an invalid update-request.json; refusing normal startup.');
        return true;
      }
      fs.rmSync(requestFile, { force: true });
      return false;
    }
    const requestPath = requestFile;
    const helperPid = Number(request.helperPid || 0);
    if (helperPid > 1) {
      try {
        process.kill(helperPid, 0);
        if (matchesProcessIdentity(helperPid, request.helperIdentity)) return true;
      } catch (error) {
        if (error && error.code === 'EPERM' && matchesProcessIdentity(helperPid, request.helperIdentity)) return true;
      }
    }
    if (!fs.existsSync(transactionFile)) {
      fs.rmSync(requestFile, { force: true });
      return false;
    }
    const helperExecutable = String(request.helperExecutable || '');
    const helperScript = String(request.helperScript || '');
    if (!fs.existsSync(helperExecutable) || !fs.existsSync(helperScript)) {
      throw new Error('interrupted update helper files are unavailable');
    }
    const recovery = childProcess.spawn(
      helperExecutable,
      [helperScript, requestPath, '--recover', String(process.pid)],
      {
        cwd: path.dirname(helperScript),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    if (!Number.isInteger(recovery.pid) || recovery.pid <= 1) throw new Error('could not start interrupted update recovery');
    recovery.unref();
    return true;
  } catch (error) {
    console.error(`[Update] WallHub cannot recover the interrupted source update: ${error.message || error}`);
    console.error(`[Update] WallHub is refusing normal startup while ${transactionFile} exists. Keep ${path.join(updateRoot, 'backup-previous')} and reinstall WallHub before removing it.`);
    return true;
  }
}

if (handOffInterruptedSourceUpdate()) process.exit(0);

const { getQrCodeModule, getJsQrModule } = require('./src/shared/dependencies');
const {
  isAsciiPath,
  isTermuxLikeEnv,
  isAndroidHostLikeEnv,
  isDockerContainerEnv,
  shouldRejectDepotAppHostForAndroid,
} = require('./src/config/platform');
const { parseNsfwEnabledArg, parseDebugEnabledArg } = require('./src/config/cli');
const { truncateClientEventValue, shouldLogClientEvent } = require('./src/domains/clientEvents');
const { resolveConfiguredDownloadsDir: resolveConfiguredDownloadsDirPath } = require('./src/config/paths');
const RUNTIME_TUNING = require('./src/config/runtime');
const {
  normalizeMaxConcurrentDownloads,
  normalizeSteamCdnRouteStrategy,
  normalizeProxyInput,
  normalizeSteamHttpProxyUrl,
  normalizeSteamKitMaxDownloads,
  normalizeDepotStreamCacheMaxMb,
  normalizeSteamContentCellId,
  getDefaultSteamKitMaxDownloads,
} = require('./src/config/normalizers');
const { cors, send, jsonRes, readBody, readBodyBuffer } = require('./src/app/http');
const {
  VIDEO_EXTS,
  mimeFromExt: sharedMimeFromExt,
  mimeType,
  getVideoMime: sharedGetVideoMime,
  isVideoExt: sharedIsVideoExt,
  contentTypeFromUrl,
} = require('./src/shared/mime');
const fileTools = require('./src/shared/files');
const numberTools = require('./src/shared/number');
const { createStaticHandler } = require('./src/app/static');
const { createAppRouter } = require('./src/app/router');
const { createServerLifecycle } = require('./src/app/lifecycle');
const { startWallhubServer } = require('./src/bootstrap/startWallhubServer');
const {
  applySteamHttpProxyEnvFromUrl,
  stripProxyEnv,
  buildSteamContentDirectEnv,
  buildSteamContentEnvForStrategy,
} = require('./src/infrastructure/steam/contentEnv');
const {
  normalizeSteamCdnHost,
  extractSteamContentHosts,
  createSteamCdnStatusStore,
} = require('./src/domains/serverStatus/steamCdnStatus');
const {
  parseProxyUrl,
  isSocksProxyProtocol,
  isSocks5ProxyProtocol,
  resolveProxyForProtocol,
  proxyAuth,
  appendCurlProxyArgs,
  proxyKey,
  shouldRetryWithNextProxy,
  connectViaSocksProxy,
} = require('./src/infrastructure/http/proxy');
const { createHttpClient } = require('./src/infrastructure/http/client');
const processTools = require('./src/infrastructure/process/runProcess');
const zipTools = require('./src/infrastructure/archive/zip');
const {
  isSteamHost,
  isSteamStaticCdnHost,
  isSteamAccessGatewayHost,
  isSteamBroadcastResource,
  isSteamCommunityHost,
} = require('./src/domains/steam/hosts');
const { createSteamPersonaService } = require('./src/domains/steam/persona');
const { DEFAULT_CACHE_SETTINGS } = require('./src/domains/settings/schema');
const { createCacheSettingsStore } = require('./src/domains/settings/store');
const { createRuntimeSettings } = require('./src/domains/settings/runtimeSettings');
const { createSteamProxyCookieTools } = require('./src/domains/steamProxy/cookies');
const { headerValue: steamProxyHeaderValue, createSteamProxyCache } = require('./src/domains/steamProxy/cache');
const { createSteamProxyRewriteTools } = require('./src/domains/steamProxy/rewrite');
const steamProxyHttp = require('./src/domains/steamProxy/http');
const { createWallhubProxyRequester, bufferResponse: steamProxyRequestBufferResponse } = require('./src/domains/steamProxy/request');
const { createWallhubUrlProxyTools } = require('./src/domains/steamProxy/urlProxy');
const { createSteamAccessGateway } = require('./src/domains/steamAccess/gateway');
const { createInternalSteamResolverHandler, createInternalSteamWebApiBrokerHandler } = require('./src/domains/steamAccess/internalResolver');
const { createHostsUpdater } = require('./src/domains/steamAccess/hostsUpdater');
const { createRuntimeSetupState, getDownloaderMode: getStaticDownloaderMode } = require('./src/domains/runtime/setupState');
const depotTools = require('./src/domains/steamkit/depotTools');
const { createSteamKitRuntimeBuildService } = require('./src/domains/steamkit/runtimeBuild');
const { createSteamKitLoginService } = require('./src/domains/steamkit/login');
const { createSteamKitPersonalWorkshopService } = require('./src/domains/steamkit/personalWorkshop');
const { createSteamKitQueryBridge } = require('./src/domains/steamkit/queryBridge');
const { createSteamKitDownloadService } = require('./src/domains/steamkit/download');
const { createDepotStreamService } = require('./src/domains/steamkit/depotStream');
const { createPreparedDownloadStore } = require('./src/domains/downloads/preparedDownloads');
const { createCacheItemsService } = require('./src/domains/downloads/cacheItems');
const { createClientDownloadService } = require('./src/domains/downloads/clientDownloads');
const { createDownloadQueueService } = require('./src/domains/downloads/queue');
const { createDownloadFileSender } = require('./src/domains/downloads/fileSender');
const { createDownloadsController } = require('./src/domains/downloads/controller');
const { createMpkgConversionService } = require('./src/domains/mpkg/conversion');
const { createMpkgPreparationService } = require('./src/domains/mpkg/preparation');
const workshopText = require('./src/domains/workshop/text');
const { createWorkshopCommentsService } = require('./src/domains/workshop/comments');
const { createWorkshopDetailService } = require('./src/domains/workshop/detail');
const { createPublishedFileDetailsService } = require('./src/domains/workshop/fileDetails');
const { createWorkshopSearchService, mapWorkshopItem, requiresSteamCommunitySession, steamKitPersonalListType } = require('./src/domains/workshop/search');
const { parseFriendFavoriteSteamIds, buildPersonalSourceLabel } = require('./src/domains/workshop/personalSource');
const { createWorkshopSubscriptionService } = require('./src/domains/workshop/subscription');
const { createVideoController } = require('./src/domains/video/controller');
const { createUpdateService, isUpdateMutationAllowed } = require('./src/domains/updates/service');
const PACKAGE_JSON = require('./package.json');
const PORT   = process.env.PORT ? parseInt(process.env.PORT) : 3090;
const WALLHUB_INTERNAL_RESOLVER_TOKEN = crypto.randomBytes(24).toString('hex');
process.env.WALLHUB_DEPOT_RESOLVER_URL = `http://127.0.0.1:${PORT}/api/internal/steam/resolve`;
process.env.WALLHUB_DEPOT_RESOLVER_TOKEN = WALLHUB_INTERNAL_RESOLVER_TOKEN;
process.env.WALLHUB_DEPOT_WEBAPI_BROKER_URL = `http://127.0.0.1:${PORT}/api/internal/steam/webapi`;
process.env.WALLHUB_DEPOT_WEBAPI_BROKER_TOKEN = WALLHUB_INTERNAL_RESOLVER_TOKEN;
const PUBLIC = path.join(__dirname, 'public');
const IS_RESTART_CHILD = process.env.WALLHUB_RESTART_CHILD === '1';
const IS_SUPERVISOR_CHILD = process.env.WALLHUB_SUPERVISOR_CHILD === '1';

const PREPARED_DOWNLOAD_STORE = createPreparedDownloadStore();
const PREPARED_DOWNLOADS = PREPARED_DOWNLOAD_STORE.entries;
let SERVER_STOPPING = false;
let UPDATE_INSTALL_PENDING = false;
let ACTIVE_HTTP_REQUESTS = 0;

// -------------------------------------------------------------------------
let DOWNLOAD_QUEUE_SERVICE = null;
let TASK_QUEUE = [];
let MPKG_PREPARATION_SERVICE = null;
let REQUEST_UPDATE_SHUTDOWN = null;

const STEAM_CREDENTIALS = { username: '', password: '', steamGuardCode: '', isPersistent: false, pendingPersistentUsername: '' };

const NSFW_ENABLED = parseNsfwEnabledArg();
const DEBUG_ENABLED = parseDebugEnabledArg();

const PROJECT_ROOT = __dirname;
const STEAMKIT_ROOT = process.env.STEAMKIT_DIR || path.join(PROJECT_ROOT, 'SteamKit');
const DEFAULT_DOWNLOADS_DIR = path.join(PROJECT_ROOT, 'Downloads');
let DOWNLOADS_DIR = resolveConfiguredDownloadsDir(process.env.WALLHUB_DOWNLOADS_DIR || '');
const STEAMKIT_CONFIG_DIR = process.env.DEPOTDOWNLOADER_CONFIG_DIR || path.join(STEAMKIT_ROOT, 'account');
let WORKSHOP_CACHE_DIR = DOWNLOADS_DIR;
const ACTIVE_RUNNER_DIR = STEAMKIT_ROOT;
const ACTIVE_CONFIG_DIR = STEAMKIT_CONFIG_DIR;
const getDefaultSteamConfigDir = () => ACTIVE_CONFIG_DIR;

const RUNTIME_SETUP_STORE = createRuntimeSetupState({
  mode: 'steamkit',
  requestedMode: 'steamkit',
  status: 'idle',
  message: '',
  progress: 0,
  runnerDir: ACTIVE_RUNNER_DIR,
  downloadsDir: DOWNLOADS_DIR,
  executablePath: '',
  error: '',
  updatedAt: Date.now()
});
const RUNTIME_SETUP = RUNTIME_SETUP_STORE.state;
const CACHE_SETTINGS_FILE = path.join(__dirname, 'cache-settings.json');
const CACHE_SETTINGS_STORE = createCacheSettingsStore({
  settingsFile: CACHE_SETTINGS_FILE,
  defaultSettings: DEFAULT_CACHE_SETTINGS,
  logger: console,
});
let VIDEO_CACHE_SETTINGS = CACHE_SETTINGS_STORE.state; // Default settings
let RUNTIME_SETTINGS = null;

function mpkgDebugEnabled() {
  const configured = String((VIDEO_CACHE_SETTINGS && VIDEO_CACHE_SETTINGS.wallhubLogLevel) || process.env.WALLHUB_LOG_LEVEL || '').trim().toLowerCase();
  return DEBUG_ENABLED || configured === 'debug' || /^(?:1|true|yes|on|debug)$/i.test(String(process.env.WALLHUB_MPKG_DEBUG || '').trim());
}

function getRuntimeSettings() {
  if (!RUNTIME_SETTINGS) {
    RUNTIME_SETTINGS = createRuntimeSettings({
      cacheSettingsStore: CACHE_SETTINGS_STORE,
      getSettings: () => VIDEO_CACHE_SETTINGS,
      setSettings: (next) => { VIDEO_CACHE_SETTINGS = next; },
      env: process.env,
      normalizeMaxConcurrentDownloads,
      normalizeDepotStreamCacheMaxMb,
      normalizeSteamContentCellId,
      normalizeSteamKitMaxDownloads,
      normalizeSteamCdnRouteStrategy,
      getDefaultSteamKitMaxDownloads,
      applySteamHttpProxyEnvFromUrl,
      buildSteamContentEnvForStrategy,
      applyDownloadDir: (raw, options) => setDownloadsDir(raw || DEFAULT_DOWNLOADS_DIR, options),
      getCurrentDownloadDir: () => DOWNLOADS_DIR,
      getNsfwEnabled: () => NSFW_ENABLED,
    });
  }
  return RUNTIME_SETTINGS;
}
const GITHUB_ACCELERATOR_MODE = String(process.env.WALLHUB_GITHUB_ACCELERATOR || 'auto').trim().toLowerCase();
const UPDATE_SERVICE = createUpdateService({
  currentVersion: PACKAGE_JSON.version,
  projectRoot: PROJECT_ROOT,
  env: process.env,
  platform: process.platform,
  arch: process.arch,
  supervised: IS_SUPERVISOR_CHILD,
  logger: console,
  getAutoUpdateEnabled: () => !!VIDEO_CACHE_SETTINGS.wallhubAutoUpdateEnabled,
  getProxyUrl: () => String(VIDEO_CACHE_SETTINGS.steamHttpProxyUrl || ''),
  isInstallSafe: () => {
    const queueBusy = TASK_QUEUE.some(task => (
      ['pending', 'downloading', 'moving'].includes(String(task && task.status || '')) ||
      !!(task && (task.livePaused || task.processPromise || task._runnerActive))
    ));
    const conversionBusy = !!(MPKG_PREPARATION_SERVICE && Array.from(MPKG_PREPARATION_SERVICE.jobs.values()).some(job => job.status === 'preparing'));
    const directConversionBusy = !!(MPKG_SERVICE && MPKG_SERVICE.buildPromises.size > 0);
    const steamLoginBusy = !!(STEAMKIT_LOGIN_SERVICE && Array.from(STEAMKIT_LOGIN_SERVICE.sessions.values()).some(session => !session.done && session.processPromise));
    return !queueBusy && !conversionBusy && !directConversionBusy && !steamLoginBusy && ACTIVE_HTTP_REQUESTS === 0;
  },
  onInstallStarting: () => { UPDATE_INSTALL_PENDING = true; },
  onInstallCancelled: () => { UPDATE_INSTALL_PENDING = false; },
  onInstallPrepared: () => {
    if (typeof REQUEST_UPDATE_SHUTDOWN === 'function') REQUEST_UPDATE_SHUTDOWN();
  },
});

let STEAM_ACCESS_HOSTS_UPDATER = null;
const STEAM_ACCESS_GATEWAY = createSteamAccessGateway({
  userAgent: 'WallHub',
  logger: console,
  configDir: STEAMKIT_CONFIG_DIR,
  enabled: () => steamAccessGatewayEnabled(),
  getAccessMode: () => VIDEO_CACHE_SETTINGS.wallhubSteamAccessMode,
  getHostsText: () => VIDEO_CACHE_SETTINGS.wallhubSteamAccessHosts,
  getResolverProtocol: () => VIDEO_CACHE_SETTINGS.wallhubSteamAccessResolverProtocol,
  getDohEndpoint: () => VIDEO_CACHE_SETTINGS.wallhubSteamAccessDohEndpoint,
  getDohMode: () => VIDEO_CACHE_SETTINGS.wallhubSteamAccessDohMode,
  getDotEndpoint: () => VIDEO_CACHE_SETTINGS.wallhubSteamAccessDotEndpoint,
  getDotMode: () => VIDEO_CACHE_SETTINGS.wallhubSteamAccessDotMode,
  getSelectedDohEndpoints: () => VIDEO_CACHE_SETTINGS.wallhubSteamAccessSelectedDohEndpoints,
  getCustomDohEndpoints: () => VIDEO_CACHE_SETTINGS.wallhubSteamAccessCustomDohEndpoints,
  getSelectedDotEndpoints: () => VIDEO_CACHE_SETTINGS.wallhubSteamAccessSelectedDotEndpoints,
  getCustomDotEndpoints: () => VIDEO_CACHE_SETTINGS.wallhubSteamAccessCustomDotEndpoints,
  getHostsLastUpdatedAt: () => VIDEO_CACHE_SETTINGS.wallhubSteamAccessHostsLastUpdatedAt,
  getHostsLastError: () => VIDEO_CACHE_SETTINGS.wallhubSteamAccessHostsLastError,
  getHostsNextUpdateAt: () => STEAM_ACCESS_HOSTS_UPDATER ? STEAM_ACCESS_HOSTS_UPDATER.nextUpdateAt() : 0,
  getExperimental: () => getRuntimeSettings().getSteamAccessExperimental(),
  githubAcceleratorMode: GITHUB_ACCELERATOR_MODE,
  directWebApi: () => steamAccessDirectWebApiEnabled(),
  isGatewayHost: steamAccessGatewayHostEnabledForHost,
  reuseConnectionForHost: (host) => getRuntimeSettings().steamAccessStaticCdnHostConnectionReuseEnabled(host),
  isStaticCdnHost: isSteamStaticCdnHost,
  isAndroidHostLikeEnv,
});
STEAM_ACCESS_HOSTS_UPDATER = createHostsUpdater({
  userAgent: 'WallHub',
  getSettings: () => VIDEO_CACHE_SETTINGS,
  applyPatch: (patch) => {
    getRuntimeSettings().setState(VIDEO_CACHE_SETTINGS);
    const result = getRuntimeSettings().applyPatch(patch);
    VIDEO_CACHE_SETTINGS = result.settings;
    return result;
  },
  saveSettings: () => saveCacheSettings(),
  clearGateway: () => STEAM_ACCESS_GATEWAY.clear(),
  logger: STEAM_ACCESS_GATEWAY.logger || console,
});
const handleInternalSteamResolve = createInternalSteamResolverHandler({
  token: WALLHUB_INTERNAL_RESOLVER_TOKEN,
  resolveHost: (host) => STEAM_ACCESS_GATEWAY.resolveHost(host),
  chooseRoute: (host, port, options) => STEAM_ACCESS_GATEWAY.chooseRoute(host, port, options),
  jsonRes,
  logger: console,
});
const handleInternalSteamWebApi = createInternalSteamWebApiBrokerHandler({
  token: WALLHUB_INTERNAL_RESOLVER_TOKEN,
  requestSteam: (opts, body, timeout) => STEAM_ACCESS_GATEWAY.request(opts, body, timeout),
  jsonRes,
  logger: console,
});
const WALLHUB_URL_PROXY_CACHE_DIR = process.env.WALLHUB_URL_PROXY_CACHE_DIR || path.join(STEAMKIT_CONFIG_DIR, 'url-proxy-cache');
const WALLHUB_PROXY_VIRTUAL_HOST_PARAM = '__whp_host';
const WALLHUB_URL_PROXY_CACHE_VERSION = RUNTIME_TUNING.URL_PROXY_CACHE.version;
const WALLHUB_URL_PROXY_CACHE_MAX_BYTES = RUNTIME_TUNING.URL_PROXY_CACHE.maxBytes;
const WALLHUB_URL_PROXY_CACHE_ENTRY_MAX_BYTES = RUNTIME_TUNING.URL_PROXY_CACHE.entryMaxBytes;
const WALLHUB_URL_PROXY_CACHE_TTL_MS = RUNTIME_TUNING.URL_PROXY_CACHE.ttlMs;
const WALLHUB_PROXY_COOKIES = createSteamProxyCookieTools({ isSteamHost });
const WALLHUB_PROXY_REWRITE = createSteamProxyRewriteTools({
  virtualHostParam: WALLHUB_PROXY_VIRTUAL_HOST_PARAM,
  isSteamHost,
  isSteamStaticCdnHost,
  isSteamCommunityHost,
  steamResourceContentType: (url) => steamResourceContentType(url),
});
const WALLHUB_URL_PROXY_CACHE = createSteamProxyCache({
  cacheDir: WALLHUB_URL_PROXY_CACHE_DIR,
  version: WALLHUB_URL_PROXY_CACHE_VERSION,
  maxBytes: WALLHUB_URL_PROXY_CACHE_MAX_BYTES,
  entryMaxBytes: WALLHUB_URL_PROXY_CACHE_ENTRY_MAX_BYTES,
  ttlMs: WALLHUB_URL_PROXY_CACHE_TTL_MS,
  steamResourceContentType: (url) => steamResourceContentType(url),
});
const WALLHUB_PROXY_REQUESTER = createWallhubProxyRequester({
  isSocksProxyProtocol,
  connectViaSocksProxy,
  proxyAuth,
});
const STEAM_CDN_RECENT_LIMIT = RUNTIME_TUNING.STEAM_CDN_RECENT_LIMIT;
const STEAM_CDN_STATUS_STORE = createSteamCdnStatusStore({
  limit: STEAM_CDN_RECENT_LIMIT,
  getStrategy: () => getSteamCdnRouteStrategy(),
  getMode: () => startupDownloaderMode(),
});
const TOOLS_DIR = path.join(__dirname, 'tools');
const DEPOT_DOWNLOADER_DIR = process.env.DEPOTDOWNLOADER_DIR || path.join(STEAMKIT_ROOT, 'DepotDownloader');
const DEPOT_STREAM_DOWNLOADER_DIR = process.env.WALLHUB_DEPOT_STREAM_DIR || path.join(STEAMKIT_ROOT, 'DepotDownloaderStream');
const DEPOT_JSON_PROGRESS_DIR = DEPOT_DOWNLOADER_DIR;
const DEPOT_JSON_PROGRESS_SOURCE_ZIP = process.env.WALLHUB_DEPOT_SOURCE_ZIP || 'https://github.com/SteamRE/DepotDownloader/archive/refs/heads/master.zip';
const DEPOT_JSON_PROGRESS_PATCH_VERSION = 'wallhub-json-progress-v41-native-personal-sort';
const DEPOT_STREAM_PATCH_VERSION = 'wallhub-stream-v42-native-personal-sort';
const DEPOT_CONFIG_DIR = STEAMKIT_CONFIG_DIR;
const DEPOT_HOME_DIR = process.env.WALLHUB_DEPOT_HOME_DIR || path.join(STEAMKIT_CONFIG_DIR, 'home');
const DEPOT_DOTNET_CLI_HOME_DIR = process.env.WALLHUB_DEPOT_DOTNET_CLI_HOME || path.join(STEAMKIT_CONFIG_DIR, 'dotnet-home');
const DEPOT_XDG_DATA_HOME_DIR = process.env.WALLHUB_DEPOT_XDG_DATA_HOME || path.join(STEAMKIT_CONFIG_DIR, 'xdg-data');
const DEPOT_XDG_CONFIG_HOME_DIR = process.env.WALLHUB_DEPOT_XDG_CONFIG_HOME || path.join(STEAMKIT_CONFIG_DIR, 'xdg-config');
const DEPOT_LOCALAPPDATA_DIR = process.env.WALLHUB_DEPOT_LOCALAPPDATA || path.join(STEAMKIT_CONFIG_DIR, 'localappdata');
const DEPOT_APPDATA_DIR = process.env.WALLHUB_DEPOT_APPDATA || path.join(STEAMKIT_CONFIG_DIR, 'appdata');
const DEPOT_STREAM_CACHE_DIR = process.env.WALLHUB_DEPOT_STREAM_CACHE_DIR || path.join(STEAMKIT_CONFIG_DIR, 'depot-stream-cache');
const DEPOT_STREAM_MAX_RANGE_BYTES = RUNTIME_TUNING.DEPOT_STREAM.maxRangeBytes;
const DEPOT_STREAM_FIRST_RANGE_BYTES = RUNTIME_TUNING.DEPOT_STREAM.firstRangeBytes;
const DEPOT_STREAM_TAIL_BYTES = RUNTIME_TUNING.DEPOT_STREAM.tailBytes;
const DEPOT_STREAM_INITIAL_BUFFER_BYTES = RUNTIME_TUNING.DEPOT_STREAM.initialBufferBytes;
const DEPOT_STREAM_AHEAD_BYTES = RUNTIME_TUNING.DEPOT_STREAM.aheadBytes;
const DEPOT_STREAM_READY_TIMEOUT_MS = RUNTIME_TUNING.DEPOT_STREAM.readyTimeoutMs;
const DEPOT_STREAM_WORKER_IDLE_MS = RUNTIME_TUNING.DEPOT_STREAM.workerIdleMs;
const DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK = RUNTIME_TUNING.DEPOT_STREAM.cleanupHighWatermark;
const DEPOT_STREAM_CACHE_CLEANUP_TARGET = RUNTIME_TUNING.DEPOT_STREAM.cleanupTarget;
const DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS = RUNTIME_TUNING.DEPOT_STREAM.cleanupDebounceMs;

function resolveConfiguredDownloadsDir(raw) {
  return resolveConfiguredDownloadsDirPath(raw, PROJECT_ROOT, DEFAULT_DOWNLOADS_DIR);
}

function setDownloadsDir(raw, options = {}) {
  const nextDir = resolveConfiguredDownloadsDir(raw);
  if (fs.existsSync(nextDir) && !fs.statSync(nextDir).isDirectory()) {
    throw new Error(`下载目录不是文件夹: ${nextDir}`);
  }
  fs.mkdirSync(nextDir, { recursive: true });
  DOWNLOADS_DIR = nextDir;
  WORKSHOP_CACHE_DIR = nextDir;
  RUNTIME_SETUP.downloadsDir = nextDir;
  if (options.persist !== false) {
    VIDEO_CACHE_SETTINGS.downloadDir = nextDir;
    saveCacheSettings();
  }
  return nextDir;
}

function getMaxConcurrentDownloads() {
  return getRuntimeSettings().getMaxConcurrentDownloads();
}

function getDepotStreamCacheMaxMb() {
  return getRuntimeSettings().getDepotStreamCacheMaxMb();
}

function getDepotStreamCacheMaxBytes() {
  return getRuntimeSettings().getDepotStreamCacheMaxBytes();
}

function getSteamContentCellId() {
  return getRuntimeSettings().getSteamContentCellId();
}

function getSteamKitMaxDownloads() {
  return getRuntimeSettings().getSteamKitMaxDownloads();
}

function getSteamKitStreamMaxDownloads() {
  return getRuntimeSettings().getSteamKitStreamMaxDownloads();
}

function getSteamKitLoginMaxDownloads() {
  return getRuntimeSettings().getSteamKitLoginMaxDownloads();
}

function applySteamHttpProxyEnv(baseEnv = process.env) {
  return getRuntimeSettings().applySteamHttpProxyEnv(baseEnv);
}

function getSteamCdnRouteStrategy() {
  return getRuntimeSettings().getSteamCdnRouteStrategy();
}

function buildSteamContentEnv(baseEnv = process.env) {
  return getRuntimeSettings().buildSteamContentEnv(baseEnv);
}

function describeSteamCdnRouteStrategy() {
  return getRuntimeSettings().describeSteamCdnRouteStrategy();
}

function updateSteamCdnStatus(data = {}) {
  return STEAM_CDN_STATUS_STORE.update(data);
}

function steamCdnStatusSnapshot() {
  return STEAM_CDN_STATUS_STORE.snapshot();
}

function updateSteamCdnStatusFromText(text, meta = {}) {
  STEAM_CDN_STATUS_STORE.updateFromText(text, meta);
}

// -------------------------------------------------------------------------
function ensureSteamConfigDir() {
  try {
    const dirs = [DOWNLOADS_DIR, ACTIVE_CONFIG_DIR];
    if (startupDownloaderMode() === 'steamkit') dirs.push(DEPOT_STREAM_CACHE_DIR);
    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[Runtime] Created directory: ${dir}`);
      }
    }
    migrateExistingWorkshopContent();
    cleanupRuntimeDownloadResidues(431960, TASK_QUEUE.map(t => t.id));
  } catch (e) {
    console.warn('[Runtime] Failed to create runtime directories:', e.message);
  }
}

function migrateExistingWorkshopContent() {
  const roots = [
    path.join(STEAMKIT_CONFIG_DIR, 'steamapps', 'workshop', 'content', '431960'),
  ];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let ents = [];
    try { ents = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const ent of ents) {
      if (!ent.isDirectory() || !/^\d+$/.test(ent.name)) continue;
      const src = path.join(root, ent.name);
      const dest = path.join(DOWNLOADS_DIR, ent.name);
      if (fs.existsSync(dest)) continue;
      try {
        copyDirContents(src, dest);
        console.log(`[Runtime] Migrated cached workshop item ${ent.name} -> ${dest}`);
      } catch (e) {
        console.warn(`[Runtime] Failed to migrate workshop item ${ent.name}:`, e.message);
      }
    }
  }
}

// -------------------------------------------------------------------------
function loadCacheSettings() {
  VIDEO_CACHE_SETTINGS = getRuntimeSettings().load();
}

// -------------------------------------------------------------------------
function saveCacheSettings() {
  VIDEO_CACHE_SETTINGS = getRuntimeSettings().save();
}

function cacheSettingsSnapshot(extra = {}) {
  return getRuntimeSettings().snapshot(extra);
}

function cacheSettingsSnapshotWithMpkgCapabilities(extra = {}, options = {}) {
  const capabilities = getMpkgService().getCapabilities();
  const snapshot = cacheSettingsSnapshot({
    mpkgCompactAvailable: capabilities.compactAvailable,
    mpkgCompactUnavailableReason: capabilities.compactUnavailableReason,
    ...extra,
  });
  if (!options.includeSteamAccessHosts) {
    delete snapshot.wallhubSteamAccessHosts;
    snapshot.wallhubSteamAccessHostsDeferred = true;
  }
  return snapshot;
}

// -------------------------------------------------------------------------
const STEAM_PREF_COOKIE = [
  'birthtime=946684801',
  'lastagecheckage=1-January-2000',
  'mature_content=1',
  'wants_mature_content=1',
  'wants_mature_content_violence=1',
  'wants_mature_content_sex=1',
  'wants_adult_content=1',
  'wants_adult_content_violence=1',
  'wants_adult_content_sex=1',
  'wants_community_generated_adult_content=1',
  process.env.STEAM_COUNTRY ? `steamCountry=${process.env.STEAM_COUNTRY}` : '',
  `Steam_Language=${process.env.STEAM_LANG || 'schinese'}`,
  'timezoneOffset=28800,0',
].filter(Boolean).join('; ');

// -------------------------------------------------------------------------
function initializeSteamCredentials() {
  const cachedUser = String(VIDEO_CACHE_SETTINGS.steamUsername || '').trim();
  const cachedPersistent = !!VIDEO_CACHE_SETTINGS.steamIsPersistent;
  if (cachedUser && cachedPersistent) {
    STEAM_CREDENTIALS.username = cachedUser;
    STEAM_CREDENTIALS.password = '';
    STEAM_CREDENTIALS.steamGuardCode = '';
    STEAM_CREDENTIALS.isPersistent = true;
    STEAM_CREDENTIALS.pendingPersistentUsername = cachedUser;
    console.log(`[Steam Init] Found cached username, pending runtime session validation: ${cachedUser}`);
  }

  if (!STEAM_CREDENTIALS.pendingPersistentUsername) {
    console.log('[Steam Init] No persistent login found, using anonymous or env credentials');
  }
  const steamAccessShouldWarm = steamAccessGatewayEnabled();
  if (steamAccessShouldWarm) {
    if (VIDEO_CACHE_SETTINGS.wallhubSteamAccessEnhance) warmupSteamAccessGatewayCore('startup', { forceRefresh: false });
    setTimeout(() => warmupSteamAccessGatewayCdnBackground('startup-cdn').catch(() => {}), 8000).unref?.();
  }
}

// -------------------------------------------------------------------------
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

function getProxyCandidates(protocol, hostname) {
  const list = [];
  const add = (p) => { if (p && p.hostname) list.push(p); };
  const customProxyHost = String(process.env.WALLHUB_PROXY_HOST || '').trim();
  const explicitProxy = parseProxyUrl(process.env.WALLHUB_PROXY || process.env.wallhub_proxy || '');
  add(explicitProxy);
  const settingsProxy = shouldUseSettingsSteamHttpProxy(hostname)
    ? parseProxyUrl(VIDEO_CACHE_SETTINGS.steamHttpProxyUrl || '')
    : null;
  add(settingsProxy);
  const resolved = explicitProxy || settingsProxy ? null : resolveProxyForProtocol(protocol);
  add(resolved);
  if (customProxyHost && resolved && /^(127\.0\.0\.1|localhost)$/i.test(resolved.hostname)) {
    add(parseProxyUrl(`http://${customProxyHost}:${resolved.port || 80}`));
  }
  const extraPortsRaw = String(process.env.WALLHUB_PROXY_PORTS || '').trim();
  if (extraPortsRaw && process.platform === 'win32') {
    const ports = extraPortsRaw
      .split(',')
      .map(s => parseInt(String(s).trim()))
      .filter(n => n > 0 && n < 65536);
    const hosts = customProxyHost ? ['127.0.0.1', 'localhost', customProxyHost] : ['127.0.0.1', 'localhost'];
    for (const p of ports) {
      for (const h of hosts) add(parseProxyUrl(`http://${h}:${p}`));
    }
  }
  const seen = new Set();
  const uniq = [];
  for (const p of list) {
    const k = proxyKey(p);
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
  }
  if (!seen.has('direct') && shouldAppendDirectProxyFallback(hostname, settingsProxy)) {
    uniq.push(null);
  }
  return uniq;
}
function steamAccessGatewayEnabled() {
  return getRuntimeSettings().steamAccessGatewayEnabled();
}
function steamAccessDirectWebApiEnabled() {
  return getRuntimeSettings().steamAccessDirectWebApiEnabled();
}
function getSteamWebApiBaseUrl() {
  return getRuntimeSettings().getSteamWebApiBaseUrl();
}
function getSteamApiKey() {
  const fromSettings = String(VIDEO_CACHE_SETTINGS.steamApiKey || '').trim();
  const fromEnv = String(process.env.STEAM_API_KEY || '').trim();
  return fromSettings || fromEnv;
}
function isSteamWebApiHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  return host === 'api.steampowered.com';
}
function hostMatchesSteamAccessBlacklist(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  const list = getRuntimeSettings().getSteamAccessHostBlacklist();
  return list.some(item => host === item || host.endsWith(`.${item}`));
}
function steamAccessGatewayHostEnabledForHost(hostname) {
  const host = String(hostname || '').trim().toLowerCase();
  if (!host || hostMatchesSteamAccessBlacklist(host)) return false;
  if (isSteamAccessGatewayHost(host)) return !!VIDEO_CACHE_SETTINGS.wallhubSteamAccessEnhance;
  return getRuntimeSettings().steamAccessStaticCdnHostEnhanceEnabled(host) && isSteamStaticCdnHost(host);
}
function shouldUseSteamAccessGatewayForRequest(opts, proxy) {
  if (opts && isSteamWebApiHost(opts.hostname) && steamAccessDirectWebApiEnabled()) return false;
  return shouldUseSteamAccessGateway(opts, proxy);
}
function getProxyCandidatesForRequest(protocol, hostname) {
  if (isSteamWebApiHost(hostname) && steamAccessDirectWebApiEnabled()) return [null];
  return getProxyCandidates(protocol, hostname);
}
function stripProxyEnvForRequest(env) {
  return stripProxyEnv(env);
}
function shouldUseSettingsSteamHttpProxy(hostname) {
  if (getSteamCdnRouteStrategy() !== 'proxy') return false;
  if (!String(VIDEO_CACHE_SETTINGS.steamHttpProxyUrl || '').trim()) return false;
  return isSteamHost(hostname);
}
function shouldAppendDirectProxyFallback(hostname, settingsProxy) {
  if (settingsProxy && isSteamHost(hostname)) return false;
  return true;
}
function isIpLiteral(hostname) {
  return net.isIP(String(hostname || '').trim()) !== 0;
}

const removeSteamAccessCachedIp = STEAM_ACCESS_GATEWAY.removeCachedIp.bind(STEAM_ACCESS_GATEWAY);
const chooseSteamAccessRoute = STEAM_ACCESS_GATEWAY.chooseRoute.bind(STEAM_ACCESS_GATEWAY);
const steamAccessStatusSnapshot = STEAM_ACCESS_GATEWAY.statusSnapshot.bind(STEAM_ACCESS_GATEWAY);
const steamAccessDiagnosticSnapshot = STEAM_ACCESS_GATEWAY.diagnosticSnapshot.bind(STEAM_ACCESS_GATEWAY);
const steamAccessRuntimeSnapshot = STEAM_ACCESS_GATEWAY.runtimeSnapshot.bind(STEAM_ACCESS_GATEWAY);
const steamAccessPolicyForHost = STEAM_ACCESS_GATEWAY.policyForHost.bind(STEAM_ACCESS_GATEWAY);
const warmupSteamAccessGateway = STEAM_ACCESS_GATEWAY.warmup.bind(STEAM_ACCESS_GATEWAY);
const warmupSteamAccessGatewayCore = STEAM_ACCESS_GATEWAY.warmupCore.bind(STEAM_ACCESS_GATEWAY);
const warmupSteamAccessGatewayControlPlane = STEAM_ACCESS_GATEWAY.warmupControlPlane.bind(STEAM_ACCESS_GATEWAY);
const warmupSteamAccessGatewayCdnBackground = STEAM_ACCESS_GATEWAY.warmupCdnBackground.bind(STEAM_ACCESS_GATEWAY);
const ensureSteamAccessGatewayReady = STEAM_ACCESS_GATEWAY.ensureReady.bind(STEAM_ACCESS_GATEWAY);
const logSteamAccessResolvedRoutes = STEAM_ACCESS_GATEWAY.logResolvedRoutes.bind(STEAM_ACCESS_GATEWAY);
const isSteamAccessGatewayWarmingUp = STEAM_ACCESS_GATEWAY.isWarmingUp.bind(STEAM_ACCESS_GATEWAY);
const shouldUseSteamAccessGateway = STEAM_ACCESS_GATEWAY.shouldUse.bind(STEAM_ACCESS_GATEWAY);
const doRequestBySteamAccessGateway = STEAM_ACCESS_GATEWAY.request.bind(STEAM_ACCESS_GATEWAY);
const doStreamBySteamAccessGateway = STEAM_ACCESS_GATEWAY.requestStream.bind(STEAM_ACCESS_GATEWAY);

const HTTP_CLIENT = createHttpClient({
  userAgent: UA,
  steamPrefCookie: STEAM_PREF_COOKIE,
  getProxyCandidates: getProxyCandidatesForRequest,
  shouldUseGateway: shouldUseSteamAccessGatewayForRequest,
  requestByGateway: doRequestBySteamAccessGateway,
  appendCurlProxyArgs,
  stripProxyEnv,
  shouldRetryWithNextProxy,
  isSocksProxyProtocol,
  connectViaSocksProxy,
  proxyAuth,
  isAndroidHostLikeEnv,
  isSteamAccessFallbackHost: steamAccessGatewayHostEnabledForHost,
  steamAccessGatewayEnabled,
  logger: console,
});

function doRequest(opts, body, redirects, proxyIndex) {
  return HTTP_CLIENT.doRequest(opts, body, redirects, proxyIndex);
}

function GET(url, extra, timeout) {
  return HTTP_CLIENT.get(url, extra, timeout);
}

function POST(url, body, timeout, extra) {
  return HTTP_CLIENT.post(url, body, timeout, extra);
}

function steamResourceContentType(url) {
  return contentTypeFromUrl(url);
}

const PUBLISHED_FILE_DETAILS_SERVICE = createPublishedFileDetailsService({
  post: POST,
  getSteamWebApiBaseUrl,
  logger: console,
});
const WORKSHOP_COMMENTS_SERVICE = createWorkshopCommentsService({
  doRequest,
  userAgent: UA,
  steamPrefCookie: STEAM_PREF_COOKIE,
  logger: console,
  isAndroidHostLikeEnv,
});
const STEAM_PERSONA_SERVICE = createSteamPersonaService({
  get: GET,
  logger: console,
});

const parseWallhubUrlProxyTarget = WALLHUB_PROXY_REWRITE.parseWallhubUrlProxyTarget;
const isWallhubProxyVirtualLoginPath = WALLHUB_PROXY_REWRITE.isWallhubProxyVirtualLoginPath;
const isWallhubProxyVirtualSteamPath = WALLHUB_PROXY_REWRITE.isWallhubProxyVirtualSteamPath;
const wallhubVirtualSteamProxyPath = WALLHUB_PROXY_REWRITE.wallhubVirtualSteamProxyPath;
const parseWallhubVirtualSteamProxyTarget = WALLHUB_PROXY_REWRITE.parseWallhubVirtualSteamProxyTarget;
const wallhubUrlProxyPath = WALLHUB_PROXY_REWRITE.wallhubUrlProxyPath;
const rewriteWallhubProxyEscapedUrls = WALLHUB_PROXY_REWRITE.rewriteWallhubProxyEscapedUrls;
const rewriteWallhubProxyHtml = WALLHUB_PROXY_REWRITE.rewriteWallhubProxyHtml;
const rewriteWallhubProxyCss = WALLHUB_PROXY_REWRITE.rewriteWallhubProxyCss;
const rewriteWallhubProxyMediaManifest = WALLHUB_PROXY_REWRITE.rewriteWallhubProxyMediaManifest;
const injectWallhubProxyClientScript = WALLHUB_PROXY_REWRITE.injectWallhubProxyClientScript;
const inferWallhubProxyContentType = WALLHUB_PROXY_REWRITE.inferWallhubProxyContentType;

const wallhubProxyPathExt = WALLHUB_PROXY_REWRITE.wallhubProxyPathExt;
const isWallhubProxyTextType = WALLHUB_PROXY_REWRITE.isWallhubProxyTextType;
const isWallhubProxyHtmlType = WALLHUB_PROXY_REWRITE.isWallhubProxyHtmlType;
const isWallhubProxyStaticAsset = WALLHUB_PROXY_REWRITE.isWallhubProxyStaticAsset;
const shouldRewriteWallhubProxyText = WALLHUB_PROXY_REWRITE.shouldRewriteWallhubProxyText;
const collectWallhubProxyPrefetchUrls = WALLHUB_PROXY_REWRITE.collectWallhubProxyPrefetchUrls;
const isWallhubSteamAuthApiTarget = WALLHUB_PROXY_REWRITE.isWallhubSteamAuthApiTarget;
const isWallhubSteamWebApiServiceTarget = WALLHUB_PROXY_REWRITE.isWallhubSteamWebApiServiceTarget;
const isSteamQrChallengeUrl = WALLHUB_PROXY_REWRITE.isSteamQrChallengeUrl;
const wallhubProxyHeaderValue = steamProxyHeaderValue;
const wallhubProxyUpstreamCookie = WALLHUB_PROXY_COOKIES.wallhubProxyUpstreamCookie;
const wallhubProxyCookieValue = WALLHUB_PROXY_COOKIES.wallhubProxyCookieValue;
const transformWallhubProxySetCookie = WALLHUB_PROXY_COOKIES.transformWallhubProxySetCookie;

const WALLHUB_URL_PROXY_TOOLS = createWallhubUrlProxyTools({
  userAgent: UA,
  steamPrefCookie: STEAM_PREF_COOKIE,
  virtualHostParam: WALLHUB_PROXY_VIRTUAL_HOST_PARAM,
  logger: console,
  isSteamHost,
  isSteamAccessGatewayHost: steamAccessGatewayHostEnabledForHost,
  isSteamStaticCdnHost,
  isSteamBroadcastResource,
  isAuthApiTarget: isWallhubSteamAuthApiTarget,
  isWebApiServiceTarget: isWallhubSteamWebApiServiceTarget,
  isProxyHtmlType: isWallhubProxyHtmlType,
  isProxyStaticAsset: isWallhubProxyStaticAsset,
  headerValue: wallhubProxyHeaderValue,
  upstreamCookie: wallhubProxyUpstreamCookie,
  upstreamCookieValue: wallhubProxyCookieValue,
  transformSetCookie: transformWallhubProxySetCookie,
  urlProxyPath: wallhubUrlProxyPath,
  parseProxyTarget: parseWallhubUrlProxyTarget,
  parseVirtualProxyTarget: parseWallhubVirtualSteamProxyTarget,
  virtualProxyPath: wallhubVirtualSteamProxyPath,
  isVirtualLoginPath: isWallhubProxyVirtualSteamPath,
  inferContentType: inferWallhubProxyContentType,
  jsonRes,
  readBodyBuffer,
  decodeBody: (body, headers) => steamProxyHttp.decodeWallhubProxyBody(body, headers, console),
  isSteamCommunityHost,
  rewrite: {
    escapedUrls: rewriteWallhubProxyEscapedUrls,
    jsonText: WALLHUB_PROXY_REWRITE.rewriteWallhubProxyJsonText,
    jsText: WALLHUB_PROXY_REWRITE.rewriteWallhubProxyJsText,
    html: rewriteWallhubProxyHtml,
    css: rewriteWallhubProxyCss,
    mediaManifest: rewriteWallhubProxyMediaManifest,
    injectClientScript: injectWallhubProxyClientScript,
    pathExt: wallhubProxyPathExt,
    isTextType: isWallhubProxyTextType,
    shouldRewriteText: shouldRewriteWallhubProxyText,
    collectPrefetchUrls: collectWallhubProxyPrefetchUrls,
  },
  cache: WALLHUB_URL_PROXY_CACHE,
  requestOnce: (target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions) =>
    WALLHUB_PROXY_REQUESTER.requestOnce(target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions),
  requestStream: (target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions) =>
    WALLHUB_PROXY_REQUESTER.requestStream(target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions),
  bufferResponse: (response) => steamProxyRequestBufferResponse(response),
  gatewayEnabled: steamAccessGatewayEnabled,
  chooseGatewayRoute: chooseSteamAccessRoute,
  removeGatewayCachedIp: removeSteamAccessCachedIp,
  requestByGatewayStream: doStreamBySteamAccessGateway,
  getSteamAccessPolicy: steamAccessPolicyForHost,
  getProxyCandidates,
  shouldRetryWithNextProxy,
});

async function handleWallhubSteamAppRelativeAsset(req, res) {
  return WALLHUB_URL_PROXY_TOOLS.handleSteamAppRelativeAsset(req, res, handleWallhubUrlProxy);
}

async function handleWallhubVirtualSteamProxy(req, res) {
  return WALLHUB_URL_PROXY_TOOLS.handleVirtualSteamProxy(req, res, handleWallhubUrlProxy);
}

async function handleWallhubUrlProxy(req, res) {
  return WALLHUB_URL_PROXY_TOOLS.handleUrlProxy(req, res);
}

async function getFileDetails(ids, timeoutMs) {
  return PUBLISHED_FILE_DETAILS_SERVICE.get(ids, timeoutMs);
}

async function getFileDetailsSafe(ids, optionsForRun) {
  return PUBLISHED_FILE_DETAILS_SERVICE.getSafe(ids, optionsForRun);
}

let WORKSHOP_SEARCH_SERVICE = null;
function getWorkshopSearchService() {
  if (!WORKSHOP_SEARCH_SERVICE) {
    WORKSHOP_SEARCH_SERVICE = createWorkshopSearchService({
      get: GET,
      getFileDetailsSafe,
      getSteamApiKey,
      getSteamWebApiBaseUrl,
      querySteamKitUserFiles,
      steamAccessGatewayEnabled,
      getSteamAccessMode: () => VIDEO_CACHE_SETTINGS.wallhubSteamAccessMode,
      isAndroidHostLikeEnv,
      nsfwEnabled: () => NSFW_ENABLED,
      logger: console,
    });
  }
  return WORKSHOP_SEARCH_SERVICE;
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
    if (steamAccessGatewayEnabled() && !isSteamAccessGatewayWarmingUp()) {
      await ensureSteamAccessGatewayReady('query-core', 1500);
    }
    const proxyCommunityCookie = wallhubProxyUpstreamCookie(req.headers.cookie || '', 'steamcommunity.com');
    const params = payload.params || {};
    const needsAccountCommunityCookie = requiresSteamCommunitySession(params);
    const steamKitPersonalType = steamKitPersonalListType(params);
    const useSteamKitUserFiles = !!steamKitPersonalType && steamKitPersistentLoginIsUsable() && effectiveDownloaderMode() === 'steamkit';
    const steamKitQueryAvailable = useSteamKitUserFiles;
    const needsCommunityCookie = needsAccountCommunityCookie;
    let steamCommunityCookie = '';
    let steamKitCommunityCookie = '';
    const prepareSteamCommunityCookie = async () => {
      steamKitCommunityCookie = await resolveSteamKitCommunityCookie();
      steamCommunityCookie = steamKitCommunityCookie || proxyCommunityCookie;
      if (steamKitCommunityCookie) console.log('[Query] Using Steam community cookie from SteamKit session');
      else if (proxyCommunityCookie) console.log('[Query] Using Steam community cookie from WallHub proxy session');
      else console.warn('[Query] Steam community cookie unavailable; using anonymous community page request');
    };
    if (needsCommunityCookie && !useSteamKitUserFiles) {
      await prepareSteamCommunityCookie();
    }
    let result;
    try {
      try {
        result = await getWorkshopSearchService().search(payload.params || {}, {
          steamCommunityCookie,
          steamAccountKey: useSteamKitUserFiles ? `steamkit:${cachedSteamLoginUsername()}` : '',
          steamKitQueryAvailable,
          signal: controller ? controller.signal : undefined,
        });
      } catch (error) {
        if (!useSteamKitUserFiles || !error || error.code !== 'STEAMKIT_USER_FILES_UNAVAILABLE') throw error;
        console.warn(`[Query] SteamKit personal Workshop query failed; falling back to Steam Community: ${error.message}`);
        await prepareSteamCommunityCookie();
        result = await getWorkshopSearchService().search(payload.params || {}, {
          steamCommunityCookie,
          skipSteamKitUserFiles: true,
          steamKitQueryAvailable,
          signal: controller ? controller.signal : undefined,
        });
      }
    } catch (error) {
      const canRetryProxyCookie = error && error.code === 'STEAM_WEB_LOGIN_REQUIRED' &&
        steamKitCommunityCookie && proxyCommunityCookie && proxyCommunityCookie !== steamKitCommunityCookie;
      if (!canRetryProxyCookie) throw error;
      console.warn('[Query] SteamKit Web cookie was rejected; retrying once with WallHub proxy session cookie');
      result = await getWorkshopSearchService().search(payload.params || {}, {
        steamCommunityCookie: proxyCommunityCookie,
        steamKitQueryAvailable,
        signal: controller ? controller.signal : undefined,
      });
    }
    finished = true;
    jsonRes(res, 200, result);
  } catch (err) {
    if (err && err.code === 'ABORT_ERR') {
      finished = true;
      return jsonRes(res, 409, { error: 'Search aborted by settings change', aborted: true });
    }
    if (err && err.code === 'STEAM_WEB_LOGIN_REQUIRED') {
      finished = true;
      return jsonRes(res, 401, {
        error: err.message,
        code: err.code,
        requiresSteamLogin: true,
      });
    }
    console.error('[Query Error]', err.message);
    const cached = getWorkshopSearchService().cachedResultFor(payload.params || {});
    if (cached && cached.response && Array.isArray(cached.response.publishedfiledetails) && cached.response.publishedfiledetails.length) {
      console.warn('[Query] Returning stale cached result because live Steam query failed');
      jsonRes(res, 200, Object.assign({}, cached, {
        stale: true,
        warning: 'Steam connection is unstable; showing cached result',
      }));
      return;
    }
    finished = true;
    jsonRes(res, err.statusCode || 502, { error: err.message, code: err.code || '' });
  } finally {
    res.off('close', abortSearch);
  }
}

async function handleSteamAccessReady(req, res) {
  const result = await ensureSteamAccessGatewayReady('frontend', 15000);
  jsonRes(res, 200, {
    enabled: steamAccessGatewayEnabled(),
    ready: !steamAccessGatewayEnabled() || !!result.ready,
    ok: result.ok || 0,
    total: result.total || 0,
    timeout: !!result.timeout,
  });
}

let WORKSHOP_DETAIL_SERVICE = null;
function getWorkshopDetailService() {
  if (!WORKSHOP_DETAIL_SERVICE) {
    WORKSHOP_DETAIL_SERVICE = createWorkshopDetailService({
      get: GET,
      getFileDetails,
      fetchCommentsPage: fetchWorkshopCommentsPage,
      resolvePersonaName,
      isAndroidHostLikeEnv,
      logger: console,
    });
  }
  return WORKSHOP_DETAIL_SERVICE;
}

async function handleDetails(res, id) {
  // 后端自动处理请求合并（in-flight 合并）：
  // - 相同 id 如果正在抓取中，直接复用同一个 Promise（避免同一时刻重复抓）
  // - 不保留跨请求的成功结果缓存；每次需要详情都实时抓取（除非正好有正在进行的请求）
  // - 详情服务保留 clearInFlight 兼容接口，调用方需要时可清除当前 in-flight
  jsonRes(res, 200, await getWorkshopDetailService().fetchDetail(id));
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
      const detail = await getWorkshopDetailService().fetchDetail(publishedFileId);
      return jsonRes(res, 200, {
        filter,
        label: buildPersonalSourceLabel(filter, { author: detail && detail.author }),
        names: detail && detail.author ? [detail.author] : [],
      });
    }

    const proxyCommunityCookie = wallhubProxyUpstreamCookie(req.headers.cookie || '', 'steamcommunity.com');
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
    const payload = (await GET(actionUrl.toString(), {
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
    console.warn(`[PersonalSource] ${filter} ${publishedFileId} failed: ${error.message}`);
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
    .filter(Boolean)))
    .slice(0, 60);
  if (!ids.length) return jsonRes(res, 200, { items: [] });

  try {
    const details = await getFileDetailsSafe(ids);
    const detailMap = {};
    details.forEach(detail => {
      if (detail && String(detail.result || '') === '1' && detail.publishedfileid) detailMap[String(detail.publishedfileid)] = detail;
    });
    const items = ids
      .filter(id => detailMap[id])
      .map(id => mapWorkshopItem(id, detailMap[id], {}));
    jsonRes(res, 200, { items });
  } catch (err) {
    console.warn('[FileDetails Batch API]', err.message);
    jsonRes(res, 200, { items: [] });
  }
}

function fmtBytes(b) {
  return workshopText.fmtBytes(b);
}
function cleanText(v) {
  return workshopText.cleanText(v);
}
async function resolvePersonaName(steamId) {
  return STEAM_PERSONA_SERVICE.resolveName(steamId);
}
async function fetchWorkshopCommentsPage(id, start, count, ownerId) {
  return WORKSHOP_COMMENTS_SERVICE.fetchPage(id, start, count, ownerId);
}
async function handleCommentsPage(res, id, start, count, ownerId) {
  const page = await fetchWorkshopCommentsPage(id, start, count, ownerId);
  jsonRes(res, 200, page);
}

function safeName(s) {
  return fileTools.safeName(s);
}
function extFromUrl(u, fallback) {
  return fileTools.extFromUrl(u, fallback);
}
function extFromPath(p, fallback) {
  return fileTools.extFromPath(p, fallback);
}
function mimeFromExt(ext) {
  return sharedMimeFromExt(ext);
}
function getVideoMime(filePath) {
  return sharedGetVideoMime(filePath);
}
function isVideoExt(ext) {
  return sharedIsVideoExt(ext);
}
function getWorkshopContentDir(appId) {
  return DOWNLOADS_DIR;
}
function findFirstVideoInDir(dir) {
  return fileTools.findFirstVideoInDir(dir, isVideoExt);
}
function ensureDir(p) {
  return fileTools.ensureDir(p);
}
function runProcess(bin, args, timeoutMs, options = {}) {
  const preparedOptions = Object.assign({
    timeoutMessage: `进程超时: ${bin}`,
    cancelMessage: '进程已取消',
  }, options || {});
  return processTools.runProcess(bin, args, timeoutMs, preparedOptions, (baseEnv, runOptions) => {
    if (runOptions.preparedEnv === true) return baseEnv;
    if (runOptions.steamAuth === true) return applySteamHttpProxyEnv(baseEnv);
    if (runOptions.steamContentDirect === true || baseEnv.WALLHUB_STEAM_CONTENT_DIRECT === '1') {
      return buildSteamContentDirectEnv(baseEnv, getSteamCdnRouteStrategy());
    }
    return runOptions.applyDownloadProxy === true ? applySteamHttpProxyEnv(baseEnv) : baseEnv;
  });
}

function downloadWithProgress(urlStr, dest, task) {
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.get(urlStr, { headers: { 'User-Agent': UA } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return downloadWithProgress(res.headers.location, dest, task).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) return reject(new Error(`HTTP ${res.statusCode}`));

      const total = parseInt(res.headers['content-length'] || '0');
      task.total = total;
      let downloaded = 0; let lastTime = Date.now(); let lastBytes = 0;

      const file = fs.createWriteStream(dest);
      res.on('data', chunk => {
        downloaded += chunk.length;
        task.downloaded = downloaded;
        if (total) task.progress = (downloaded / total) * 100;
        const now = Date.now();
        if (now - lastTime > 1000) {
          task.speed = (downloaded - lastBytes) / ((now - lastTime) / 1000);
          lastBytes = downloaded; lastTime = now;
        }
      });
      res.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error', err => { fs.unlink(dest, ()=>{}); reject(err); });

      task.cancelFn = () => {
        req.destroy(); file.close(); fs.unlink(dest, ()=>{});
        reject(new Error('任务已被取消或暂停'));
      };
    });
    req.on('error', reject);
  });
}

function getDownloaderMode() {
  return getStaticDownloaderMode();
}

function startupDownloaderMode() {
  return getStaticDownloaderMode();
}

function effectiveDownloaderMode() {
  return getStaticDownloaderMode();
}

function updateRuntimeSetup(patch) {
  return RUNTIME_SETUP_STORE.update(patch);
}

function runtimeSetupSnapshot() {
  return RUNTIME_SETUP_STORE.snapshot({
    runnerDir: STEAMKIT_ROOT,
    accountDir: STEAMKIT_CONFIG_DIR,
    downloadsDir: DOWNLOADS_DIR,
    executablePath: resolveDepotDownloaderPath() || RUNTIME_SETUP.executablePath || ''
  });
}

function clearCachedSteamLogin(reason) {
  const hadUser = !!(VIDEO_CACHE_SETTINGS.steamUsername || STEAM_CREDENTIALS.username || STEAM_CREDENTIALS.pendingPersistentUsername);
  STEAM_CREDENTIALS.username = '';
  STEAM_CREDENTIALS.password = '';
  STEAM_CREDENTIALS.steamGuardCode = '';
  STEAM_CREDENTIALS.isPersistent = false;
  STEAM_CREDENTIALS.pendingPersistentUsername = '';
  if (VIDEO_CACHE_SETTINGS.steamUsername || VIDEO_CACHE_SETTINGS.steamIsPersistent || VIDEO_CACHE_SETTINGS.authBackend) {
    VIDEO_CACHE_SETTINGS.steamUsername = '';
    VIDEO_CACHE_SETTINGS.steamIsPersistent = false;
    VIDEO_CACHE_SETTINGS.authBackend = '';
    saveCacheSettings();
  }
  if (hadUser) console.log(`[Steam Init] Cleared cached login${reason ? `: ${reason}` : ''}`);
}

function setValidatedPersistentLogin(username, backend) {
  const user = String(username || '').trim();
  if (!user) return;
  STEAM_CREDENTIALS.username = user;
  STEAM_CREDENTIALS.password = '';
  STEAM_CREDENTIALS.steamGuardCode = '';
  STEAM_CREDENTIALS.isPersistent = true;
  STEAM_CREDENTIALS.pendingPersistentUsername = '';
  VIDEO_CACHE_SETTINGS.steamUsername = user;
  VIDEO_CACHE_SETTINGS.steamIsPersistent = true;
  VIDEO_CACHE_SETTINGS.authBackend = backend || startupDownloaderMode();
  saveCacheSettings();
}

function makeDepotLoginId(seed) {
  return depotTools.makeDepotLoginId(seed);
}

function steamKitPersistentLoginIsUsable() {
  return !!(cachedSteamLoginUsername() &&
    (STEAM_CREDENTIALS.isPersistent ||
      STEAM_CREDENTIALS.pendingPersistentUsername ||
      VIDEO_CACHE_SETTINGS.steamIsPersistent));
}

function cachedSteamLoginUsername() {
  return String(STEAM_CREDENTIALS.username || STEAM_CREDENTIALS.pendingPersistentUsername || VIDEO_CACHE_SETTINGS.steamUsername || '').trim();
}

function shouldRetrySteamLoginRequiredError(err) {
  if (!err || !err.requiresSteamLogin || err.requiresSteamGuard) return false;
  if (err.code !== 'STEAM_LOGIN_REQUIRED') return false;
  return !!cachedSteamLoginUsername();
}

let STEAMKIT_LOGIN_REVALIDATION_PROMISE = null;

async function refreshPersistentSteamLoginForRetry(reason) {
  const username = cachedSteamLoginUsername();
  if (!username) return false;
  if (STEAMKIT_LOGIN_REVALIDATION_PROMISE) return STEAMKIT_LOGIN_REVALIDATION_PROMISE;
  console.log(`[SteamKit Login] Revalidating cached Steam session for retry (${reason || 'download'}): ${username}`);
  STEAMKIT_LOGIN_REVALIDATION_PROMISE = (async () => {
    try {
      await verifySteamKitRememberedSession(username);
      setValidatedPersistentLogin(username, 'steamkit');
      return true;
    } catch (e) {
      const err = normalizeDepotError(e);
      console.warn(`[SteamKit Login] Cached session retry validation failed: ${err.message || e.message}`);
      return false;
    } finally {
      STEAMKIT_LOGIN_REVALIDATION_PROMISE = null;
    }
  })();
  return STEAMKIT_LOGIN_REVALIDATION_PROMISE;
}

async function reconcileCachedSteamLogin(mode) {
  const cachedUser = String(VIDEO_CACHE_SETTINGS.steamUsername || STEAM_CREDENTIALS.pendingPersistentUsername || '').trim();
  if (!cachedUser || !VIDEO_CACHE_SETTINGS.steamIsPersistent) return;
  updateRuntimeSetup({
    mode,
    status: 'validating-login',
    progress: 90,
    message: `正在验证本地 Steam 登录会话: ${cachedUser}`
  });
  try {
    await verifySteamKitRememberedSession(cachedUser);
    setValidatedPersistentLogin(cachedUser, 'steamkit');
    updateRuntimeSetup({ mode, status: 'ready', progress: 100, message: `SteamKit 运行文件已就绪，已恢复登录: ${cachedUser}` });
    console.log(`[Steam Init] Validated SteamKit remembered session: ${cachedUser}`);
  } catch (e) {
    STEAM_CREDENTIALS.username = cachedUser;
    STEAM_CREDENTIALS.password = '';
    STEAM_CREDENTIALS.steamGuardCode = '';
    STEAM_CREDENTIALS.isPersistent = false;
    STEAM_CREDENTIALS.pendingPersistentUsername = cachedUser;
    updateRuntimeSetup({
      mode,
      status: 'ready',
      progress: 100,
      message: `SteamKit 运行文件已就绪，本地登录会话未验证，请重新登录: ${cachedUser}`
    });
    console.warn(`[Steam Init] SteamKit cached login is not usable until re-login: ${e.message}`);
  }
}

let STEAMKIT_RUNTIME_BUILD_SERVICE = null;

function getSteamKitRuntimeBuildService() {
  if (!STEAMKIT_RUNTIME_BUILD_SERVICE) {
    STEAMKIT_RUNTIME_BUILD_SERVICE = createSteamKitRuntimeBuildService({
      env: process.env,
      logger: console,
      STEAMKIT_ROOT,
      STEAMKIT_CONFIG_DIR,
      DOWNLOADS_DIR,
      DEPOT_DOWNLOADER_DIR,
      DEPOT_STREAM_DOWNLOADER_DIR,
      DEPOT_JSON_PROGRESS_DIR,
      DEPOT_JSON_PROGRESS_SOURCE_ZIP,
      DEPOT_JSON_PROGRESS_PATCH_VERSION,
      DEPOT_STREAM_PATCH_VERSION,
      DEPOT_CONFIG_DIR,
      DEPOT_HOME_DIR,
      DEPOT_DOTNET_CLI_HOME_DIR,
      DEPOT_XDG_DATA_HOME_DIR,
      DEPOT_XDG_CONFIG_HOME_DIR,
      DEPOT_LOCALAPPDATA_DIR,
      DEPOT_APPDATA_DIR,
      GITHUB_ACCELERATOR_MODE,
      UA,
      GET,
      ensureDir,
      runProcess,
      psQuote,
      updateRuntimeSetup,
      runtimeSetupSnapshot,
      effectiveDownloaderMode,
      startupDownloaderMode,
      ensureSteamConfigDir,
      reconcileCachedSteamLogin,
      VIDEO_CACHE_SETTINGS,
      getVideoCacheSettings: () => VIDEO_CACHE_SETTINGS,
      makeSteamKitJsonProgressRequiredError,
      isTermuxLikeEnv,
      isAndroidHostLikeEnv,
      shouldRejectDepotAppHostForAndroid,
    });
  }
  return STEAMKIT_RUNTIME_BUILD_SERVICE;
}

function prepareRuntimeOnStartup() {
  return getSteamKitRuntimeBuildService().prepareRuntimeOnStartup();
}

async function waitForStartupPreparationForDownload(task) {
  return getSteamKitRuntimeBuildService().waitForStartupPreparationForDownload(task);
}

function commandExists(command) {
  return getSteamKitRuntimeBuildService().commandExists(command);
}

function resolveDepotDownloaderPath() {
  return getSteamKitRuntimeBuildService().resolveDepotDownloaderPath();
}

function depotDotnetMissingMessage(requiredVersion, installedVersions) {
  return getSteamKitRuntimeBuildService().depotDotnetMissingMessage(requiredVersion, installedVersions);
}

async function ensureDepotStreamDownloaderReady() {
  return getSteamKitRuntimeBuildService().ensureDepotStreamDownloaderReady();
}

function warmupDepotStreamDownloader(reason = '') {
  return getSteamKitRuntimeBuildService().warmupDepotStreamDownloader(reason);
}

async function ensureDepotDownloaderReady() {
  return getSteamKitRuntimeBuildService().ensureDepotDownloaderReady();
}

async function ensureJsonProgressDepotDownloaderReady() {
  return getSteamKitRuntimeBuildService().ensureJsonProgressDepotDownloaderReady();
}

async function buildDepotStreamDownloader() {
  return getSteamKitRuntimeBuildService().buildDepotStreamDownloader();
}

function depotCommandFor(executable) {
  return getSteamKitRuntimeBuildService().depotCommandFor(executable);
}

function buildDepotDotnetEnv() {
  return getSteamKitRuntimeBuildService().buildDepotDotnetEnv();
}

function dirSizeRecursive(root) {
  if (!root || !fs.existsSync(root)) return 0;
  let total = 0;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of ents) {
      const fp = path.join(dir, ent.name);
      try {
        if (ent.isDirectory()) stack.push(fp);
        else if (ent.isFile()) total += fs.statSync(fp).size;
      } catch {}
    }
  }
  return total;
}

function parseWallhubDepotProgress(text) {
  return depotTools.parseWallhubDepotProgress(text);
}

function parseWallhubDepotProgressJson(json) {
  return depotTools.parseWallhubDepotProgressJson(json);
}

function createWallhubDepotProgressReader() {
  return depotTools.createWallhubDepotProgressReader();
}

function createWallhubDepotCdnLogReader(prefix = '[SteamKit CDN]', meta = {}) {
  let pending = '';
  const seen = new Set();
  return (chunk) => {
    pending = `${pending}${String(chunk || '')}`;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    for (const line of lines) {
      const m = line.match(/WALLHUB_DEPOT_CDN_HOST:(\{.+\})/);
      if (!m) continue;
      try {
        const data = JSON.parse(m[1]);
        const host = String(data.host || data.vhost || '').trim();
        if (!host) continue;
        const vhost = String(data.vhost || '').trim();
        const port = Number(data.port || 0);
        const entry = updateSteamCdnStatus(Object.assign({}, meta, { host, vhost, port }));
        const key = entry ? `${entry.host}:${entry.port || 0}` : `${host}:${port || 0}`;
        if (seen.has(key)) continue;
        seen.add(key);
        console.log(`${prefix} host=${host}${vhost && vhost !== host ? ` vhost=${vhost}` : ''}${port ? ` port=${port}` : ''}`);
      } catch {}
    }
    if (pending.length > 16000) pending = pending.slice(-4000);
  };
}

function getMaxDisplayedSpeedBytes() {
  return RUNTIME_TUNING.PROXY.maxDisplaySpeedBytes;
}

function applyTaskByteProgress(task, downloaded, total, options = {}) {
  if (!task) return;
  const currentBytes = Math.max(0, Math.floor(Number(downloaded || 0)));
  const totalBytes = Math.max(0, Math.floor(Number(total || task.total || task.size || 0)));
  const hasExplicitSpeedBytes = Object.prototype.hasOwnProperty.call(options, 'speedBytes');
  const currentSpeedBytes = hasExplicitSpeedBytes
    ? Math.max(0, Math.floor(Number(options.speedBytes || 0)))
    : currentBytes;
  const now = Date.now();
  const outputSpeed = Number(options.speed || 0);
  const lastBytes = Number(task._stdoutProgressLastBytes || 0);
  const lastSpeedBytes = Number(task._speedProgressLastBytes || 0);
  const speedDisabled = options.speedBytes === null || options.speedBytes === undefined && hasExplicitSpeedBytes;
  if (currentBytes < lastBytes || currentSpeedBytes < lastSpeedBytes) {
    task._speedSamples = [];
    task._stdoutProgressLastAt = 0;
    task._stdoutProgressLastBytes = 0;
    task._speedProgressLastBytes = 0;
    task._smoothedSpeed = 0;
    task.speed = 0;
  }
  if (speedDisabled) {
    task.speed = 0;
  } else if (outputSpeed > 0) {
    const maxReasonableSpeed = Math.min(
      getMaxDisplayedSpeedBytes(),
      totalBytes > 0 ? Math.max(64 * 1024 * 1024, totalBytes * 0.5) : 512 * 1024 * 1024
    );
    const boundedSpeed = Math.min(outputSpeed, maxReasonableSpeed);
    const previous = Number(task._smoothedSpeed || 0);
    task._smoothedSpeed = previous > 0 ? previous * 0.75 + boundedSpeed * 0.25 : boundedSpeed;
    task.speed = task._smoothedSpeed;
  } else if (currentSpeedBytes >= lastSpeedBytes) {
    const samples = Array.isArray(task._speedSamples) ? task._speedSamples : [];
    const latest = samples.length ? samples[samples.length - 1] : null;
    if (!latest || now - latest.at >= 900 || currentBytes >= totalBytes) {
      samples.push({ at: now, bytes: currentSpeedBytes });
      const cutoff = now - 8000;
      while (samples.length > 2 && samples[0].at < cutoff) samples.shift();
      task._speedSamples = samples.slice(-12);
      const first = task._speedSamples[0];
      const last = task._speedSamples[task._speedSamples.length - 1];
      if (first && last && last.at > first.at && last.bytes >= first.bytes) {
        const windowSpeed = (last.bytes - first.bytes) / ((last.at - first.at) / 1000);
        const boundedWindowSpeed = Math.min(windowSpeed, getMaxDisplayedSpeedBytes());
        task._smoothedSpeed = boundedWindowSpeed;
        task.speed = Math.max(0, boundedWindowSpeed);
      }
    }
  }
  task._stdoutProgressLastAt = now;
  task._stdoutProgressLastBytes = currentBytes;
  task._speedProgressLastBytes = currentSpeedBytes;
  task.downloaded = currentBytes;
  if (totalBytes > 0) {
    task.total = totalBytes;
    const cap = options.allowComplete ? 100 : 99.8;
    task.progress = Math.min(cap, Math.max(0, (currentBytes / totalBytes) * 100));
    task.progressIndeterminate = false;
  }
  if (options.stage) task.progressStage = options.stage;
  if (options.stageMode || options.stage) {
    task.progressStageMode = String(options.stageMode || 'progress');
  }
}

function cleanProcessLineForStage(text) {
  return depotTools.cleanProcessLineForStage(text);
}

function appendTaskProcessOutput(task, chunk) {
  if (!task) return;
  const text = String(chunk || '');
  task._processOutput = `${task._processOutput || ''}${text}`.slice(-3000);
  const line = cleanProcessLineForStage(text);
  if (line && task.progressIndeterminate) {
    task.progressStage = line.length > 120 ? `${line.slice(0, 117)}...` : line;
  }
}

function hasFilesRecursive(root) {
  if (!root || !fs.existsSync(root)) return false;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let ents = [];
    try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
    for (const ent of ents) {
      const fp = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(fp);
      else if (ent.isFile()) return true;
    }
  }
  return false;
}

function copyDirContents(src, dest) {
  ensureDir(dest);
  const ents = fs.readdirSync(src, { withFileTypes: true });
  for (const ent of ents) {
    const from = path.join(src, ent.name);
    const to = path.join(dest, ent.name);
    if (ent.isDirectory()) {
      copyDirContents(from, to);
    } else if (ent.isFile()) {
      ensureDir(path.dirname(to));
      fs.copyFileSync(from, to);
    }
  }
}

function getDownloadItemDir(publishedFileId) {
  const sid = String(publishedFileId || '').replace(/[^\d]/g, '');
  if (!sid) throw new Error('Invalid workshop id');
  return path.join(DOWNLOADS_DIR, sid);
}

function finalizeWorkshopItem(sourceDir, publishedFileId) {
  if (!sourceDir || !fs.existsSync(sourceDir)) {
    throw new Error('Downloaded workshop directory not found');
  }
  const destDir = getDownloadItemDir(publishedFileId);
  ensureDir(DOWNLOADS_DIR);
  const sourceResolved = path.resolve(sourceDir);
  const destResolved = path.resolve(destDir);
  if (sourceResolved !== destResolved) {
    if (fs.existsSync(destDir)) removePathWithRetry(destDir);
    copyDirContents(sourceDir, destDir);
    try {
      if (!sourceResolved.startsWith(path.resolve(DOWNLOADS_DIR) + path.sep)) {
        removePathWithRetry(sourceDir);
      }
    } catch {}
  }
  return destDir;
}

function normalizeDepotOutput(rawRoot, tempRoot, appId, publishedFileId) {
  return getSteamKitDownloadService().normalizeOutput(rawRoot, tempRoot, appId, publishedFileId);
}

function codedError(message, code, statusCode) {
  return getSteamKitDownloadService().codedError(message, code, statusCode);
}

function steamKitNeedsOwnedAccount(appId) {
  return getSteamKitDownloadService().steamKitNeedsOwnedAccount(appId);
}

function makeSteamKitLoginRequiredError() {
  return getSteamKitDownloadService().makeLoginRequiredError();
}

function makeSteamGuardRequiredError() {
  return getSteamKitDownloadService().makeGuardRequiredError();
}

function makeSteamLoginFailedError(message) {
  return getSteamKitDownloadService().makeLoginFailedError(message);
}

function makeSteamNetworkError(message) {
  return getSteamKitDownloadService().makeNetworkError(message);
}

function resolveDepotLogin(appId) {
  return getSteamKitDownloadService().resolveLogin(appId);
}

function canUseDepotLogin(login) {
  return getSteamKitDownloadService().canUseLogin(login);
}

function makeSteamKitJsonProgressRequiredError() {
  return getSteamKitDownloadService().makeJsonProgressRequiredError();
}

function isDepotAuthFailureMessage(msg) {
  return depotTools.isDepotAuthFailureMessage(msg);
}

function isDepotNetworkFailureMessage(msg) {
  return depotTools.isDepotNetworkFailureMessage(msg);
}

function isDepotLoginVerifiedDespiteCanceled(msg) {
  return depotTools.isDepotLoginVerifiedDespiteCanceled(msg);
}

function markSteamAccessControlPlaneFailure(host, ip, error, meta = {}) {
  const hostname = String(host || '').trim().toLowerCase();
  const address = String(ip || '').trim();
  if (!hostname || !address) return;
  const reason = String(error && error.message || error || 'depotdownloader-webapi-failed');
  STEAM_ACCESS_GATEWAY.routeStore.cooldown(hostname, address, reason, 10 * 60 * 1000, Object.assign({
    source: 'depotdownloader',
    stage: 'steamkit-webapi',
  }, meta || {}));
  STEAM_ACCESS_GATEWAY.removeCachedIp(hostname, Number(meta && meta.port) || 443, address);
  if (STEAM_ACCESS_GATEWAY.logger && STEAM_ACCESS_GATEWAY.logger.warn) {
    STEAM_ACCESS_GATEWAY.logger.warn(`[SteamAccess] cooled SteamKit WebAPI route ${hostname} ${address}: ${reason}`);
  }
}

let STEAMKIT_DOWNLOAD_SERVICE = null;

function getSteamKitDownloadService() {
  if (!STEAMKIT_DOWNLOAD_SERVICE) {
    STEAMKIT_DOWNLOAD_SERVICE = createSteamKitDownloadService({
      STEAM_CREDENTIALS,
      DEPOT_CONFIG_DIR,
      STEAMKIT_CONFIG_DIR,
      ensureDir,
      hasFilesRecursive,
      copyDirContents,
      removePathWithRetry,
      getDownloadItemDir,
      finalizeWorkshopItem,
      deletePathIfInside,
      cleanupRuntimeDownloadResidues,
      runtimeResidueKeepIds,
      pickVideoFile,
      extFromPath,
      safeName,
      waitForStartupPreparationForDownload,
      warmupSteamAccessControlPlane: warmupSteamAccessGatewayControlPlane,
      markSteamAccessControlPlaneFailure,
      shouldRetrySteamLoginRequiredError,
      refreshPersistentSteamLoginForRetry,
      setValidatedPersistentLogin,
      depotDotnetMissingMessage,
      isDepotNetworkFailureMessage,
      isDepotAuthFailureMessage,
      isDepotLoginVerifiedDespiteCanceled,
      depotCommandFor,
      getSteamKitMaxDownloads,
      makeDepotLoginId,
      getSteamContentCellId,
      ensureDepotDownloaderReady,
      createWallhubDepotProgressReader,
      createWallhubDepotCdnLogReader,
      appendTaskProcessOutput,
      applyTaskByteProgress,
      runProcess,
      buildSteamContentEnv,
      buildDepotDotnetEnv,
      describeSteamCdnRouteStrategy,
      logger: console,
    });
  }
  return STEAMKIT_DOWNLOAD_SERVICE;
}

let STEAMKIT_LOGIN_SERVICE = null;

function getSteamKitLoginService() {
  if (!STEAMKIT_LOGIN_SERVICE) {
    STEAMKIT_LOGIN_SERVICE = createSteamKitLoginService({
      ensureDepotDownloaderReady,
      ensureDir,
      depotCommandFor,
      runProcess,
      buildDepotDotnetEnv,
      makeDepotLoginId,
      normalizeDepotError,
      isDepotLoginVerifiedDespiteCanceled,
      setValidatedPersistentLogin,
      getQrCodeModule,
      getJsQrModule,
      effectiveDownloaderMode,
      configDir: DEPOT_CONFIG_DIR,
      logger: console,
    });
  }
  return STEAMKIT_LOGIN_SERVICE;
}

async function verifySteamKitLogin(username, password, steamGuardCode) {
  return getSteamKitLoginService().verifyLogin(username, password, steamGuardCode);
}

let STEAMKIT_QUERY_BRIDGE = null;
let STEAMKIT_PERSONAL_WORKSHOP_SERVICE = null;

function getSteamKitQueryBridge() {
  if (!STEAMKIT_QUERY_BRIDGE) {
    STEAMKIT_QUERY_BRIDGE = createSteamKitQueryBridge({
      ensureDepotDownloaderReady,
      depotCommandFor,
      buildDepotDotnetEnv,
      buildSteamAuthEnv: applySteamHttpProxyEnv,
      makeDepotLoginId,
      ensureDir,
      configDir: DEPOT_CONFIG_DIR,
      logger: console,
    });
  }
  return STEAMKIT_QUERY_BRIDGE;
}

function stopSteamKitQueryBridge(reason) {
  if (STEAMKIT_QUERY_BRIDGE) STEAMKIT_QUERY_BRIDGE.shutdown(reason);
}

function getSteamKitPersonalWorkshopService() {
  if (!STEAMKIT_PERSONAL_WORKSHOP_SERVICE) {
    STEAMKIT_PERSONAL_WORKSHOP_SERVICE = createSteamKitPersonalWorkshopService({
      ensureDepotDownloaderReady,
      depotCommandFor,
      runProcess,
      buildDepotDotnetEnv,
      makeDepotLoginId,
      ensureDir,
      configDir: DEPOT_CONFIG_DIR,
      queryBridge: getSteamKitQueryBridge(),
      logger: console,
    });
  }
  return STEAMKIT_PERSONAL_WORKSHOP_SERVICE;
}

async function querySteamKitUserFiles(listType, options = {}) {
  if (effectiveDownloaderMode() !== 'steamkit') {
    const error = new Error('SteamKit is not the active downloader mode');
    error.code = 'STEAMKIT_USER_FILES_UNAVAILABLE';
    error.requiresSteamLogin = true;
    throw error;
  }
  const username = cachedSteamLoginUsername();
  if (!username || !steamKitPersistentLoginIsUsable()) {
    const error = new Error('SteamKit remembered account is unavailable');
    error.code = 'STEAMKIT_USER_FILES_UNAVAILABLE';
    error.requiresSteamLogin = true;
    throw error;
  }
  return getSteamKitPersonalWorkshopService().getUserFiles(listType, Object.assign({}, options, { username }));
}

let WORKSHOP_SUBSCRIPTION_SERVICE = null;
function getWorkshopSubscriptionService() {
  if (!WORKSHOP_SUBSCRIPTION_SERVICE) {
    WORKSHOP_SUBSCRIPTION_SERVICE = createWorkshopSubscriptionService({
      get: GET,
      post: POST,
      getCommunityCookie: resolveSteamKitCommunityCookie,
    });
  }
  return WORKSHOP_SUBSCRIPTION_SERVICE;
}

async function handleSteamSubscription(req, res, action) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch { return jsonRes(res, 400, { error: 'Bad JSON' }); }

  const operation = ['subscribe', 'unsubscribe', 'favorite', 'unfavorite'].includes(action) ? action : 'subscribe';
  try {
    const proxyCommunityCookie = wallhubProxyUpstreamCookie(req.headers.cookie || '', 'steamcommunity.com');
    const result = await getWorkshopSubscriptionService()[operation](payload.id, {
      steamCommunityCookie: proxyCommunityCookie,
    });
    jsonRes(res, 200, result);
  } catch (error) {
    const fallbackErrors = {
      subscribe: ['Steam 订阅请求失败', 'STEAM_SUBSCRIBE_FAILED'],
      unsubscribe: ['Steam 取消订阅请求失败', 'STEAM_UNSUBSCRIBE_FAILED'],
      favorite: ['Steam 收藏请求失败', 'STEAM_FAVORITE_FAILED'],
      unfavorite: ['Steam 取消收藏请求失败', 'STEAM_UNFAVORITE_FAILED'],
    };
    const fallback = fallbackErrors[operation];
    const statusCode = Number(error && error.statusCode) || 502;
    jsonRes(res, statusCode, {
      error: error && error.message ? error.message : fallback[0],
      code: error && error.code ? error.code : fallback[1],
      requiresSteamLogin: !!(error && error.requiresSteamLogin),
    });
  }
}

async function handleSteamSubscribe(req, res) {
  return handleSteamSubscription(req, res, 'subscribe');
}

async function handleSteamUnsubscribe(req, res) {
  return handleSteamSubscription(req, res, 'unsubscribe');
}

async function handleSteamFavorite(req, res) {
  return handleSteamSubscription(req, res, 'favorite');
}

async function handleSteamUnfavorite(req, res) {
  return handleSteamSubscription(req, res, 'unfavorite');
}

async function handleSteamSubscriptionStatus(req, res, id) {
  try {
    const proxyCommunityCookie = wallhubProxyUpstreamCookie(req.headers.cookie || '', 'steamcommunity.com');
    const result = await getWorkshopSubscriptionService().status(id, {
      steamCommunityCookie: proxyCommunityCookie,
    });
    jsonRes(res, 200, result);
  } catch (error) {
    const statusCode = Number(error && error.statusCode) || 502;
    jsonRes(res, statusCode, {
      error: error && error.message ? error.message : 'Steam 订阅状态查询失败',
      code: error && error.code ? error.code : 'STEAM_SUBSCRIPTION_STATUS_FAILED',
      requiresSteamLogin: !!(error && error.requiresSteamLogin),
    });
  }
}

function startSteamKitPasswordLoginSession(payload) {
  return getSteamKitLoginService().startPasswordSession(
    String(payload && payload.username || '').trim(),
    String(payload && payload.password || '').trim(),
    String(payload && payload.steamGuardCode || '').trim(),
  );
}

function getSteamKitPasswordLoginSession(id) {
  return getSteamKitLoginService().getPasswordSession(id);
}

async function verifySteamKitRememberedSession(username) {
  return getSteamKitLoginService().verifyRememberedSession(username);
}

async function getSteamKitWebSessionCookie(username) {
  return getSteamKitLoginService().getWebSessionCookie(username);
}

async function resolveSteamKitCommunityCookie() {
  if (effectiveDownloaderMode() !== 'steamkit') {
    console.warn('[SteamKit Web] SteamKit is not the active downloader mode; cannot derive Steam community cookie');
    return '';
  }
  const username = cachedSteamLoginUsername();
  const canUsePersistentLogin = !!username && (
    STEAM_CREDENTIALS.isPersistent ||
    !!STEAM_CREDENTIALS.pendingPersistentUsername ||
    !!VIDEO_CACHE_SETTINGS.steamIsPersistent
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
    console.log(`[SteamKit Web] Preparing Steam community cookie from cached login: ${username}`);
    return await getSteamKitWebSessionCookie(username);
  } catch (error) {
    const err = normalizeDepotError(error);
    console.warn(`[SteamKit Web] Failed to generate Steam community web session: ${err.message}`);
    return '';
  }
}

async function startSteamKitQrLoginSession() {
  return getSteamKitLoginService().startQrSession();
}

function getSteamKitQrLoginSession(id) {
  return getSteamKitLoginService().getQrSession(id);
}

function cancelSteamKitQrLoginSession(id) {
  return getSteamKitLoginService().cancelQrSession(id);
}

function buildDepotDownloaderArgs(executable, publishedFileId, appId, tempRoot, rawRoot, options) {
  return getSteamKitDownloadService().buildArgs(executable, publishedFileId, appId, tempRoot, rawRoot, options);
}

function normalizeDepotError(e) {
  return getSteamKitDownloadService().normalizeError(e);
}

async function downloadViaSteamKit(publishedFileId, appId, title, options = {}) {
  return getSteamKitDownloadService().downloadViaSteamKit(publishedFileId, appId, title, options);
}

async function downloadWorkshopItem(publishedFileId, appId, title, options = {}) {
  return getSteamKitDownloadService().downloadWorkshopItem(publishedFileId, appId, title, options);
}

function psQuote(v) {
  return zipTools.psQuote(v);
}
function listFilesRecursive(root) {
  return fileTools.listFilesRecursive(root);
}
function workshopTypeFromDetails(details) {
  const tags = Array.isArray(details && details.tags) ? details.tags : [];
  const values = tags.map(t => String((t && t.tag) || t || '').trim().toLowerCase());
  if (values.includes('video')) return 'Video';
  if (values.includes('web')) return 'Web';
  if (values.includes('application')) return 'Application';
  return 'Scene';
}
function detectVideoTag(details) {
  return workshopTypeFromDetails(details) === 'Video';
}
function isSceneWorkshop(details) {
  return workshopTypeFromDetails(details) === 'Scene';
}
function pickVideoFile(itemDir) {
  if (!fs.existsSync(itemDir)) return null;
  const exts = ['.mp4', '.webm', '.avi', '.wmv', '.mkv', '.mov', '.m4v'];
  const rank = new Map(exts.map((e, i) => [e, i]));
  const files = listFilesRecursive(itemDir)
    .map(fp => ({ fp, ext: path.extname(fp).toLowerCase(), size: fs.statSync(fp).size }))
    .filter(x => rank.has(x.ext));
  if (!files.length) return null;
  files.sort((a, b) => (rank.get(a.ext) - rank.get(b.ext)) || (b.size - a.size));
  return files[0].fp;
}

async function zipDir(dirPath, zipPath) {
  return zipTools.zipDir(dirPath, zipPath, {
    ensureDir,
    commandExists,
    runProcess,
    listFilesRecursive,
    logger: console
  });
}

let CACHE_ITEMS_SERVICE = null;

function getCacheItemsService() {
  if (!CACHE_ITEMS_SERVICE) {
    CACHE_ITEMS_SERVICE = createCacheItemsService({
      getDownloadsDir: () => DOWNLOADS_DIR,
      getWorkshopCacheDir: () => WORKSHOP_CACHE_DIR,
      getSteamKitConfigDir: () => STEAMKIT_CONFIG_DIR,
      getTaskQueue: () => TASK_QUEUE,
      getMpkgBuildPromises: () => MPKG_BUILD_PROMISES,
      getMpkgService,
      getFileDetails,
      getWorkshopContentDir,
      findFirstVideoInDir,
      isSceneWorkshopDir,
      cleanText,
      detectVideoTag,
      workshopTypeFromDetails,
      streamFileWithRange,
      hasFilesRecursive,
      ensureDir,
      jsonRes,
      logger: console,
    });
  }
  return CACHE_ITEMS_SERVICE;
}

function findCachedItemDir(id) {
  return getCacheItemsService().findCachedItemDir(id);
}

function markCacheItemDeleted(id, ttlMs) {
  return getCacheItemsService().markCacheItemDeleted(id, ttlMs);
}

function isCacheItemTombstoned(id) {
  return getCacheItemsService().isCacheItemTombstoned(id);
}

function getDownloadQueueService() {
  if (!DOWNLOAD_QUEUE_SERVICE) {
    DOWNLOAD_QUEUE_SERVICE = createDownloadQueueService({
      getMaxConcurrentDownloads,
      getFileDetails,
      safeName,
      detectVideoTag,
      workshopTypeFromDetails,
      downloadWorkshopItem,
      dirSizeRecursive,
      findCachedItemDir,
      isVideoExt,
      findFirstVideoInDir,
      onTaskCompleted: () => getCacheItemsService().invalidateCacheSnapshot(),
      logger: console,
    });
    TASK_QUEUE = DOWNLOAD_QUEUE_SERVICE.tasks;
  }
  return DOWNLOAD_QUEUE_SERVICE;
}


function findQueueItemById(id) {
  return getDownloadQueueService().findById(id);
}

async function createWorkshopQueueTask(id, title, options = {}) {
  return getDownloadQueueService().createTask(id, title, options);
}

function enforceTopOnlyQueueRunner() {
  return getDownloadQueueService().enforceTopOnlyRunner();
}

function findDownloadedItemPath(id) {
  return getDownloadQueueService().findDownloadedPath(id);
}

const DOWNLOAD_FILE_SENDER = createDownloadFileSender({ fs });

function sendDownloadFile(req, res, filePath, fileName, options = {}) {
  return DOWNLOAD_FILE_SENDER(req, res, filePath, fileName, options);
}

function cleanupPreparedDownloads() {
  return PREPARED_DOWNLOAD_STORE.cleanup();
}

function createPreparedDownload(filePath, fileName, options = {}) {
  return PREPARED_DOWNLOAD_STORE.create(filePath, fileName, options);
}

function sendPreparedDownload(req, res, token, options = {}) {
  const entry = PREPARED_DOWNLOAD_STORE.consume(token);
  if (!entry) {
    return jsonRes(res, 404, { error: 'Prepared download expired', code: 'DOWNLOAD_EXPIRED' });
  }
  return sendDownloadFile(req, res, entry.filePath, entry.fileName, Object.assign({}, options, { deleteAfterSend: false }));
}

async function preparePathAsClientDownload(sourcePath, title, id) {
  return getClientDownloadService().preparePathAsDownload(sourcePath, title, id);
}

async function sendPathAsClientDownload(req, res, sourcePath, title, id) {
  const prepared = await preparePathAsClientDownload(sourcePath, title, id);
  return sendDownloadFile(req, res, prepared.filePath, prepared.fileName, { deleteAfterSend: prepared.deleteAfterSend });
}
const MPKG_TOOL_DIR = path.join(TOOLS_DIR, 'mpkg');
const MPKG_TOOL_SCRIPT = path.join(MPKG_TOOL_DIR, 'mobile_mpkg.py');
let MPKG_SERVICE = null;

function getMpkgService() {
  if (!MPKG_SERVICE) {
    MPKG_SERVICE = createMpkgConversionService({
      toolDir: MPKG_TOOL_DIR,
      toolScript: MPKG_TOOL_SCRIPT,
      ensureDir,
      commandExists,
      runProcess,
      sleep,
      findDownloadedItemPath,
      createWorkshopQueueTask,
      safeName,
      isDebugEnabled: mpkgDebugEnabled,
      getTextureProfile: () => process.env.WALLHUB_MPKG_TEXTURE_PROFILE || VIDEO_CACHE_SETTINGS.mpkgTextureProfile,
      logger: console,
    });
  }
  return MPKG_SERVICE;
}

let CLIENT_DOWNLOAD_SERVICE = null;

function getClientDownloadService() {
  if (!CLIENT_DOWNLOAD_SERVICE) {
    CLIENT_DOWNLOAD_SERVICE = createClientDownloadService({
      ensureDir,
      safeName,
      zipDir,
      findDownloadedItemPath,
      createWorkshopQueueTask,
      sleep,
    });
  }
  return CLIENT_DOWNLOAD_SERVICE;
}

const MPKG_BUILD_PROMISES = {
  has(buildKey) {
    return getMpkgService().buildPromises.has(buildKey);
  }
};

function pythonMpkgDependencyStatus(python) {
  return getMpkgService().pythonDependencyStatus(python);
}

function findPythonExecutable() {
  return getMpkgService().findPythonExecutable();
}

function hasWorkshopFile(dir, name) {
  return getMpkgService().hasWorkshopFile(dir, name);
}

function hasWorkshopPreview(dir) {
  return getMpkgService().hasWorkshopPreview(dir);
}

function isSceneWorkshopDir(dir) {
  return getMpkgService().isSceneWorkshopDir(dir);
}

function mpkgOutputPathForItem(itemDir, id) {
  return getMpkgService().outputPathForItem(itemDir, id);
}

function normalizeMpkgError(error) {
  return getMpkgService().normalizeError(error);
}

async function buildMpkgForItem(itemDir, id, outputPath) {
  return getMpkgService().buildForItem(itemDir, id, outputPath);
}

async function ensureMpkgForItem(itemDir, id) {
  return getMpkgService().ensureForItem(itemDir, id);
}

async function ensureDownloadedItemForMpkg(id, title) {
  return getMpkgService().ensureDownloadedItem(id, title);
}
async function prepareMpkgDownloadFile(id, title, textureProfile, options) {
  return getMpkgService().prepareDownloadFile(id, title, textureProfile, options);
}

function getMpkgPreparationService() {
  if (!MPKG_PREPARATION_SERVICE) {
    MPKG_PREPARATION_SERVICE = createMpkgPreparationService({
      prepareDownloadFile: prepareMpkgDownloadFile,
    });
  }
  return MPKG_PREPARATION_SERVICE;
}

async function prepareClientDownloadFile(id, title) {
  return getClientDownloadService().prepareDownloadFile(id, title);
}

function triggerQueue() {
  return getDownloadQueueService().trigger();
}

let VIDEO_CONTROLLER = null;

function getVideoController() {
  if (!VIDEO_CONTROLLER) {
    VIDEO_CONTROLLER = createVideoController({
      createDepotStreamService,
      userAgent: UA,
      jsonRes,
      send,
      getVideoCacheSettings: () => VIDEO_CACHE_SETTINGS,
      effectiveDownloaderMode,
      getServerStopping: () => SERVER_STOPPING,
      isCacheItemTombstoned,
      getDownloadQueueService,
      getTaskQueue: () => TASK_QUEUE,
      createWorkshopQueueTask,
      getWorkshopCacheDir: () => WORKSHOP_CACHE_DIR,
      waitForStartupPreparationForDownload,
      getFileDetails,
      detectVideoTag,
      isVideoExt,
      extFromUrl,
      extFromPath,
      mimeFromExt,
      getVideoMime,
      updateSteamCdnStatus,
      updateSteamCdnStatusFromText,
      steamCdnStatusSnapshot,
      getProxyCandidates,
      isSocksProxyProtocol,
      connectViaSocksProxy,
      proxyAuth,
      resolveDepotLogin,
      steamKitNeedsOwnedAccount,
      canUseDepotLogin,
      makeSteamKitLoginRequiredError,
      normalizeDepotError,
      shouldRetrySteamLoginRequiredError,
      refreshPersistentSteamLoginForRetry,
      codedError,
      depotCommandFor,
      getSteamKitStreamMaxDownloads,
      makeDepotLoginId,
      getSteamContentCellId,
      ensureDepotStreamDownloaderReady,
      ensureDir,
      runProcess,
      buildSteamContentEnv,
      buildDepotDotnetEnv,
      getSteamCdnRouteStrategy,
      describeSteamCdnRouteStrategy,
      fmtBytes,
      getDepotStreamCacheMaxBytes,
      hasFilesRecursive,
      sleep,
      logger: console,
      DEPOT_STREAM_PATCH_VERSION,
      DEPOT_CONFIG_DIR,
      DEPOT_STREAM_CACHE_DIR,
      DEPOT_STREAM_MAX_RANGE_BYTES,
      DEPOT_STREAM_FIRST_RANGE_BYTES,
      DEPOT_STREAM_TAIL_BYTES,
      DEPOT_STREAM_INITIAL_BUFFER_BYTES,
      DEPOT_STREAM_AHEAD_BYTES,
      DEPOT_STREAM_WORKER_IDLE_MS,
      DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK,
      DEPOT_STREAM_CACHE_CLEANUP_TARGET,
      DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS,
    });
  }
  return VIDEO_CONTROLLER;
}

const steamKitDepotStreamingEnabled = (...args) => getVideoController().steamKitDepotStreamingEnabled(...args);
const getDepotStreamService = (...args) => getVideoController().getDepotStreamService(...args);
const streamFileWithRange = (...args) => getVideoController().streamFileWithRange(...args);
const stopAllDepotStreamWorkers = (...args) => getVideoController().stopAllDepotStreamWorkers(...args);
const cleanupDepotStreamCache = (...args) => getVideoController().cleanupDepotStreamCache(...args);
const clearDepotStreamCacheNow = (...args) => getVideoController().clearDepotStreamCacheNow(...args);
const proxyRemoteVideoStream = (...args) => getVideoController().proxyRemoteVideoStream(...args);
const handleDepotVideoStream = (...args) => getVideoController().handleDepotVideoStream(...args);
const handleDepotVideoRelease = (...args) => getVideoController().handleDepotVideoRelease(...args);
const handleVideoPlay = (...args) => getVideoController().handleVideoPlay(...args);
const handleVideoStream = (...args) => getVideoController().handleVideoStream(...args);

async function listCachedItems(options = {}) {
  return getCacheItemsService().listCachedItems(options);
}

function handleCachedVideoStream(req, res, key) {
  return getCacheItemsService().handleCachedVideoStream(req, res, key);
}

function deleteCachedItemFiles(key) {
  return getCacheItemsService().deleteCachedItemFiles(key);
}

function handleCachedItemDelete(res, key) {
  return getCacheItemsService().handleCachedItemDelete(res, key);
}

let DOWNLOADS_CONTROLLER = null;

function getDownloadsController() {
  if (!DOWNLOADS_CONTROLLER) {
    DOWNLOADS_CONTROLLER = createDownloadsController({
      jsonRes,
      readBody,
      sendDownloadFile,
      sendPreparedDownload,
      createPreparedDownload,
      prepareMpkgDownloadFile,
      startMpkgPreparation: (id, title, textureProfile) => getMpkgPreparationService().start(id, title, textureProfile),
      getMpkgPreparation: (id, textureProfile) => getMpkgPreparationService().get(id, textureProfile),
      serializeMpkgPreparation: job => getMpkgPreparationService().toPublic(job),
      prepareClientDownloadFile,
      findDownloadedItemPath,
      findQueueItemById,
      sendPathAsClientDownload,
      getTaskQueue: () => getDownloadQueueService().tasks,
      createWorkshopQueueTask,
      getDownloadQueueService,
      listCachedItems,
      isCacheItemTombstoned,
      handleCachedItemDelete,
      deleteCachedItemFiles,
      getCacheItemsService,
      cleanupTaskFiles,
      cleanupOrphanDepotDownloaderDownloads,
      triggerQueue,
      enforceTopOnlyQueueRunner,
      sleep,
      isDebugEnabled: mpkgDebugEnabled,
      logger: console,
    });
  }
  return DOWNLOADS_CONTROLLER;
}

const handleMpkgDownload = (...args) => getDownloadsController().handleMpkgDownload(...args);
const handleMpkgPreparationStart = (...args) => getDownloadsController().handleMpkgPreparationStart(...args);
const handleMpkgPreparationStatus = (...args) => getDownloadsController().handleMpkgPreparationStatus(...args);
const handleClientDownload = (...args) => getDownloadsController().handleClientDownload(...args);
const handleDownload = (...args) => getDownloadsController().handleDownload(...args);
const listQueueItems = (...args) => getDownloadsController().listQueueItems(...args);
const handleQueueAction = (...args) => getDownloadsController().handleQueueAction(...args);

function removePathWithRetry(target) {
  return getCacheItemsService().removePathWithRetry(target);
}

function quarantinePathForBackgroundDelete(target, label = 'delete') {
  return getCacheItemsService().quarantinePathForBackgroundDelete(target, label);
}

function deletePathIfInside(target, allowedRoots) {
  return getCacheItemsService().deletePathIfInside(target, allowedRoots);
}

function cleanupTaskFiles(task) {
  return getCacheItemsService().cleanupTaskFiles(task);
}

function cleanupRuntimeDownloadResidues(appId = 431960, keepIds = []) {
  return getCacheItemsService().cleanupRuntimeDownloadResidues(appId, keepIds);
}

function cleanupOrphanDepotDownloaderDownloads(appId, keepIds) {
  return getCacheItemsService().cleanupOrphanDepotDownloaderDownloads(appId, keepIds);
}

function runtimeResidueKeepIds(excludeId = '') {
  return getCacheItemsService().runtimeResidueKeepIds(excludeId);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// -------------------------------------------------------------------------
async function handleSteamKitLogin(res, payload) {
  const username = String(payload.username || '').trim();
  const password = String(payload.password || '').trim();
  const steamGuardCode = String(payload.steamGuardCode || '').trim();
  const isRetry = !!payload.isRetry;
  if (!username || !password) {
    return jsonRes(res, 400, { error: '用户名和密码不能为空' });
  }

  try {
    await verifySteamKitLogin(username, password, steamGuardCode);
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e || 'Steam 登录失败'));
    if (err.code === 'STEAM_GUARD_REQUIRED' && !steamGuardCode && !isRetry) {
      return jsonRes(res, 202, {
        error: err.message,
        code: err.code,
        needsSteamGuard: true,
        requiresSteamLogin: true,
        requiresSteamGuard: true
      });
    }
    return jsonRes(res, err.statusCode || 500, {
      error: err.message,
      code: err.code || '',
      needsSteamGuard: !!err.requiresSteamGuard,
      requiresSteamLogin: !!err.requiresSteamLogin,
      requiresSteamGuard: !!err.requiresSteamGuard
    });
  }

  STEAM_CREDENTIALS.username = username;
  STEAM_CREDENTIALS.password = '';
  STEAM_CREDENTIALS.steamGuardCode = '';
  STEAM_CREDENTIALS.isPersistent = true;
  STEAM_CREDENTIALS.pendingPersistentUsername = '';

  VIDEO_CACHE_SETTINGS.steamUsername = username;
  VIDEO_CACHE_SETTINGS.steamIsPersistent = true;
  VIDEO_CACHE_SETTINGS.authBackend = 'steamkit';
  saveCacheSettings();

  jsonRes(res, 200, {
    success: true,
    message: 'SteamKit 登录验证成功，DepotDownloader 会话已持久化',
    username,
    hasSteamGuard: false,
    isPersistent: true,
    backend: 'steamkit'
  });
}

function clearDepotDownloaderAuth() {
  return getSteamKitLoginService().clearDepotDownloaderAuth();
}

async function handleSteamLogin(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch { return jsonRes(res, 400, { error: 'Bad JSON' }); }

  const username = String(payload.username || '').trim();
  const password = String(payload.password || '').trim();
  const steamGuardCode = String(payload.steamGuardCode || '').trim();
  const isRetry = payload.isRetry || false;

  if (!username || !password) {
    return jsonRes(res, 400, { error: '用户名和密码不能为空' });
  }

  console.log(`[Steam Login] Attempting SteamKit login for user: ${username}, SteamGuard: ${steamGuardCode ? 'Yes' : 'No'}, Retry: ${isRetry}`);
  return handleSteamKitLogin(res, payload);
}

async function handleSteamPasswordLoginStart(req, res) {
  let payload;
  try { payload = JSON.parse(await readBody(req)); }
  catch { return jsonRes(res, 400, { error: 'Bad JSON' }); }

  const username = String(payload.username || '').trim();
  const password = String(payload.password || '').trim();
  if (!username || !password) return jsonRes(res, 400, { error: '用户名和密码不能为空' });

  try {
    console.log(`[Steam Login] Starting tracked SteamKit login for user: ${username}`);
    return jsonRes(res, 200, startSteamKitPasswordLoginSession(payload));
  } catch (error) {
    const err = normalizeDepotError(error);
    return jsonRes(res, err.statusCode || 500, {
      error: err.message || 'Steam 登录失败',
      code: err.code || '',
      requiresSteamLogin: !!err.requiresSteamLogin,
      requiresSteamGuard: !!err.requiresSteamGuard,
    });
  }
}

async function handleSteamPasswordLoginStatus(req, res) {
  const id = new URL(req.url, 'http://x').searchParams.get('id');
  const session = getSteamKitPasswordLoginSession(id);
  if (!session) return jsonRes(res, 404, { error: '账号登录会话不存在或已过期' });
  return jsonRes(res, 200, session);
}

async function handleSteamQrLoginStart(req, res) {
  try {
    const session = await startSteamKitQrLoginSession();
    jsonRes(res, 200, session);
  } catch (e) {
    const err = normalizeDepotError(e);
    jsonRes(res, err.statusCode || 500, {
      error: err.message,
      code: err.code || '',
      requiresSteamLogin: !!err.requiresSteamLogin,
      requiresSteamGuard: !!err.requiresSteamGuard
    });
  }
}

async function handleSteamQrLoginStatus(req, res) {
  const id = new URL(req.url, 'http://x').searchParams.get('id');
  const session = getSteamKitQrLoginSession(id);
  if (!session) return jsonRes(res, 404, { error: '扫码登录会话不存在或已过期' });
  jsonRes(res, 200, session);
}

async function handleSteamQrLoginCancel(req, res) {
  let id = new URL(req.url, 'http://x').searchParams.get('id') || '';
  if (!id) {
    try {
      const payload = JSON.parse(await readBody(req));
      id = String(payload.id || '');
    } catch {}
  }
  const ok = cancelSteamKitQrLoginSession(id);
  jsonRes(res, ok ? 200 : 404, ok ? { success: true } : { error: '扫码登录会话不存在或已过期' });
}

async function handleSteamLogout(req, res) {
  const wasPersistent = STEAM_CREDENTIALS.isPersistent;
  const username = STEAM_CREDENTIALS.username;

  stopSteamKitQueryBridge('Steam account logged out');

  // Clear in-memory credentials.
  STEAM_CREDENTIALS.username = '';
  STEAM_CREDENTIALS.password = '';
  STEAM_CREDENTIALS.steamGuardCode = '';
  STEAM_CREDENTIALS.isPersistent = false;
  STEAM_CREDENTIALS.pendingPersistentUsername = '';

  // Clear persisted account settings.
  VIDEO_CACHE_SETTINGS.steamUsername = '';
  VIDEO_CACHE_SETTINGS.steamIsPersistent = false;
  VIDEO_CACHE_SETTINGS.authBackend = '';
  saveCacheSettings();
  clearDepotDownloaderAuth();

  console.log('[Steam Logout] Credentials cleared');
  jsonRes(res, 200, { success: true, message: '已退出登录' });
}

async function handleSteamStatus(req, res) {
  const pendingUser = String(STEAM_CREDENTIALS.pendingPersistentUsername || '').trim();
  const isLoggedIn = !!(STEAM_CREDENTIALS.username && (STEAM_CREDENTIALS.password || STEAM_CREDENTIALS.isPersistent));
  const pendingCanBeTreatedAsLogin = !!pendingUser && ['idle', 'checking', 'installing', 'validating-login'].includes(String(RUNTIME_SETUP.status || ''));
  const displayUser = isLoggedIn ? STEAM_CREDENTIALS.username : (pendingCanBeTreatedAsLogin ? pendingUser : '');
  jsonRes(res, 200, {
    loggedIn: isLoggedIn || pendingCanBeTreatedAsLogin,
    username: displayUser || null,
    isPersistent: STEAM_CREDENTIALS.isPersistent || false,
    pendingValidation: !!pendingUser,
    pendingUsername: pendingUser,
    backend: effectiveDownloaderMode(),
    requestedBackend: getDownloaderMode()
  });
}

// -------------------------------------------------------------------------
// -------------------------------------------------------------------------
// -------------------------------------------------------------------------
async function handleDebug(res) {
  try {
    const url  = 'https://steamcommunity.com/workshop/browse/?appid=431960&browsesort=trend&section=readytouseitems&actualsort=trend&p=1&numperpage=3&days=30&requiredtags%5B%5D=Video';
    const html = (await GET(url)).toString('utf8');
    const idxData = html.indexOf('data-publishedfileid');
    const idxHref = html.indexOf('sharedfiles/filedetails');
    const idx  = idxData >= 0 ? idxData : idxHref;

    let out = `=== WallHub Debug: Steam Workshop HTML Structure ===\n`;
    out += `URL: ${url}\n`;
    out += `HTML total length: ${html.length} bytes\n\n`;

    if (idx === -1) {
      out += `[Error] NO workshop item id found in HTML!\n\n`;
      out += `=== First 3000 chars ===\n${html.substring(0, 3000)}`;
    } else {
      const ids = Array.from(new Set([
        ...Array.from(html.matchAll(/data-publishedfileid=["'](\d+)["']/g)).map(m => m[1]),
        ...Array.from(html.matchAll(/sharedfiles\/filedetails\/\?id=(\d+)/g)).map(m => m[1]),
        ...Array.from(html.matchAll(/sharedfiles\\\/filedetails\\\/\?id=(\d+)/g)).map(m => m[1]),
      ]));
      out += `✓ Found ${ids.length} workshop item ids\n`;
      out += `IDs: ${ids.slice(0,10).join(', ')}\n\n`;

      const imgTags = (html.substring(idx-500, idx+3000).match(/<img[^>]+>/g) || []);
      out += `img tags near first item: ${imgTags.length}\n`;
      imgTags.forEach((t,i) => out += `  [${i}] ${t}\n`);

      out += `\n=== Block around first item (chars ${idx-200} to ${idx+2500}) ===\n`;
      out += html.substring(Math.max(0,idx-200), idx+2500);
    }

    send(res, 200, out, 'text/plain; charset=utf-8');
  } catch (err) {
    send(res, 500, `Debug Error: ${err.message}`, 'text/plain; charset=utf-8');
  }
}

// -------------------------------------------------------------------------
// -------------------------------------------------------------------------
// -------------------------------------------------------------------------
const serveStatic = createStaticHandler({ publicDir: PUBLIC, send, mimeType });

// -------------------------------------------------------------------------
// -------------------------------------------------------------------------
// -------------------------------------------------------------------------
async function handleServerRuntime(req, res) {
  const docker = isDockerLikeEnv();
  const setup = runtimeSetupSnapshot();
  const steamCdn = steamCdnStatusSnapshot();
  const steamAccess = steamAccessRuntimeSnapshot();
  const depotStream = {
    enabled: steamKitDepotStreamingEnabled(),
    workers: getDepotStreamService().workers.size,
    cacheMaxMb: getDepotStreamCacheMaxMb(),
  };
  const update = UPDATE_SERVICE.snapshot();
  const revision = [
    Number(setup.updatedAt || 0),
    Number(steamCdn.updatedAt || 0),
    Number(steamAccess.updatedAt || 0),
    Number(depotStream.workers || 0),
    depotStream.enabled ? 1 : 0,
    Number(update.updatedAt || 0),
  ].join(':');
  return jsonRes(res, 200, {
    revision,
    platform: process.platform,
    arch: process.arch,
    docker,
    termux: isTermuxLikeEnv(),
    canRestart: true,
    canShutdown: !docker,
    supervised: IS_SUPERVISOR_CHILD,
    version: PACKAGE_JSON.version,
    downloaderMode: getDownloaderMode(),
    effectiveDownloader: setup.mode,
    nsfwEnabled: NSFW_ENABLED,
    runtimeSetup: setup,
    steamCdn: {
      currentHost: steamCdn.currentHost,
      currentVHost: steamCdn.currentVHost,
      currentPort: steamCdn.currentPort,
      source: steamCdn.source,
      mode: steamCdn.mode,
      strategy: steamCdn.strategy,
      updatedAt: steamCdn.updatedAt,
    },
    steamAccess,
    depotStream,
    update,
    runnerDir: setup.runnerDir,
    accountDir: setup.accountDir,
    downloadsDir: DOWNLOADS_DIR,
    steamKitPath: resolveDepotDownloaderPath() || ''
  });
}

async function handleServerUpdateStatus(req, res) {
  jsonRes(res, 200, UPDATE_SERVICE.snapshot());
}

function rejectUntrustedUpdateMutation(req, res) {
  if (isUpdateMutationAllowed(req)) return false;
  jsonRes(res, 403, { error: 'Cross-site update requests are not allowed', code: 'UPDATE_ORIGIN_DENIED' });
  return true;
}

async function handleServerUpdateCheck(req, res) {
  if (rejectUntrustedUpdateMutation(req, res)) return;
  try {
    const cached = new URL(req.url, 'http://x').searchParams.get('cached') === '1';
    jsonRes(res, 200, await UPDATE_SERVICE.checkNow(cached ? { maxAgeMs: 5 * 60 * 1000 } : {}));
  } catch (error) {
    jsonRes(res, 502, { error: error.message || 'Update check failed', code: error.code || 'UPDATE_CHECK_FAILED' });
  }
}

async function handleServerUpdateDownload(req, res) {
  if (rejectUntrustedUpdateMutation(req, res)) return;
  try {
    jsonRes(res, 202, UPDATE_SERVICE.startDownload());
  } catch (error) {
    jsonRes(res, 400, { error: error.message || 'Update download failed', code: error.code || 'UPDATE_DOWNLOAD_FAILED' });
  }
}

async function handleServerUpdateInstall(req, res) {
  if (rejectUntrustedUpdateMutation(req, res)) return;
  try {
    jsonRes(res, 202, UPDATE_SERVICE.installDownloaded());
  } catch (error) {
    const statusCode = error.code === 'UPDATE_BUSY' ? 409 : 400;
    jsonRes(res, statusCode, { error: error.message || 'Update installation failed', code: error.code || 'UPDATE_INSTALL_FAILED' });
  }
}

async function handleServerRuntimeDiagnostics(req, res) {
  const setup = runtimeSetupSnapshot();
  const steamCdn = steamCdnStatusSnapshot();
  const steamAccess = steamAccessDiagnosticSnapshot();
  const revision = [
    Number(setup.updatedAt || 0),
    Number(steamCdn.updatedAt || 0),
    Number(steamAccess.generatedAt || 0),
  ].join(':');
  return jsonRes(res, 200, {
    revision,
    generatedAt: Date.now(),
    runtimeSetup: setup,
    steamCdn,
    steamAccess,
    depotStream: {
      enabled: steamKitDepotStreamingEnabled(),
      workers: getDepotStreamService().workers.size,
      cacheDir: DEPOT_STREAM_CACHE_DIR,
      cacheMaxMb: getDepotStreamCacheMaxMb(),
      firstRangeBytes: DEPOT_STREAM_FIRST_RANGE_BYTES,
      rangeBytes: DEPOT_STREAM_MAX_RANGE_BYTES,
    },
  });
}

async function handleServerRestart(req, res) {
  const result = await restartServer();
  jsonRes(res, 200, {
    success: true,
    message: result.mode === 'exit' ? '服务端正在退出，请由 Docker 重启策略拉起' : '服务端正在重启',
    mode: result.mode,
    logPath: result.logPath || ''
  });
}

async function handleServerShutdown(req, res) {
  const result = await shutdownServer();
  jsonRes(res, 200, {
    success: true,
    message: '服务端正在关闭',
    mode: result.mode
  });
}

async function handleSteamAccessHostsFetch(req, res) {
  try {
    const data = JSON.parse(await readBody(req));
    const result = await STEAM_ACCESS_HOSTS_UPDATER.fetchAndMaybeSave(data.url, data.save !== false);
    jsonRes(res, 200, result);
  } catch (e) {
    jsonRes(res, 400, { success: false, error: e.message || 'Hosts fetch failed' });
  }
}

async function handleSteamAccessDiagnostics(req, res) {
  jsonRes(res, 200, steamAccessDiagnosticSnapshot());
}

async function handleClientEvent(req, res) {
  try {
    const payload = JSON.parse(await readBody(req));
    const experimental = getRuntimeSettings().getSteamAccessExperimental();
    const eventName = truncateClientEventValue(payload.event || payload.type || 'event', 48);
    const shouldLog = shouldLogClientEvent(eventName, experimental, DEBUG_ENABLED);
    if (shouldLog) {
      const event = eventName;
      const action = truncateClientEventValue(payload.action || '', 48);
      const id = truncateClientEventValue(payload.id || payload.publishedfileid || '', 32).replace(/[^0-9]/g, '');
      const source = truncateClientEventValue(payload.source || '', 48);
      const itemType = truncateClientEventValue(payload.itemType || '', 48);
      const title = truncateClientEventValue(payload.title || '', 120);
      console.log(`[ClientEvent] event=${event || 'event'} action=${action || '-'} id=${id || '-'} source=${source || '-'} itemType=${itemType || '-'} title="${title.replace(/"/g, "'")}"`);
    }
    jsonRes(res, 200, { success: true });
  } catch (e) {
    jsonRes(res, 400, { success: false, error: e.message || 'Invalid client event' });
  }
}

async function handleVideoCacheSettingsGet(req, res) {
  jsonRes(res, 200, cacheSettingsSnapshotWithMpkgCapabilities());
}

async function handleVideoCacheSettingsDetailsGet(req, res) {
  jsonRes(res, 200, {
    wallhubSteamAccessHosts: String(VIDEO_CACHE_SETTINGS.wallhubSteamAccessHosts || ''),
    wallhubSteamAccessHostsDeferred: false,
  });
}

async function handleDepotStreamCacheClear(req, res) {
  jsonRes(res, 200, clearDepotStreamCacheNow());
}

async function handleVideoCacheSettingsPost(req, res) {
  try {
    const data = JSON.parse(await readBody(req));
    const previousStreamSettings = {
      steamCdnRouteStrategy: getSteamCdnRouteStrategy(),
      steamHttpProxyUrl: VIDEO_CACHE_SETTINGS.steamHttpProxyUrl || '',
      steamKitMaxDownloads: getSteamKitMaxDownloads(),
      steamKitDepotStreaming: !!VIDEO_CACHE_SETTINGS.steamKitDepotStreaming
    };
    getRuntimeSettings().setState(VIDEO_CACHE_SETTINGS);
    const patchResult = getRuntimeSettings().applyPatch(data);
    VIDEO_CACHE_SETTINGS = patchResult.settings;
    const workshopSearchSettingsChanged = patchResult.steamApiKeyChanged ||
      patchResult.steamAccessResolverChanged ||
      patchResult.steamAccessEnhanceChanged ||
      patchResult.steamAccessDirectWebApiChanged;
    if (patchResult.steamAccessEnhanceChanged) {
      STEAM_ACCESS_GATEWAY.clear();
    } else {
      if (patchResult.steamAccessResolverChanged) STEAM_ACCESS_GATEWAY.clear(['resolver']);
      if (patchResult.steamAccessHostsChanged) STEAM_ACCESS_GATEWAY.clear(['hosts']);
    }
    if (workshopSearchSettingsChanged && WORKSHOP_SEARCH_SERVICE && typeof WORKSHOP_SEARCH_SERVICE.clearCaches === 'function') {
      WORKSHOP_SEARCH_SERVICE.clearCaches();
    }

    saveCacheSettings();
    UPDATE_SERVICE.scheduleSoon();
    if (patchResult.steamAccessHostsChanged) STEAM_ACCESS_HOSTS_UPDATER.schedule();
    const steamAccessShouldWarm = !!VIDEO_CACHE_SETTINGS.wallhubSteamAccessEnhance || getRuntimeSettings().steamAccessStaticCdnEnhanceEnabled();
    if (steamAccessShouldWarm) {
      if (VIDEO_CACHE_SETTINGS.wallhubSteamAccessEnhance) warmupSteamAccessGatewayCore('settings-core', { forceRefresh: false });
      setTimeout(() => warmupSteamAccessGatewayCdnBackground('settings-cdn').catch(() => {}), 8000).unref?.();
      if (VIDEO_CACHE_SETTINGS.wallhubSteamAccessMode === 'hosts' && patchResult.steamAccessHostsChanged) {
        logSteamAccessResolvedRoutes('HOSTS applied').catch((err) => console.warn('[SteamAccess] hosts route log failed:', err.message));
      }
    }
    setTimeout(() => cleanupDepotStreamCache({ force: true, targetWatermark: DEPOT_STREAM_CACHE_CLEANUP_TARGET }), 100).unref?.();
    const nextStreamSettings = {
      steamCdnRouteStrategy: getSteamCdnRouteStrategy(),
      steamHttpProxyUrl: VIDEO_CACHE_SETTINGS.steamHttpProxyUrl || '',
      steamKitMaxDownloads: getSteamKitMaxDownloads(),
      steamKitDepotStreaming: !!VIDEO_CACHE_SETTINGS.steamKitDepotStreaming
    };
    if (JSON.stringify(previousStreamSettings) !== JSON.stringify(nextStreamSettings)) {
      stopAllDepotStreamWorkers('settings-changed');
    }
    warmupDepotStreamDownloader('settings');
    triggerQueue();

    jsonRes(res, 200, cacheSettingsSnapshotWithMpkgCapabilities({ success: true }));
  } catch (e) {
    jsonRes(res, 400, { error: e.message || 'Invalid JSON' });
  }
}

const routeHttpRequest = createAppRouter({
  jsonRes,
  send,
  virtualHostParam: WALLHUB_PROXY_VIRTUAL_HOST_PARAM,
  isWallhubProxyVirtualSteamPath,
  handleWallhubUrlProxy,
  handleWallhubVirtualSteamProxy,
  handleWallhubSteamAppRelativeAsset,
  handleDebug,
  handleServerRuntime,
  handleServerRuntimeDiagnostics,
  handleServerUpdateStatus,
  handleServerUpdateCheck,
  handleServerUpdateDownload,
  handleServerUpdateInstall,
  handleServerRestart,
  handleServerShutdown,
  handleInternalSteamResolve,
  handleInternalSteamWebApi,
  handleQuery,
  handleSteamAccessReady,
  handleDetails,
  handlePersonalSource,
  handleSteamSubscribe,
  handleSteamUnsubscribe,
  handleSteamFavorite,
  handleSteamUnfavorite,
  handleSteamSubscriptionStatus,
  handleDetailsBatch,
  handleCommentsPage,
  handleClientDownload,
  handleDownload,
  handleMpkgDownload,
  handleMpkgPreparationStart,
  handleMpkgPreparationStatus,
  handleVideoPlay,
  handleVideoStream,
  proxyRemoteVideoStream,
  handleDepotVideoStream,
  handleDepotVideoRelease,
  listCachedItems,
  handleCachedVideoStream,
  handleCachedItemDelete,
  listQueueItems,
  handleQueueAction,
  handleSteamQrLoginStart,
  handleSteamQrLoginStatus,
  handleSteamQrLoginCancel,
  handleSteamPasswordLoginStart,
  handleSteamPasswordLoginStatus,
  handleSteamLogin,
  handleSteamLogout,
  handleSteamStatus,
  handleSteamAccessHostsFetch,
  handleSteamAccessDiagnostics,
  handleClientEvent,
  handleVideoCacheSettingsGet,
  handleVideoCacheSettingsDetailsGet,
  handleDepotStreamCacheClear,
  handleVideoCacheSettingsPost,
  serveStatic,
});

async function handleHttpRequest(req, res) {
  let pathname = '/';
  try { pathname = new URL(req.url, 'http://x').pathname; } catch {}
  const statusRequest = req.method === 'GET' && ['/health', '/api/server/runtime', '/api/server/update'].includes(pathname);
  const updateRequest = pathname.startsWith('/api/server/update/');
  if (UPDATE_INSTALL_PENDING && !statusRequest && !updateRequest) {
    return jsonRes(res, 503, { error: 'WallHub is preparing to install an update', code: 'UPDATE_INSTALL_PENDING' });
  }
  if (statusRequest || updateRequest) return routeHttpRequest(req, res);

  ACTIVE_HTTP_REQUESTS += 1;
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    ACTIVE_HTTP_REQUESTS = Math.max(0, ACTIVE_HTTP_REQUESTS - 1);
  };
  res.once('finish', release);
  res.once('close', release);
  try {
    return await routeHttpRequest(req, res);
  } catch (error) {
    release();
    throw error;
  }
}

function onHttpListening() {
  // Load cache settings before printing startup information and creating directories.
  loadCacheSettings();
  STEAM_ACCESS_HOSTS_UPDATER.schedule();
  UPDATE_SERVICE.schedule();

  console.log('\n  ===========================================');
  console.log(`  WallHub v${PACKAGE_JSON.version}  -  http://localhost:${PORT}`);
  console.log('  ===========================================\n');
  console.log(`  public : ${PUBLIC}`);
  console.log(`  debug  : http://localhost:${PORT}/api/debug`);
  console.log(`  Node   : ${process.version}`);
  console.log(`  OS     : ${process.platform}`);
  console.log(`  Runner : ${ACTIVE_RUNNER_DIR}`);
  console.log(`  Files  : ${DOWNLOADS_DIR}`);
  const requestedDownloader = getDownloaderMode();
  const effectiveDownloader = effectiveDownloaderMode();
  const downloaderLabel = requestedDownloader === effectiveDownloader
    ? effectiveDownloader
    : `${requestedDownloader} -> ${effectiveDownloader}`;
  console.log(`  DL     : ${downloaderLabel}${isTermuxLikeEnv() ? ' (Termux)' : ''}`);
  console.log(`  CDN    : ${describeSteamCdnRouteStrategy()}${effectiveDownloader === 'steamkit' ? ` - SteamKit max ${getSteamKitMaxDownloads()}` : ''}`);
  console.log(`  NSFW   : ${NSFW_ENABLED ? 'enabled' : 'disabled'}`);
  console.log(`  Debug  : ${DEBUG_ENABLED ? 'enabled' : 'disabled'}`);
  console.log(`  Guard  : ${IS_SUPERVISOR_CHILD ? 'supervised' : 'disabled'}\n`);

  // Ensure Steam config directories exist.
  ensureSteamConfigDir();

  // Initialize Steam credentials and remembered login state.
  initializeSteamCredentials();

  // Prepare downloader runtime in the background; frontend can poll /api/server/runtime.
  prepareRuntimeOnStartup();
}

const { serverLifecycle, isDockerLikeEnv, restartServer, shutdownServer } = startWallhubServer({
  http,
  cors,
  handleHttpRequest,
  createServerLifecycle,
  port: PORT,
  entryFile: __filename,
  projectRoot: PROJECT_ROOT,
  isSupervisorChild: IS_SUPERVISOR_CHILD,
  isRestartChild: IS_RESTART_CHILD,
  logger: console,
  onHttpListening,
  markServerStopping: () => { SERVER_STOPPING = true; },
  stopAllDepotStreamWorkers: (reason) => {
    stopSteamKitQueryBridge(reason || 'WallHub server stopping');
    stopAllDepotStreamWorkers(reason);
  },
  buildDepotRuntime: async () => {
    loadCacheSettings();
    ensureSteamConfigDir();
    const json = await ensureJsonProgressDepotDownloaderReady();
    const stream = await buildDepotStreamDownloader();
    return { json, stream };
  },
});
REQUEST_UPDATE_SHUTDOWN = () => shutdownServer().catch(error => console.warn('[Update] Shutdown failed:', error.message));
