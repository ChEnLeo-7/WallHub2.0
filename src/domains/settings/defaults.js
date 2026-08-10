'use strict';

const {
  DEFAULT_STEAM_ACCESS_DOH_ENDPOINT,
  DEFAULT_STEAM_ACCESS_DOT_ENDPOINT,
  DEFAULT_STEAM_ACCESS_SELECTED_DOH_ENDPOINTS,
  DEFAULT_STEAM_ACCESS_SELECTED_DOT_ENDPOINTS,
} = require('../../config/normalizers');

const DEFAULT_STEAM_ACCESS_STATIC_CDN_HOSTS = Object.freeze({
  imagesSteamusercontent: Object.freeze({ enhance: false, reuseConnection: true }),
  sharedAkamaiSteamstatic: Object.freeze({ enhance: false, reuseConnection: true }),
});

const DEFAULT_CACHE_SETTINGS = {
  steamApiKey: '',
  steamDataSource: 'community',
  wallhubLogLevel: 'info',
  wallhubAutoUpdateEnabled: false,
  wallhubOnboardingCompletedAt: 0,
  mpkgTextureProfile: 'fast',
  downloadDir: '',
  maxConcurrentDownloads: 1,
  steamCdnRouteStrategy: 'nearest',
  steamHttpProxyUrl: '',
  steamKitMaxDownloads: 0,
  steamKitDepotStreaming: false,
  wallhubSteamAccessEnhance: false,
  wallhubSteamAccessDirectWebApi: false,
  wallhubSteamWebApiRoute: 'follow',
  wallhubSteamWebApiProtocol: 'https',
  wallhubSteamWebApiHost: 'api.steampowered.com',
  wallhubSteamAccessMode: 'resolver',
  wallhubSteamAccessHosts: '',
  wallhubSteamAccessResolverProtocol: 'doh',
  wallhubSteamAccessSelectedDohEndpoints: DEFAULT_STEAM_ACCESS_SELECTED_DOH_ENDPOINTS.slice(),
  wallhubSteamAccessCustomDohEndpoints: [],
  wallhubSteamAccessSelectedDotEndpoints: DEFAULT_STEAM_ACCESS_SELECTED_DOT_ENDPOINTS.slice(),
  wallhubSteamAccessCustomDotEndpoints: [],
  wallhubSteamAccessHostsUrl: '',
  wallhubSteamAccessHostsAutoUpdateEnabled: false,
  wallhubSteamAccessHostsUpdateIntervalHours: 24,
  wallhubSteamAccessHostsLastUpdatedAt: 0,
  wallhubSteamAccessHostsLastError: '',
  wallhubSteamAccessDohEndpoint: DEFAULT_STEAM_ACCESS_DOH_ENDPOINT,
  wallhubSteamAccessDohMode: 'fastest',
  wallhubSteamAccessDotEndpoint: DEFAULT_STEAM_ACCESS_DOT_ENDPOINT,
  wallhubSteamAccessDotMode: 'fastest',
  wallhubSteamAccessExperimental: {
    hiddenSniForAll: false,
    fakeSniFallback: false,
    compressedProxy: false,
    http2Enabled: false,
    disableNormalFallback: false,
    verboseNetworkLogs: false,
  },
  wallhubSteamAccessHostBlacklist: [],
  wallhubSteamAccessStaticCdnEnhance: false,
  wallhubSteamAccessStaticCdnHosts: {
    imagesSteamusercontent: { enhance: false, reuseConnection: true },
    sharedAkamaiSteamstatic: { enhance: false, reuseConnection: true },
  },
  depotStreamCacheMaxMb: 512,
};

module.exports = {
  DEFAULT_CACHE_SETTINGS,
  DEFAULT_STEAM_ACCESS_STATIC_CDN_HOSTS,
};
