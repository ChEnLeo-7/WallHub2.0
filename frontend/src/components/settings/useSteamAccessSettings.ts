import * as React from 'react';
import type { RuntimeDiagnostics, RuntimeStatus } from '@/lib/api';
import { fetchSteamAccessHosts } from '@/lib/api';
import {
  normalizeSteamAccessDohEndpoint,
  normalizeSteamAccessDotEndpoint,
  normalizeSteamAccessEndpointList,
  normalizeSteamAccessHostsUrl,
  normalizeSteamAccessMode,
  normalizeSteamAccessResolverProtocol,
  validateSteamAccessEndpoint,
} from '@/lib/normalizers';
import type { AppText, Language } from '@/lib/text';
import { compactDohEndpoint, steamProxyUrl } from '@/lib/workshop';
import {
  DEFAULT_STEAM_ACCESS_DOH_ENDPOINT,
  DEFAULT_STEAM_ACCESS_DOT_ENDPOINT,
  STEAM_ACCESS_DOH_ENDPOINTS,
  STEAM_ACCESS_DOT_ENDPOINTS,
} from './constants';
import { countSteamAccessHosts } from './steamAccessUtils';
import type { SettingsForm, SettingsStateProps, SteamAccessStaticCdnHostControl } from './settingsTypes';

type UseSteamAccessSettingsProps = SettingsStateProps & {
  runtime: RuntimeStatus | null;
  runtimeDiagnostics: RuntimeDiagnostics | null;
  language: Language;
  text: AppText;
};

export function useSteamAccessSettings({
  runtime,
  runtimeDiagnostics,
  settings,
  setSettings,
  onSave,
  language,
  text,
}: UseSteamAccessSettingsProps) {
  const [steamProxyQuickUrl, setSteamProxyQuickUrl] = React.useState('');
  const [customResolverEndpoint, setCustomResolverEndpoint] = React.useState('');
  const [customSteamHostsUrl, setCustomSteamHostsUrl] = React.useState(settings.wallhubSteamAccessHostsUrl || '');
  const [hostsFetchBusy, setHostsFetchBusy] = React.useState(false);
  const [hostsEdited, setHostsEdited] = React.useState(false);
  const [resolverPickerOpen, setResolverPickerOpen] = React.useState(false);
  const runtimeSteamAccess = runtimeDiagnostics?.steamAccess || runtime?.steamAccess;
  const steamAccessCurrent = runtimeSteamAccess?.current || null;
  const resolverProtocol = normalizeSteamAccessResolverProtocol(settings.wallhubSteamAccessResolverProtocol);
  const resolverUiMode = normalizeSteamAccessMode(settings.wallhubSteamAccessMode || 'resolver');
  const selectedResolverEndpoints = resolverProtocol === 'dot'
    ? normalizeSteamAccessEndpointList(settings.wallhubSteamAccessSelectedDotEndpoints, 'dot')
    : normalizeSteamAccessEndpointList(settings.wallhubSteamAccessSelectedDohEndpoints, 'doh');
  const customResolverEndpoints = resolverProtocol === 'dot'
    ? normalizeSteamAccessEndpointList(settings.wallhubSteamAccessCustomDotEndpoints, 'dot', 32)
    : normalizeSteamAccessEndpointList(settings.wallhubSteamAccessCustomDohEndpoints, 'doh', 32);
  const currentResolverEndpoint = selectedResolverEndpoints[0] || (resolverProtocol === 'dot'
    ? normalizeSteamAccessDotEndpoint(settings.wallhubSteamAccessDotEndpoint, DEFAULT_STEAM_ACCESS_DOT_ENDPOINT)
    : normalizeSteamAccessDohEndpoint(settings.wallhubSteamAccessDohEndpoint, DEFAULT_STEAM_ACCESS_DOH_ENDPOINT));
  const hostsEntryCount = React.useMemo(() => countSteamAccessHosts(settings.wallhubSteamAccessHosts), [settings.wallhubSteamAccessHosts]);
  const hostsUrlReady = !!normalizeSteamAccessHostsUrl(customSteamHostsUrl);
  const resolverEndpoints = resolverProtocol === 'dot' ? STEAM_ACCESS_DOT_ENDPOINTS : STEAM_ACCESS_DOH_ENDPOINTS;
  const allResolverEndpointOptions = React.useMemo(
    () => Array.from(new Set([...customResolverEndpoints, ...resolverEndpoints])),
    [customResolverEndpoints, resolverEndpoints],
  );
  const steamAccessRuntimeResolver = steamAccessCurrent?.resolverEndpoint || steamAccessCurrent?.dohEndpoint || runtimeSteamAccess?.resolverEndpoint || runtimeSteamAccess?.dohEndpoint || '';
  const steamAccessRuntimeProtocol = String(steamAccessCurrent?.resolverProtocol || runtimeSteamAccess?.resolverProtocol || resolverProtocol).toLowerCase();
  const steamAccessRuntimeMode = normalizeSteamAccessMode(runtimeSteamAccess?.mode || settings.wallhubSteamAccessMode);
  const steamAccessResolverValue = steamAccessRuntimeMode === 'hosts' || steamAccessRuntimeProtocol === 'hosts'
    ? `HOSTS · ${Number(runtimeSteamAccess?.hosts?.entries || hostsEntryCount || 0)} ${language === 'en' ? 'entries' : '条映射'}${steamAccessCurrent?.ip ? ` -> ${steamAccessCurrent.ip}` : ''}`
    : steamAccessRuntimeResolver
      ? `${steamAccessRuntimeProtocol.toUpperCase()} · ${steamAccessRuntimeProtocol === 'dot'
        ? normalizeSteamAccessDotEndpoint(steamAccessRuntimeResolver, DEFAULT_STEAM_ACCESS_DOT_ENDPOINT)
        : compactDohEndpoint(steamAccessRuntimeResolver)}${steamAccessCurrent?.ip ? ` -> ${steamAccessCurrent.ip}` : ''}`
      : text.resolverWaiting;
  const webapiConnection = runtimeSteamAccess?.webapiPool?.connections?.[0] || null;
  const webapiConnectionValue = webapiConnection
    ? `${webapiConnection.ip || '-'} · ${webapiConnection.protocol || 'h1'} · sni=${webapiConnection.sniMode || 'hidden'} · reuse ${webapiConnection.reusedCount || 0}/${webapiConnection.requestCount || 0} · port ${webapiConnection.lastLocalPort || '-'} · age ${Math.floor(Number(webapiConnection.connectionAgeMs || 0) / 1000)}s${webapiConnection.lastError ? ` · ${text.webapiConnectionError}: ${webapiConnection.lastError}` : ''}`
    : text.webapiConnectionIdle;

  React.useEffect(() => {
    setCustomSteamHostsUrl(settings.wallhubSteamAccessHostsUrl || '');
  }, [settings.wallhubSteamAccessHostsUrl]);

  const openSteamProxyTarget = React.useCallback((url: string) => {
    const raw = url.trim();
    if (!raw) return;
    const target = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    window.open(steamProxyUrl(target), '_blank', 'noopener,noreferrer');
  }, []);

  const saveSteamAccessMode = React.useCallback((mode: 'resolver' | 'hosts') => {
    const patch: Partial<SettingsForm> = {
      wallhubSteamAccessEnhance: true,
      wallhubSteamAccessMode: mode,
      steamCdnRouteStrategy: 'nearest',
    };
    setSettings((current) => ({ ...current, ...patch }));
    onSave(patch);
  }, [onSave, setSettings]);

  const saveSteamHosts = React.useCallback(() => {
    const hosts = String(settings.wallhubSteamAccessHosts || '').trim();
    setHostsEdited(false);
    setSettings((current) => ({ ...current, wallhubSteamAccessHosts: hosts }));
    onSave({ wallhubSteamAccessHosts: hosts });
  }, [onSave, setSettings, settings.wallhubSteamAccessHosts]);

  const saveResolverEndpoint = React.useCallback((value: string) => {
    const endpoint = validateSteamAccessEndpoint(value, resolverProtocol);
    if (!endpoint) return;
    if (resolverProtocol === 'dot') {
      const custom = normalizeSteamAccessEndpointList([...settings.wallhubSteamAccessCustomDotEndpoints, endpoint], 'dot', 32);
      const selected = normalizeSteamAccessEndpointList([...settings.wallhubSteamAccessSelectedDotEndpoints, endpoint], 'dot');
      setSettings((current) => ({ ...current, wallhubSteamAccessCustomDotEndpoints: custom, wallhubSteamAccessSelectedDotEndpoints: selected, wallhubSteamAccessDotEndpoint: endpoint }));
      onSave({ wallhubSteamAccessCustomDotEndpoints: custom, wallhubSteamAccessSelectedDotEndpoints: selected, wallhubSteamAccessDotEndpoint: endpoint });
    } else {
      const custom = normalizeSteamAccessEndpointList([...settings.wallhubSteamAccessCustomDohEndpoints, endpoint], 'doh', 32);
      const selected = normalizeSteamAccessEndpointList([...settings.wallhubSteamAccessSelectedDohEndpoints, endpoint], 'doh');
      setSettings((current) => ({ ...current, wallhubSteamAccessCustomDohEndpoints: custom, wallhubSteamAccessSelectedDohEndpoints: selected, wallhubSteamAccessDohEndpoint: endpoint }));
      onSave({ wallhubSteamAccessCustomDohEndpoints: custom, wallhubSteamAccessSelectedDohEndpoints: selected, wallhubSteamAccessDohEndpoint: endpoint });
    }
    setCustomResolverEndpoint('');
  }, [onSave, resolverProtocol, setSettings, settings.wallhubSteamAccessCustomDohEndpoints, settings.wallhubSteamAccessCustomDotEndpoints, settings.wallhubSteamAccessSelectedDohEndpoints, settings.wallhubSteamAccessSelectedDotEndpoints]);

  const saveResolverProtocol = React.useCallback((protocol: 'doh' | 'dot') => {
    const selected = protocol === 'dot'
      ? normalizeSteamAccessEndpointList(settings.wallhubSteamAccessSelectedDotEndpoints, 'dot')
      : normalizeSteamAccessEndpointList(settings.wallhubSteamAccessSelectedDohEndpoints, 'doh');
    const currentEndpoint = protocol === 'dot'
      ? normalizeSteamAccessDotEndpoint(settings.wallhubSteamAccessDotEndpoint, DEFAULT_STEAM_ACCESS_DOT_ENDPOINT)
      : normalizeSteamAccessDohEndpoint(settings.wallhubSteamAccessDohEndpoint, DEFAULT_STEAM_ACCESS_DOH_ENDPOINT);
    const patch: Partial<SettingsForm> = { wallhubSteamAccessResolverProtocol: protocol };
    if (!selected.length) {
      if (protocol === 'dot') patch.wallhubSteamAccessDotEndpoint = currentEndpoint;
      else patch.wallhubSteamAccessDohEndpoint = currentEndpoint;
    }
    setSettings((current) => ({ ...current, ...patch }));
    onSave(patch);
  }, [onSave, setSettings, settings.wallhubSteamAccessDohEndpoint, settings.wallhubSteamAccessDotEndpoint, settings.wallhubSteamAccessSelectedDohEndpoints, settings.wallhubSteamAccessSelectedDotEndpoints]);

  const toggleResolverEndpoint = React.useCallback((endpoint: string) => {
    const normalized = validateSteamAccessEndpoint(endpoint, resolverProtocol);
    if (!normalized) return;
    if (resolverProtocol === 'dot') {
      const selected = settings.wallhubSteamAccessSelectedDotEndpoints.includes(normalized)
        ? settings.wallhubSteamAccessSelectedDotEndpoints.filter((item) => item !== normalized)
        : [...settings.wallhubSteamAccessSelectedDotEndpoints, normalized];
      setSettings((current) => ({ ...current, wallhubSteamAccessSelectedDotEndpoints: selected, wallhubSteamAccessDotEndpoint: normalized }));
      onSave({ wallhubSteamAccessSelectedDotEndpoints: selected, wallhubSteamAccessDotEndpoint: normalized });
    } else {
      const selected = settings.wallhubSteamAccessSelectedDohEndpoints.includes(normalized)
        ? settings.wallhubSteamAccessSelectedDohEndpoints.filter((item) => item !== normalized)
        : [...settings.wallhubSteamAccessSelectedDohEndpoints, normalized];
      setSettings((current) => ({ ...current, wallhubSteamAccessSelectedDohEndpoints: selected, wallhubSteamAccessDohEndpoint: normalized }));
      onSave({ wallhubSteamAccessSelectedDohEndpoints: selected, wallhubSteamAccessDohEndpoint: normalized });
    }
  }, [onSave, resolverProtocol, setSettings, settings.wallhubSteamAccessSelectedDohEndpoints, settings.wallhubSteamAccessSelectedDotEndpoints]);

  const removeCustomResolverEndpoint = React.useCallback((endpoint: string) => {
    const normalized = validateSteamAccessEndpoint(endpoint, resolverProtocol);
    if (!normalized) return;
    if (resolverProtocol === 'dot') {
      const custom = settings.wallhubSteamAccessCustomDotEndpoints.filter((item) => item !== normalized);
      const selected = settings.wallhubSteamAccessSelectedDotEndpoints.filter((item) => item !== normalized);
      setSettings((current) => ({ ...current, wallhubSteamAccessCustomDotEndpoints: custom, wallhubSteamAccessSelectedDotEndpoints: selected }));
      onSave({ wallhubSteamAccessCustomDotEndpoints: custom, wallhubSteamAccessSelectedDotEndpoints: selected });
    } else {
      const custom = settings.wallhubSteamAccessCustomDohEndpoints.filter((item) => item !== normalized);
      const selected = settings.wallhubSteamAccessSelectedDohEndpoints.filter((item) => item !== normalized);
      setSettings((current) => ({ ...current, wallhubSteamAccessCustomDohEndpoints: custom, wallhubSteamAccessSelectedDohEndpoints: selected }));
      onSave({ wallhubSteamAccessCustomDohEndpoints: custom, wallhubSteamAccessSelectedDohEndpoints: selected });
    }
  }, [onSave, resolverProtocol, setSettings, settings.wallhubSteamAccessCustomDohEndpoints, settings.wallhubSteamAccessCustomDotEndpoints, settings.wallhubSteamAccessSelectedDohEndpoints, settings.wallhubSteamAccessSelectedDotEndpoints]);

  const fetchHostsFromBackend = React.useCallback(async () => {
    const url = normalizeSteamAccessHostsUrl(customSteamHostsUrl);
    if (!url) return;
    setHostsFetchBusy(true);
    try {
      const result = await fetchSteamAccessHosts({ url, save: true });
      const lastUpdatedAt = result.lastUpdatedAt || Date.now();
      setHostsEdited(false);
      setSettings((current) => ({
        ...current,
        wallhubSteamAccessHosts: result.hosts || current.wallhubSteamAccessHosts,
        wallhubSteamAccessHostsUrl: url,
        wallhubSteamAccessHostsLastUpdatedAt: lastUpdatedAt,
        wallhubSteamAccessHostsLastError: '',
      }));
      onSave({ wallhubSteamAccessHosts: result.hosts, wallhubSteamAccessHostsUrl: url, wallhubSteamAccessHostsLastUpdatedAt: lastUpdatedAt, wallhubSteamAccessHostsLastError: '' });
      setCustomSteamHostsUrl(url);
    } finally {
      setHostsFetchBusy(false);
    }
  }, [customSteamHostsUrl, onSave, setSettings]);

  const saveStaticCdnHostControl = React.useCallback((
    key: keyof SettingsForm['wallhubSteamAccessStaticCdnHosts'],
    patch: Partial<SteamAccessStaticCdnHostControl>,
  ) => {
    const nextHosts = {
      ...settings.wallhubSteamAccessStaticCdnHosts,
      [key]: { ...settings.wallhubSteamAccessStaticCdnHosts[key], ...patch },
    };
    const staticCdnEnhance = Object.values(nextHosts).some((item) => item.enhance);
    setSettings((current) => ({ ...current, wallhubSteamAccessStaticCdnHosts: nextHosts, wallhubSteamAccessStaticCdnEnhance: staticCdnEnhance }));
    onSave({ wallhubSteamAccessStaticCdnHosts: nextHosts, wallhubSteamAccessStaticCdnEnhance: staticCdnEnhance });
  }, [onSave, setSettings, settings.wallhubSteamAccessStaticCdnHosts]);

  return {
    runtimeSteamAccess,
    steamAccessResolverValue,
    webapiConnectionValue,
    resolverProtocol,
    resolverUiMode,
    selectedResolverEndpoints,
    customResolverEndpoints,
    currentResolverEndpoint,
    allResolverEndpointOptions,
    hostsEntryCount,
    hostsUrlReady,
    hostsDirty: hostsEdited,
    hostsFetchBusy,
    resolverPickerOpen,
    setResolverPickerOpen,
    customResolverEndpoint,
    setCustomResolverEndpoint,
    customSteamHostsUrl,
    setCustomSteamHostsUrl,
    setHostsEdited,
    steamProxyQuickUrl,
    setSteamProxyQuickUrl,
    openSteamProxyTarget,
    saveSteamAccessMode,
    saveSteamHosts,
    saveResolverEndpoint,
    saveResolverProtocol,
    toggleResolverEndpoint,
    removeCustomResolverEndpoint,
    fetchHostsFromBackend,
    saveStaticCdnHostControl,
  };
}

export type SteamAccessSettingsController = ReturnType<typeof useSteamAccessSettings>;
