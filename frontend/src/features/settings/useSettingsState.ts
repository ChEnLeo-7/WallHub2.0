import * as React from 'react';
import type { SettingsForm } from '@/components/dialogs/SettingsDialog';
import { getSettings, getSettingsDetails, type CacheSettings } from '@/lib/api';
import {
  normalizeConcurrentDownloads,
  normalizeDepotStreamCacheMaxMb,
  normalizeSteamAccessDohEndpoint,
  normalizeSteamAccessDotEndpoint,
  normalizeSteamAccessEndpointList,
  normalizeSteamAccessHostsUpdateIntervalHours,
  normalizeSteamAccessHostsUrl,
  normalizeSteamAccessMode,
  normalizeSteamAccessResolverMode,
  normalizeSteamAccessResolverProtocol,
  normalizeSteamCdnRouteStrategy,
  normalizeSteamKitMaxDownloads,
} from '@/lib/normalizers';

export const DEFAULT_STEAM_ACCESS_DOH_ENDPOINT = 'https://1.12.12.12/resolve';
export const DEFAULT_STEAM_ACCESS_DOT_ENDPOINT = 'dot.pub:853';
const DEFAULT_STEAM_ACCESS_SELECTED_DOH_ENDPOINTS = [
  'https://1.12.12.12/resolve',
  'https://doh.pub/resolve',
  'https://dns.alidns.com/resolve',
];
const DEFAULT_STEAM_ACCESS_SELECTED_DOT_ENDPOINTS = [
  'dot.pub:853',
  'dns.umbrella.com:853',
  '1.1.1.1:853',
];
export function normalizeWallhubLogLevel(value: unknown): SettingsForm['wallhubLogLevel'] {
  return String(value || '').toLowerCase() === 'debug' ? 'debug' : 'info';
}

export function normalizeSteamDataSource(value: unknown): SettingsForm['steamDataSource'] {
  const source = String(value || '').trim().toLowerCase();
  return source === 'webapi' || source === 'cm' ? source : 'community';
}

export function normalizeStaticCdnHostControls(value: unknown): SettingsForm['wallhubSteamAccessStaticCdnHosts'] {
  const raw = value && typeof value === 'object' ? value as Partial<SettingsForm['wallhubSteamAccessStaticCdnHosts']> : {};
  return {
    imagesSteamusercontent: {
      enhance: !!raw.imagesSteamusercontent?.enhance,
      reuseConnection: raw.imagesSteamusercontent?.reuseConnection !== false,
    },
    sharedAkamaiSteamstatic: {
      enhance: !!raw.sharedAkamaiSteamstatic?.enhance,
      reuseConnection: raw.sharedAkamaiSteamstatic?.reuseConnection !== false,
    },
  };
}

function settingsFormFrom(data: CacheSettings): SettingsForm {
  return {
    steamApiKey: String(data.steamApiKey || ''),
    steamDataSource: normalizeSteamDataSource(data.steamDataSource),
    wallhubLogLevel: normalizeWallhubLogLevel(data.wallhubLogLevel),
    wallhubAutoUpdateEnabled: !!data.wallhubAutoUpdateEnabled,
    mpkgTextureProfile: data.mpkgCompactAvailable === true && data.mpkgTextureProfile === 'compact' ? 'compact' : 'fast',
    downloadDir: data.downloadDir || '',
    maxConcurrentDownloads: normalizeConcurrentDownloads(data.maxConcurrentDownloads),
    steamCdnRouteStrategy: normalizeSteamCdnRouteStrategy(data.steamCdnRouteStrategy),
    steamHttpProxyUrl: data.steamHttpProxyUrl || '',
    steamKitMaxDownloads: normalizeSteamKitMaxDownloads(data.steamKitMaxDownloads),
    effectiveSteamKitMaxDownloads: normalizeSteamKitMaxDownloads(data.effectiveSteamKitMaxDownloads),
    steamKitDepotStreaming: !!data.steamKitDepotStreaming,
    wallhubSteamAccessEnhance: !!data.wallhubSteamAccessEnhance,
    wallhubSteamAccessDirectWebApi: !!data.wallhubSteamAccessDirectWebApi,
    wallhubSteamWebApiRoute: data.wallhubSteamWebApiRoute || (data.wallhubSteamAccessDirectWebApi ? 'direct' : 'follow'),
    wallhubSteamWebApiProtocol: data.wallhubSteamWebApiProtocol || 'https',
    wallhubSteamWebApiHost: data.wallhubSteamWebApiHost || 'api.steampowered.com',
    wallhubSteamAccessMode: normalizeSteamAccessMode(data.wallhubSteamAccessMode),
    wallhubSteamAccessHosts: String(data.wallhubSteamAccessHosts || ''),
    wallhubSteamAccessResolverProtocol: normalizeSteamAccessResolverProtocol(data.wallhubSteamAccessResolverProtocol || (String(data.wallhubSteamAccessMode || '') === 'dot' ? 'dot' : 'doh')),
    wallhubSteamAccessSelectedDohEndpoints: normalizeSteamAccessEndpointList(data.wallhubSteamAccessSelectedDohEndpoints, 'doh'),
    wallhubSteamAccessCustomDohEndpoints: normalizeSteamAccessEndpointList(data.wallhubSteamAccessCustomDohEndpoints, 'doh', 32),
    wallhubSteamAccessSelectedDotEndpoints: normalizeSteamAccessEndpointList(data.wallhubSteamAccessSelectedDotEndpoints, 'dot'),
    wallhubSteamAccessCustomDotEndpoints: normalizeSteamAccessEndpointList(data.wallhubSteamAccessCustomDotEndpoints, 'dot', 32),
    wallhubSteamAccessHostsUrl: normalizeSteamAccessHostsUrl(data.wallhubSteamAccessHostsUrl),
    wallhubSteamAccessHostsAutoUpdateEnabled: !!data.wallhubSteamAccessHostsAutoUpdateEnabled,
    wallhubSteamAccessHostsUpdateIntervalHours: normalizeSteamAccessHostsUpdateIntervalHours(data.wallhubSteamAccessHostsUpdateIntervalHours),
    wallhubSteamAccessHostsLastUpdatedAt: Number(data.wallhubSteamAccessHostsLastUpdatedAt || 0),
    wallhubSteamAccessHostsLastError: String(data.wallhubSteamAccessHostsLastError || ''),
    wallhubSteamAccessDohEndpoint: normalizeSteamAccessDohEndpoint(data.wallhubSteamAccessDohEndpoint, DEFAULT_STEAM_ACCESS_DOH_ENDPOINT),
    wallhubSteamAccessDohMode: normalizeSteamAccessResolverMode(data.wallhubSteamAccessDohMode),
    wallhubSteamAccessDotEndpoint: normalizeSteamAccessDotEndpoint(data.wallhubSteamAccessDotEndpoint, DEFAULT_STEAM_ACCESS_DOT_ENDPOINT),
    wallhubSteamAccessDotMode: normalizeSteamAccessResolverMode(data.wallhubSteamAccessDotMode),
    wallhubSteamAccessExperimental: {
      hiddenSniForAll: !!data.wallhubSteamAccessExperimental?.hiddenSniForAll,
      fakeSniFallback: !!data.wallhubSteamAccessExperimental?.fakeSniFallback,
      compressedProxy: !!data.wallhubSteamAccessExperimental?.compressedProxy,
      http2Enabled: !!data.wallhubSteamAccessExperimental?.http2Enabled,
      disableNormalFallback: !!data.wallhubSteamAccessExperimental?.disableNormalFallback,
      verboseNetworkLogs: !!data.wallhubSteamAccessExperimental?.verboseNetworkLogs,
    },
    wallhubSteamAccessHostBlacklist: Array.isArray(data.wallhubSteamAccessHostBlacklist) ? data.wallhubSteamAccessHostBlacklist : [],
    wallhubSteamAccessStaticCdnEnhance: !!data.wallhubSteamAccessStaticCdnEnhance,
    wallhubSteamAccessStaticCdnHosts: normalizeStaticCdnHostControls(data.wallhubSteamAccessStaticCdnHosts),
    depotStreamCacheMaxMb: normalizeDepotStreamCacheMaxMb(data.depotStreamCacheMaxMb),
  };
}

function initialSettingsForm() {
  return {
    ...settingsFormFrom({}),
    wallhubSteamAccessSelectedDohEndpoints: DEFAULT_STEAM_ACCESS_SELECTED_DOH_ENDPOINTS,
    wallhubSteamAccessSelectedDotEndpoints: DEFAULT_STEAM_ACCESS_SELECTED_DOT_ENDPOINTS,
  };
}

export function useSettingsState() {
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsHostsLoaded, setSettingsHostsLoaded] = React.useState(false);
  const [mpkgCompactAvailable, setMpkgCompactAvailable] = React.useState(false);
  const [mpkgCompactUnavailableReason, setMpkgCompactUnavailableReason] = React.useState('');
  const [settingsForm, setSettingsForm] = React.useState<SettingsForm>(initialSettingsForm);
  const settingsHostsLoadedRef = React.useRef(false);
  const settingsHostsRequestRef = React.useRef<Promise<void> | null>(null);

  const setCompactAvailability = React.useCallback((data: CacheSettings) => {
    setMpkgCompactAvailable(data.mpkgCompactAvailable === true);
    setMpkgCompactUnavailableReason(String(data.mpkgCompactUnavailableReason || ''));
  }, []);

  const loadSettingsDetails = React.useCallback(() => {
    if (settingsHostsLoadedRef.current) return Promise.resolve();
    if (settingsHostsRequestRef.current) return settingsHostsRequestRef.current;
    const request = getSettingsDetails()
      .then((data) => {
        setSettingsForm((current) => ({
          ...current,
          wallhubSteamAccessHosts: String(data.wallhubSteamAccessHosts || ''),
        }));
        settingsHostsLoadedRef.current = true;
        setSettingsHostsLoaded(true);
      })
      .catch((error) => {
        console.warn('[settings-details]', error);
      })
      .finally(() => {
        if (settingsHostsRequestRef.current === request) settingsHostsRequestRef.current = null;
      });
    settingsHostsRequestRef.current = request;
    return request;
  }, []);

  React.useEffect(() => {
    getSettings()
      .then((data) => {
        settingsHostsLoadedRef.current = !data.wallhubSteamAccessHostsDeferred;
        setSettingsHostsLoaded(settingsHostsLoadedRef.current);
        setCompactAvailability(data);
        setSettingsForm(settingsFormFrom(data));
      })
      .catch((error) => {
        console.warn('[settings]', error);
      });
  }, [setCompactAvailability]);

  return {
    settingsOpen,
    setSettingsOpen,
    settingsHostsLoaded,
    settingsHostsLoadedRef,
    mpkgCompactAvailable,
    mpkgCompactUnavailableReason,
    settingsForm,
    setSettingsForm,
    setCompactAvailability,
    loadSettingsDetails,
  };
}
