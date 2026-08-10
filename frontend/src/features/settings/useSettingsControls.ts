import * as React from 'react';
import type { SettingsForm } from '@/components/dialogs/SettingsDialog';
import { clearDepotStreamCache, saveSettings, type CacheSettings } from '@/lib/api';
import type { AppText } from '@/lib/text';
import { formatBytesText } from '@/lib/utils';
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
import {
  DEFAULT_STEAM_ACCESS_DOH_ENDPOINT,
  DEFAULT_STEAM_ACCESS_DOT_ENDPOINT,
  normalizeStaticCdnHostControls,
  normalizeWallhubLogLevel,
} from './useSettingsState';

type Toast = (message: string, type?: 'info' | 'ok' | 'warn', timeoutMs?: number) => number;

type UseSettingsControlsOptions = {
  settingsForm: SettingsForm;
  setSettingsForm: React.Dispatch<React.SetStateAction<SettingsForm>>;
  settingsHostsLoadedRef: React.MutableRefObject<boolean>;
  setCompactAvailability: (data: CacheSettings) => void;
  text: AppText;
  toast: Toast;
  refreshRuntime: () => Promise<void>;
  clearWorkshopCache: () => void;
  markWorkshopForceRefresh: () => void;
  refreshWorkshop: () => void;
};

export function useSettingsControls({
  settingsForm,
  setSettingsForm,
  settingsHostsLoadedRef,
  setCompactAvailability,
  text,
  toast,
  refreshRuntime,
  clearWorkshopCache,
  markWorkshopForceRefresh,
  refreshWorkshop,
}: UseSettingsControlsOptions) {
  const saveSettingsForm = React.useCallback(async (patch?: Partial<SettingsForm>) => {
    try {
      const nextSettings = { ...settingsForm, ...(patch || {}) };
      const payload: Partial<SettingsForm> = patch ? { ...patch } : { ...nextSettings };
      if (!settingsHostsLoadedRef.current) delete payload.wallhubSteamAccessHosts;

      const data = await saveSettings(payload);
      const accessEnhance = !!(data.wallhubSteamAccessEnhance ?? nextSettings.wallhubSteamAccessEnhance);
      setCompactAvailability(data);
       const queryModeChanged = !!patch && (
         Object.prototype.hasOwnProperty.call(patch, 'steamApiKey') ||
         Object.prototype.hasOwnProperty.call(patch, 'steamDataSource')
       );
      setSettingsForm((current) => ({
        ...(patch ? (() => {
          const patched = { ...current };
          const response = data as unknown as Record<string, unknown>;
          for (const key of Object.keys(patch)) {
            (patched as unknown as Record<string, unknown>)[key] = response[key] ?? (patch as unknown as Record<string, unknown>)[key];
          }
          patched.effectiveSteamKitMaxDownloads = normalizeSteamKitMaxDownloads(data.effectiveSteamKitMaxDownloads ?? patched.effectiveSteamKitMaxDownloads);
          return patched;
        })() : current),
        ...(!patch ? {
          ...current,
          ...nextSettings,
           steamApiKey: String(data.steamApiKey ?? nextSettings.steamApiKey ?? current.steamApiKey),
           steamDataSource: data.steamDataSource ?? nextSettings.steamDataSource,
          wallhubLogLevel: normalizeWallhubLogLevel(data.wallhubLogLevel ?? nextSettings.wallhubLogLevel),
          wallhubAutoUpdateEnabled: !!(data.wallhubAutoUpdateEnabled ?? nextSettings.wallhubAutoUpdateEnabled),
          mpkgTextureProfile: data.mpkgCompactAvailable === true && data.mpkgTextureProfile === 'compact' ? 'compact' : 'fast',
          downloadDir: data.downloadDir || nextSettings.downloadDir || current.downloadDir,
          maxConcurrentDownloads: normalizeConcurrentDownloads(data.maxConcurrentDownloads ?? nextSettings.maxConcurrentDownloads),
          steamCdnRouteStrategy: normalizeSteamCdnRouteStrategy(data.steamCdnRouteStrategy ?? nextSettings.steamCdnRouteStrategy),
          steamHttpProxyUrl: data.steamHttpProxyUrl ?? nextSettings.steamHttpProxyUrl,
          steamKitMaxDownloads: normalizeSteamKitMaxDownloads(data.steamKitMaxDownloads ?? nextSettings.steamKitMaxDownloads),
          effectiveSteamKitMaxDownloads: normalizeSteamKitMaxDownloads(data.effectiveSteamKitMaxDownloads ?? nextSettings.effectiveSteamKitMaxDownloads),
          steamKitDepotStreaming: !!(data.steamKitDepotStreaming ?? nextSettings.steamKitDepotStreaming),
          wallhubSteamAccessEnhance: accessEnhance,
          wallhubSteamAccessDirectWebApi: !!(data.wallhubSteamAccessDirectWebApi ?? nextSettings.wallhubSteamAccessDirectWebApi),
          wallhubSteamWebApiRoute: (data.wallhubSteamWebApiRoute ?? nextSettings.wallhubSteamWebApiRoute) || (nextSettings.wallhubSteamAccessDirectWebApi ? 'direct' : 'follow'),
          wallhubSteamWebApiProtocol: data.wallhubSteamWebApiProtocol ?? nextSettings.wallhubSteamWebApiProtocol ?? 'https',
          wallhubSteamWebApiHost: data.wallhubSteamWebApiHost ?? nextSettings.wallhubSteamWebApiHost ?? 'api.steampowered.com',
          wallhubSteamAccessMode: normalizeSteamAccessMode(data.wallhubSteamAccessMode ?? nextSettings.wallhubSteamAccessMode),
          wallhubSteamAccessHosts: String(data.wallhubSteamAccessHosts ?? nextSettings.wallhubSteamAccessHosts ?? ''),
          wallhubSteamAccessResolverProtocol: normalizeSteamAccessResolverProtocol(data.wallhubSteamAccessResolverProtocol ?? nextSettings.wallhubSteamAccessResolverProtocol),
          wallhubSteamAccessSelectedDohEndpoints: normalizeSteamAccessEndpointList(data.wallhubSteamAccessSelectedDohEndpoints, 'doh'),
          wallhubSteamAccessCustomDohEndpoints: normalizeSteamAccessEndpointList(data.wallhubSteamAccessCustomDohEndpoints, 'doh', 32),
          wallhubSteamAccessSelectedDotEndpoints: normalizeSteamAccessEndpointList(data.wallhubSteamAccessSelectedDotEndpoints, 'dot'),
          wallhubSteamAccessCustomDotEndpoints: normalizeSteamAccessEndpointList(data.wallhubSteamAccessCustomDotEndpoints, 'dot', 32),
          wallhubSteamAccessHostsUrl: normalizeSteamAccessHostsUrl(data.wallhubSteamAccessHostsUrl ?? nextSettings.wallhubSteamAccessHostsUrl),
          wallhubSteamAccessHostsAutoUpdateEnabled: !!(data.wallhubSteamAccessHostsAutoUpdateEnabled ?? nextSettings.wallhubSteamAccessHostsAutoUpdateEnabled),
          wallhubSteamAccessHostsUpdateIntervalHours: normalizeSteamAccessHostsUpdateIntervalHours(data.wallhubSteamAccessHostsUpdateIntervalHours ?? nextSettings.wallhubSteamAccessHostsUpdateIntervalHours),
          wallhubSteamAccessHostsLastUpdatedAt: Number(data.wallhubSteamAccessHostsLastUpdatedAt ?? nextSettings.wallhubSteamAccessHostsLastUpdatedAt ?? 0),
          wallhubSteamAccessHostsLastError: String(data.wallhubSteamAccessHostsLastError ?? nextSettings.wallhubSteamAccessHostsLastError ?? ''),
          wallhubSteamAccessDohEndpoint: normalizeSteamAccessDohEndpoint(data.wallhubSteamAccessDohEndpoint ?? nextSettings.wallhubSteamAccessDohEndpoint, DEFAULT_STEAM_ACCESS_DOH_ENDPOINT),
          wallhubSteamAccessDohMode: normalizeSteamAccessResolverMode(data.wallhubSteamAccessDohMode ?? nextSettings.wallhubSteamAccessDohMode),
          wallhubSteamAccessDotEndpoint: normalizeSteamAccessDotEndpoint(data.wallhubSteamAccessDotEndpoint ?? nextSettings.wallhubSteamAccessDotEndpoint, DEFAULT_STEAM_ACCESS_DOT_ENDPOINT),
          wallhubSteamAccessDotMode: normalizeSteamAccessResolverMode(data.wallhubSteamAccessDotMode ?? nextSettings.wallhubSteamAccessDotMode),
          wallhubSteamAccessExperimental: {
            hiddenSniForAll: !!(data.wallhubSteamAccessExperimental?.hiddenSniForAll ?? nextSettings.wallhubSteamAccessExperimental.hiddenSniForAll),
            fakeSniFallback: !!(data.wallhubSteamAccessExperimental?.fakeSniFallback ?? nextSettings.wallhubSteamAccessExperimental.fakeSniFallback),
            compressedProxy: !!(data.wallhubSteamAccessExperimental?.compressedProxy ?? nextSettings.wallhubSteamAccessExperimental.compressedProxy),
            http2Enabled: !!(data.wallhubSteamAccessExperimental?.http2Enabled ?? nextSettings.wallhubSteamAccessExperimental.http2Enabled),
            disableNormalFallback: !!(data.wallhubSteamAccessExperimental?.disableNormalFallback ?? nextSettings.wallhubSteamAccessExperimental.disableNormalFallback),
            verboseNetworkLogs: !!(data.wallhubSteamAccessExperimental?.verboseNetworkLogs ?? nextSettings.wallhubSteamAccessExperimental.verboseNetworkLogs),
          },
          wallhubSteamAccessHostBlacklist: Array.isArray(data.wallhubSteamAccessHostBlacklist) ? data.wallhubSteamAccessHostBlacklist : nextSettings.wallhubSteamAccessHostBlacklist,
          wallhubSteamAccessStaticCdnEnhance: !!(data.wallhubSteamAccessStaticCdnEnhance ?? nextSettings.wallhubSteamAccessStaticCdnEnhance),
          wallhubSteamAccessStaticCdnHosts: normalizeStaticCdnHostControls(data.wallhubSteamAccessStaticCdnHosts ?? nextSettings.wallhubSteamAccessStaticCdnHosts),
          depotStreamCacheMaxMb: normalizeDepotStreamCacheMaxMb(data.depotStreamCacheMaxMb ?? nextSettings.depotStreamCacheMaxMb),
        } : {}),
      }));
      if (queryModeChanged) {
        clearWorkshopCache();
        markWorkshopForceRefresh();
        refreshWorkshop();
      }
      toast(text.settingsSaved, 'ok');
      await refreshRuntime();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'warn');
    }
  }, [clearWorkshopCache, markWorkshopForceRefresh, refreshRuntime, refreshWorkshop, setCompactAvailability, setSettingsForm, settingsForm, settingsHostsLoadedRef, text.settingsSaved, toast]);

  const clearDepotCache = React.useCallback(async () => {
    try {
      const result = await clearDepotStreamCache();
      const bytes = Number(result.bytes || 0);
      const suffix = bytes > 0 ? ` · ${formatBytesText(bytes, text)}` : '';
      toast(`${text.depotStreamCacheCleared}${suffix}`, 'ok');
      await refreshRuntime();
    } catch (error) {
      toast(error instanceof Error ? error.message : String(error), 'warn');
    }
  }, [refreshRuntime, text, toast]);

  return { saveSettingsForm, clearDepotCache };
}
