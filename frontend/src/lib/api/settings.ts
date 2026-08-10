import { parseJson } from './request';

export type SteamAccessStaticCdnHostControl = {
  enhance: boolean;
  reuseConnection: boolean;
};

export type CacheSettings = {
  steamApiKey?: string;
  steamDataSource?: 'community' | 'webapi' | 'cm';
  wallhubLogLevel?: 'info' | 'debug';
  wallhubAutoUpdateEnabled?: boolean;
  mpkgTextureProfile?: 'fast' | 'compact';
  mpkgCompactAvailable?: boolean;
  mpkgCompactUnavailableReason?: string;
  downloadDir?: string;
  maxConcurrentDownloads?: number;
  steamCdnRouteStrategy?: 'nearest' | 'direct' | 'proxy';
  steamHttpProxyUrl?: string;
  steamKitMaxDownloads?: number;
  effectiveSteamKitMaxDownloads?: number;
  steamKitDepotStreaming?: boolean;
  wallhubSteamAccessEnhance?: boolean;
  wallhubSteamAccessDirectWebApi?: boolean;
  wallhubSteamWebApiRoute?: 'direct' | 'follow';
  wallhubSteamWebApiProtocol?: 'https' | 'http';
  wallhubSteamWebApiHost?: 'api.steampowered.com' | 'community.steam-api.com';
  wallhubSteamAccessMode?: 'resolver' | 'hosts';
  wallhubSteamAccessHosts?: string;
  wallhubSteamAccessHostsDeferred?: boolean;
  wallhubSteamAccessResolverProtocol?: 'doh' | 'dot';
  wallhubSteamAccessSelectedDohEndpoints?: string[];
  wallhubSteamAccessCustomDohEndpoints?: string[];
  wallhubSteamAccessSelectedDotEndpoints?: string[];
  wallhubSteamAccessCustomDotEndpoints?: string[];
  wallhubSteamAccessHostsUrl?: string;
  wallhubSteamAccessHostsAutoUpdateEnabled?: boolean;
  wallhubSteamAccessHostsUpdateIntervalHours?: number;
  wallhubSteamAccessHostsLastUpdatedAt?: number;
  wallhubSteamAccessHostsLastError?: string;
  wallhubSteamAccessDohEndpoint?: string;
  wallhubSteamAccessDohMode?: 'fastest' | 'fixed';
  wallhubSteamAccessDotEndpoint?: string;
  wallhubSteamAccessDotMode?: 'fastest' | 'fixed';
  wallhubSteamAccessExperimental?: {
    hiddenSniForAll?: boolean;
    fakeSniFallback?: boolean;
    compressedProxy?: boolean;
    http2Enabled?: boolean;
    disableNormalFallback?: boolean;
    verboseNetworkLogs?: boolean;
  };
  wallhubSteamAccessHostBlacklist?: string[];
  wallhubSteamAccessStaticCdnEnhance?: boolean;
  wallhubSteamAccessStaticCdnHosts?: {
    imagesSteamusercontent?: SteamAccessStaticCdnHostControl;
    sharedAkamaiSteamstatic?: SteamAccessStaticCdnHostControl;
  };
  depotStreamCacheMaxMb?: number;
  nsfwEnabled?: boolean;
};

export async function getSettings() {
  const res = await fetch('/api/video/cache/settings');
  return parseJson<CacheSettings>(res);
}

export async function getSettingsDetails() {
  const res = await fetch('/api/video/cache/settings/details', { cache: 'no-store' });
  return parseJson<Pick<CacheSettings, 'wallhubSteamAccessHosts' | 'wallhubSteamAccessHostsDeferred'>>(res);
}

export async function saveSettings(settings: CacheSettings) {
  const res = await fetch('/api/video/cache/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return parseJson<CacheSettings & { success?: boolean }>(res);
}
