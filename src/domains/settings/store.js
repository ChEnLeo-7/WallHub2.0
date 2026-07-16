'use strict';

const fs = require('fs');
const {
  DEFAULT_CACHE_SETTINGS,
  pruneLegacySteamCdnSettings,
  pruneRemovedSteamAccessSettings,
  normalizeLoadedCacheSettings,
  applyCacheSettingsPatch,
} = require('./schema');

function createCacheSettingsStore(options = {}) {
  const settingsFile = options.settingsFile;
  const logger = options.logger || console;
  let state = Object.assign({}, options.defaultSettings || DEFAULT_CACHE_SETTINGS);

  function setState(next) {
    state = Object.assign({}, DEFAULT_CACHE_SETTINGS, next || {});
    return state;
  }

  function load(loadOptions = {}) {
    try {
      if (!settingsFile || !fs.existsSync(settingsFile)) return state;
      const parsed = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      state = normalizeLoadedCacheSettings(parsed, {
        logger,
        getMaxConcurrentDownloads: loadOptions.getMaxConcurrentDownloads,
      });

      if (state.downloadDir && typeof loadOptions.applyDownloadDir === 'function') {
        try {
          state.downloadDir = loadOptions.applyDownloadDir(state.downloadDir);
        } catch (dirErr) {
          logger.warn('[Settings] Failed to apply download directory:', dirErr.message);
          if (typeof loadOptions.getCurrentDownloadDir === 'function') {
            state.downloadDir = loadOptions.getCurrentDownloadDir();
          }
        }
      }
      logger.log('[Settings] Loaded Steam API settings');
    } catch (e) {
      logger.warn('[Settings] Failed to load settings:', e.message);
    }
    return state;
  }

  function save(nextState) {
    if (nextState) state = nextState;
    try {
      pruneLegacySteamCdnSettings(state);
      pruneRemovedSteamAccessSettings(state);
      fs.writeFileSync(settingsFile, JSON.stringify(state, null, 2));
      logger.log('[Settings] Saved Steam API settings');
      return true;
    } catch (e) {
      logger.warn('[Settings] Failed to save settings:', e.message);
      return false;
    }
  }

  function applyPatch(data, patchOptions = {}) {
    const result = applyCacheSettingsPatch(state, data, patchOptions);
    state = result.settings;
    return result;
  }

  function snapshot(extra = {}, getters = {}) {
    const get = (name, fallback) => (typeof getters[name] === 'function' ? getters[name]() : fallback);
    return Object.assign({
      steamApiKey: state.steamApiKey || '',
      wallhubLogLevel: state.wallhubLogLevel || DEFAULT_CACHE_SETTINGS.wallhubLogLevel,
      mpkgTextureProfile: state.mpkgTextureProfile || DEFAULT_CACHE_SETTINGS.mpkgTextureProfile,
      useSteamApi: !!state.useSteamApi,
      downloadDir: get('downloadDir', state.downloadDir || ''),
      maxConcurrentDownloads: get('maxConcurrentDownloads', state.maxConcurrentDownloads),
      steamCdnRouteStrategy: get('steamCdnRouteStrategy', state.steamCdnRouteStrategy),
      steamHttpProxyUrl: state.steamHttpProxyUrl || '',
      steamKitMaxDownloads: get('steamKitMaxDownloads', state.steamKitMaxDownloads),
      effectiveSteamKitMaxDownloads: get('effectiveSteamKitMaxDownloads', state.steamKitMaxDownloads),
      steamKitDepotStreaming: !!state.steamKitDepotStreaming,
      workshopHtmlOrderMode: !!state.workshopHtmlOrderMode,
      wallhubSteamAccessEnhance: !!state.wallhubSteamAccessEnhance,
      wallhubSteamAccessDirectWebApi: !!state.wallhubSteamAccessDirectWebApi,
      wallhubSteamWebApiRoute: get('steamWebApiRoute', state.wallhubSteamWebApiRoute || DEFAULT_CACHE_SETTINGS.wallhubSteamWebApiRoute),
      wallhubSteamWebApiProtocol: get('steamWebApiProtocol', state.wallhubSteamWebApiProtocol || DEFAULT_CACHE_SETTINGS.wallhubSteamWebApiProtocol),
      wallhubSteamWebApiHost: get('steamWebApiHost', state.wallhubSteamWebApiHost || DEFAULT_CACHE_SETTINGS.wallhubSteamWebApiHost),
      wallhubSteamAccessMode: state.wallhubSteamAccessMode || DEFAULT_CACHE_SETTINGS.wallhubSteamAccessMode,
      wallhubSteamAccessHosts: state.wallhubSteamAccessHosts || '',
      wallhubSteamAccessResolverProtocol: state.wallhubSteamAccessResolverProtocol || DEFAULT_CACHE_SETTINGS.wallhubSteamAccessResolverProtocol,
      wallhubSteamAccessSelectedDohEndpoints: Array.isArray(state.wallhubSteamAccessSelectedDohEndpoints) ? state.wallhubSteamAccessSelectedDohEndpoints : [],
      wallhubSteamAccessCustomDohEndpoints: Array.isArray(state.wallhubSteamAccessCustomDohEndpoints) ? state.wallhubSteamAccessCustomDohEndpoints : [],
      wallhubSteamAccessSelectedDotEndpoints: Array.isArray(state.wallhubSteamAccessSelectedDotEndpoints) ? state.wallhubSteamAccessSelectedDotEndpoints : [],
      wallhubSteamAccessCustomDotEndpoints: Array.isArray(state.wallhubSteamAccessCustomDotEndpoints) ? state.wallhubSteamAccessCustomDotEndpoints : [],
      wallhubSteamAccessHostsUrl: state.wallhubSteamAccessHostsUrl || '',
      wallhubSteamAccessHostsAutoUpdateEnabled: !!state.wallhubSteamAccessHostsAutoUpdateEnabled,
      wallhubSteamAccessHostsUpdateIntervalHours: state.wallhubSteamAccessHostsUpdateIntervalHours || DEFAULT_CACHE_SETTINGS.wallhubSteamAccessHostsUpdateIntervalHours,
      wallhubSteamAccessHostsLastUpdatedAt: state.wallhubSteamAccessHostsLastUpdatedAt || 0,
      wallhubSteamAccessHostsLastError: state.wallhubSteamAccessHostsLastError || '',
      wallhubSteamAccessDohEndpoint: state.wallhubSteamAccessDohEndpoint || DEFAULT_CACHE_SETTINGS.wallhubSteamAccessDohEndpoint,
      wallhubSteamAccessDohMode: state.wallhubSteamAccessDohMode || DEFAULT_CACHE_SETTINGS.wallhubSteamAccessDohMode,
      wallhubSteamAccessDotEndpoint: state.wallhubSteamAccessDotEndpoint || DEFAULT_CACHE_SETTINGS.wallhubSteamAccessDotEndpoint,
      wallhubSteamAccessDotMode: state.wallhubSteamAccessDotMode || DEFAULT_CACHE_SETTINGS.wallhubSteamAccessDotMode,
      wallhubSteamAccessExperimental: Object.assign({}, DEFAULT_CACHE_SETTINGS.wallhubSteamAccessExperimental, state.wallhubSteamAccessExperimental || {}),
      wallhubSteamAccessHostBlacklist: Array.isArray(state.wallhubSteamAccessHostBlacklist) ? state.wallhubSteamAccessHostBlacklist : [],
      wallhubSteamAccessStaticCdnEnhance: !!state.wallhubSteamAccessStaticCdnEnhance,
      wallhubSteamAccessStaticCdnHosts: Object.assign({}, DEFAULT_CACHE_SETTINGS.wallhubSteamAccessStaticCdnHosts, state.wallhubSteamAccessStaticCdnHosts || {}),
      depotStreamCacheMaxMb: get('depotStreamCacheMaxMb', state.depotStreamCacheMaxMb),
      nsfwEnabled: !!get('nsfwEnabled', false),
    }, extra);
  }

  return {
    get state() {
      return state;
    },
    setState,
    load,
    save,
    applyPatch,
    snapshot,
  };
}

module.exports = {
  createCacheSettingsStore,
};
