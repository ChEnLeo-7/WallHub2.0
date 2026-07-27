import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  Check,
  ChevronsRight,
  Database,
  Download,
  ExternalLink,
  Film,
  Filter,
  FolderDown,
  Gauge,
  Grid3X3,
  Image as ImageIcon,
  Images,
  KeyRound,
  Languages,
  LayoutTemplate,
  Link2,
  LogOut,
  Monitor,
  Paintbrush,
  Palette,
  Play,
  Power,
  RefreshCw,
  Route,
  Server,
  Shield,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  SunMoon,
  Trash2,
  User,
  X,
  type LucideIcon,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select } from '@/components/ui/select';
import { AnimatedHeight } from '@/components/layout/AnimatedHeight';
import { useText, type AppText, type Language } from '@/lib/text';
import { cn } from '@/lib/utils';
import {
  accentThemeOptions,
  homeCardDefaultActionOptions,
  normalizeAccentTheme,
  normalizeConcurrentDownloads,
  normalizeCustomAccentColor,
  normalizeDepotStreamCacheMaxMb,
  normalizeDesktopColumns,
  normalizeHomeCardDefaultAction,
  normalizeHomePageSize,
  normalizeLanguage,
  normalizeMobileColumns,
  normalizeSteamAccessDohEndpoint,
  normalizeSteamAccessDotEndpoint,
  normalizeSteamAccessEndpointList,
  normalizeSteamAccessHostsUpdateIntervalHours,
  normalizeSteamAccessHostsUrl,
  normalizeSteamAccessMode,
  normalizeSteamAccessResolverProtocol,
  normalizeSteamKitMaxDownloads,
  normalizeThemeMode,
  validateSteamAccessEndpoint,
  themeModeOptions,
} from '@/lib/normalizers';
import {
  compactDohEndpoint,
  steamProxyUrl,
} from '@/lib/workshop';
import { type RuntimeDiagnostics, type RuntimeStatus, type SteamStatus, fetchSteamAccessHosts } from '@/lib/api';
import { isCompleteCustomAccentColor } from '../../../../src/shared/customAccentInput.mjs';
import type { VideoPlayerMode } from '@/hooks/usePreferences';

import {
  DEFAULT_STEAM_ACCESS_DOH_ENDPOINT,
  DEFAULT_STEAM_ACCESS_DOT_ENDPOINT,
  STEAM_ACCESS_DOH_ENDPOINTS,
  STEAM_ACCESS_DOT_ENDPOINTS,
  STEAM_API_KEY_URL,
  STEAM_PROXY_QUICK_LINKS,
} from '@/components/settings/constants';

export type SteamAccessStaticCdnHostControl = {
  enhance: boolean;
  reuseConnection: boolean;
};

export type SettingsForm = {
  steamApiKey: string;
  wallhubLogLevel: 'info' | 'debug';
  wallhubAutoUpdateEnabled: boolean;
  mpkgTextureProfile: 'fast' | 'compact';
  downloadDir: string;
  maxConcurrentDownloads: number;
  steamCdnRouteStrategy: 'nearest' | 'proxy';
  steamHttpProxyUrl: string;
  steamKitMaxDownloads: number;
  effectiveSteamKitMaxDownloads: number;
  steamKitDepotStreaming: boolean;
  wallhubSteamAccessEnhance: boolean;
  wallhubSteamAccessDirectWebApi: boolean;
  wallhubSteamWebApiRoute: 'direct' | 'follow';
  wallhubSteamWebApiProtocol: 'https' | 'http';
  wallhubSteamWebApiHost: 'api.steampowered.com' | 'community.steam-api.com';
  wallhubSteamAccessMode: 'resolver' | 'hosts';
  wallhubSteamAccessHosts: string;
  wallhubSteamAccessResolverProtocol: 'doh' | 'dot';
  wallhubSteamAccessSelectedDohEndpoints: string[];
  wallhubSteamAccessCustomDohEndpoints: string[];
  wallhubSteamAccessSelectedDotEndpoints: string[];
  wallhubSteamAccessCustomDotEndpoints: string[];
  wallhubSteamAccessHostsUrl: string;
  wallhubSteamAccessHostsAutoUpdateEnabled: boolean;
  wallhubSteamAccessHostsUpdateIntervalHours: number;
  wallhubSteamAccessHostsLastUpdatedAt: number;
  wallhubSteamAccessHostsLastError: string;
  wallhubSteamAccessDohEndpoint: string;
  wallhubSteamAccessDohMode: 'fastest' | 'fixed';
  wallhubSteamAccessDotEndpoint: string;
  wallhubSteamAccessDotMode: 'fastest' | 'fixed';
  wallhubSteamAccessExperimental: {
    hiddenSniForAll: boolean;
    fakeSniFallback: boolean;
    compressedProxy: boolean;
    http2Enabled: boolean;
    disableNormalFallback: boolean;
    verboseNetworkLogs: boolean;
  };
  wallhubSteamAccessHostBlacklist: string[];
  wallhubSteamAccessStaticCdnEnhance: boolean;
  wallhubSteamAccessStaticCdnHosts: {
    imagesSteamusercontent: SteamAccessStaticCdnHostControl;
    sharedAkamaiSteamstatic: SteamAccessStaticCdnHostControl;
  };
  depotStreamCacheMaxMb: number;
};

type ThemeMode = 'system' | 'light' | 'dark';
type AccentTheme = 'mono' | 'blue' | 'green' | 'rose' | 'violet' | 'custom';
type DetailsPresentation = 'classic' | 'redesigned';
type HomeCardDefaultAction = 'playVideo' | 'backgroundDownload' | 'clientDownload' | 'openSteamPage' | 'remoteSubscribe';

export function SettingsDialog({
  open,
  onOpenChange,
  fixedPanelHeight,
  runtime,
  runtimeDiagnostics,
  settings,
  settingsHostsLoaded,
  mpkgCompactAvailable,
  mpkgCompactUnavailableReason,
  setSettings,
  steam,
  language,
  setLanguage,
  themeMode,
  setThemeMode,
  accentTheme,
  customAccentColor,
  setCustomAccentColor,
  setAccentTheme,
  fixedPanelHeightEnabled,
  setFixedPanelHeight,
  detailsPresentation,
  setDetailsPresentation,
  homeCardDefaultAction,
  setHomeCardDefaultAction,
  homeFilterMultiSelect,
  setHomeFilterMultiSelect,
  mobileColumns,
  setMobileColumns,
  desktopColumns,
  setDesktopColumns,
  homePageSize,
  setHomePageSize,
  prefetchNextPage,
  setPrefetchNextPage,
  videoPlayerMode,
  setVideoPlayerMode,
  onSave,
  onClearDepotStreamCache,
  onLogin,
  onLogout,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onRestart,
  onShutdown,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fixedPanelHeight: boolean;
  runtime: RuntimeStatus | null;
  runtimeDiagnostics: RuntimeDiagnostics | null;
  settings: SettingsForm;
  settingsHostsLoaded: boolean;
  mpkgCompactAvailable: boolean;
  mpkgCompactUnavailableReason: string;
  setSettings: React.Dispatch<React.SetStateAction<SettingsForm>>;
  steam: SteamStatus | null;
  language: Language;
  setLanguage: (language: Language) => void;
  themeMode: ThemeMode;
  setThemeMode: (mode: ThemeMode) => void;
  accentTheme: AccentTheme;
  customAccentColor: string;
  setCustomAccentColor: (color: string) => void;
  setAccentTheme: (theme: AccentTheme) => void;
  fixedPanelHeightEnabled: boolean;
  setFixedPanelHeight: (enabled: boolean) => void;
  detailsPresentation: DetailsPresentation;
  setDetailsPresentation: (presentation: DetailsPresentation) => void;
  homeCardDefaultAction: HomeCardDefaultAction;
  setHomeCardDefaultAction: (action: HomeCardDefaultAction) => void;
  homeFilterMultiSelect: boolean;
  setHomeFilterMultiSelect: (enabled: boolean) => void;
  mobileColumns: number;
  setMobileColumns: (columns: number) => void;
  desktopColumns: number;
  setDesktopColumns: (columns: number) => void;
  homePageSize: number;
  setHomePageSize: (size: number) => void;
  prefetchNextPage: boolean;
  setPrefetchNextPage: (enabled: boolean) => void;
  videoPlayerMode: VideoPlayerMode;
  setVideoPlayerMode: (mode: VideoPlayerMode) => void;
  onSave: (patch?: Partial<SettingsForm>) => void;
  onClearDepotStreamCache: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  onRestart: () => void;
  onShutdown: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [tab, setTab] = React.useState<'server' | 'download' | 'steam' | 'appearance' | 'experimental'>('server');
  const [steamProxyQuickUrl, setSteamProxyQuickUrl] = React.useState('');
  const [customDohEndpoint, setCustomDohEndpoint] = React.useState('');
  const [customSteamHostsUrl, setCustomSteamHostsUrl] = React.useState(settings.wallhubSteamAccessHostsUrl || '');
  const [steamAccessResolverUiMode, setSteamAccessResolverUiMode] = React.useState<'resolver' | 'hosts'>(() => normalizeSteamAccessMode(settings.wallhubSteamAccessMode));
  const [hostsFetchBusy, setHostsFetchBusy] = React.useState(false);
  const [hostsEdited, setHostsEdited] = React.useState(false);
  const [dohPickerOpen, setDohPickerOpen] = React.useState(false);
  const [depotStreamCacheCustomMode, setDepotStreamCacheCustomMode] = React.useState(false);
  const [depotStreamCacheCustomInput, setDepotStreamCacheCustomInput] = React.useState('');
  const [customAccentColorDraft, setCustomAccentColorDraft] = React.useState(customAccentColor);
  const setup = runtime?.runtimeSetup;
  const update = runtime?.update;
  React.useEffect(() => {
    if (!open) setCustomAccentColorDraft(customAccentColor);
  }, [customAccentColor, open]);
  const text = useText();
  const updateBusy = ['checking', 'downloading', 'installing'].includes(String(update?.status || ''));
  const updateStatusLabel = (() => {
    switch (update?.status) {
      case 'checking': return text.updateStatusChecking;
      case 'up-to-date': return text.updateStatusCurrent;
      case 'available': return text.updateStatusAvailable;
      case 'unsupported': return text.updateStatusUnsupported;
      case 'downloading': return text.updateStatusDownloading;
      case 'downloaded': return text.updateStatusDownloaded;
      case 'installing': return text.updateStatusInstalling;
      case 'error': return text.updateStatusError;
      default: return text.updateStatusIdle;
    }
  })();
  const depotStreamCachePresetValues = [512, 1024, 2048, 3072, 4096, 5120, 6144, 7168, 8192];
  const depotStreamCacheIsPreset = depotStreamCachePresetValues.includes(settings.depotStreamCacheMaxMb);
  const depotStreamCacheSelectValue = depotStreamCacheCustomMode || !depotStreamCacheIsPreset ? 'custom' : String(settings.depotStreamCacheMaxMb);
  const runtimeSteamAccess = runtimeDiagnostics?.steamAccess || runtime?.steamAccess;
  const steamAccessCurrent = runtimeSteamAccess?.current || null;
  const resolverProtocol = normalizeSteamAccessResolverProtocol(settings.wallhubSteamAccessResolverProtocol);
  const steamAccessMode = normalizeSteamAccessMode(settings.wallhubSteamAccessMode || 'resolver');
  const resolverUiMode = steamAccessMode;
  const showSteamAccessManualSettings = resolverUiMode === 'resolver' && !!settings.wallhubSteamAccessEnhance;
  const showSteamAccessHostsSettings = resolverUiMode === 'hosts' && !!settings.wallhubSteamAccessEnhance;
  const selectedResolverEndpoints = resolverProtocol === 'dot'
    ? normalizeSteamAccessEndpointList(settings.wallhubSteamAccessSelectedDotEndpoints, 'dot')
    : normalizeSteamAccessEndpointList(settings.wallhubSteamAccessSelectedDohEndpoints, 'doh');
  const customResolverEndpoints = resolverProtocol === 'dot'
    ? normalizeSteamAccessEndpointList(settings.wallhubSteamAccessCustomDotEndpoints, 'dot', 32)
    : normalizeSteamAccessEndpointList(settings.wallhubSteamAccessCustomDohEndpoints, 'doh', 32);
  const currentResolverEndpoint = selectedResolverEndpoints[0] || (resolverProtocol === 'dot'
    ? normalizeSteamAccessDotEndpoint(settings.wallhubSteamAccessDotEndpoint, DEFAULT_STEAM_ACCESS_DOT_ENDPOINT)
    : normalizeSteamAccessDohEndpoint(settings.wallhubSteamAccessDohEndpoint, DEFAULT_STEAM_ACCESS_DOH_ENDPOINT));
  const hostsEntryCount = React.useMemo(() => String(settings.wallhubSteamAccessHosts || '')
    .split(/\r?\n/)
    .reduce((count, rawLine) => {
      const line = rawLine.trim();
      if (!line || line.startsWith('#') || line.startsWith(';')) return count;
      const body = line.split(/\s+#|\s+;/, 1)[0].trim();
      const parts = body.split(/\s+/).filter(Boolean);
      return parts.length >= 2 ? count + parts.length - 1 : count;
    }, 0), [settings.wallhubSteamAccessHosts]);
  const normalizedSteamHostsUrl = normalizeSteamAccessHostsUrl(customSteamHostsUrl);
  const hostsUrlReady = !!normalizedSteamHostsUrl;
  const hostsDirty = hostsEdited;
  const resolverEndpoints = resolverProtocol === 'dot' ? STEAM_ACCESS_DOT_ENDPOINTS : STEAM_ACCESS_DOH_ENDPOINTS;
  const allResolverEndpointOptions = React.useMemo(() => Array.from(new Set([...customResolverEndpoints, ...resolverEndpoints])), [customResolverEndpoints, resolverEndpoints]);
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
  const experimentalNavItem = { id: 'experimental' as const, label: text.navExperimental, icon: Shield };
  const navItems = [
    { id: 'server' as const, label: text.navServer, icon: Server },
    { id: 'download' as const, label: text.navDownload, icon: Download },
    { id: 'steam' as const, label: text.navSteam, icon: User },
    { id: 'appearance' as const, label: text.navAppearance, icon: Palette },
  ];
  const visibleNavItems = [...navItems, experimentalNavItem];
  const openSteamProxyTarget = React.useCallback((url: string) => {
    const raw = url.trim();
    if (!raw) return;
    const target = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`;
    window.open(steamProxyUrl(target), '_blank', 'noopener,noreferrer');
  }, []);
  const openSteamProxyQuickUrl = React.useCallback(() => {
    openSteamProxyTarget(steamProxyQuickUrl);
  }, [openSteamProxyTarget, steamProxyQuickUrl]);
  const saveSteamAccessMode = React.useCallback((mode: 'resolver' | 'hosts') => {
    setSteamAccessResolverUiMode(mode);
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
    setCustomDohEndpoint('');
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
        ? settings.wallhubSteamAccessSelectedDotEndpoints.filter(item => item !== normalized)
        : [...settings.wallhubSteamAccessSelectedDotEndpoints, normalized];
      setSettings((current) => ({ ...current, wallhubSteamAccessSelectedDotEndpoints: selected, wallhubSteamAccessDotEndpoint: normalized }));
      onSave({ wallhubSteamAccessSelectedDotEndpoints: selected, wallhubSteamAccessDotEndpoint: normalized });
    } else {
      const selected = settings.wallhubSteamAccessSelectedDohEndpoints.includes(normalized)
        ? settings.wallhubSteamAccessSelectedDohEndpoints.filter(item => item !== normalized)
        : [...settings.wallhubSteamAccessSelectedDohEndpoints, normalized];
      setSettings((current) => ({ ...current, wallhubSteamAccessSelectedDohEndpoints: selected, wallhubSteamAccessDohEndpoint: normalized }));
      onSave({ wallhubSteamAccessSelectedDohEndpoints: selected, wallhubSteamAccessDohEndpoint: normalized });
    }
  }, [onSave, resolverProtocol, setSettings, settings.wallhubSteamAccessSelectedDohEndpoints, settings.wallhubSteamAccessSelectedDotEndpoints]);
  const removeCustomResolverEndpoint = React.useCallback((endpoint: string) => {
    const normalized = validateSteamAccessEndpoint(endpoint, resolverProtocol);
    if (!normalized) return;
    if (resolverProtocol === 'dot') {
      const custom = settings.wallhubSteamAccessCustomDotEndpoints.filter(item => item !== normalized);
      const selected = settings.wallhubSteamAccessSelectedDotEndpoints.filter(item => item !== normalized);
      setSettings((current) => ({ ...current, wallhubSteamAccessCustomDotEndpoints: custom, wallhubSteamAccessSelectedDotEndpoints: selected }));
      onSave({ wallhubSteamAccessCustomDotEndpoints: custom, wallhubSteamAccessSelectedDotEndpoints: selected });
    } else {
      const custom = settings.wallhubSteamAccessCustomDohEndpoints.filter(item => item !== normalized);
      const selected = settings.wallhubSteamAccessSelectedDohEndpoints.filter(item => item !== normalized);
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
      setHostsEdited(false);
      setSettings((current) => ({
        ...current,
        wallhubSteamAccessHosts: result.hosts || current.wallhubSteamAccessHosts,
        wallhubSteamAccessHostsUrl: url,
        wallhubSteamAccessHostsLastUpdatedAt: result.lastUpdatedAt || Date.now(),
        wallhubSteamAccessHostsLastError: '',
      }));
      onSave({
        wallhubSteamAccessHosts: result.hosts,
        wallhubSteamAccessHostsUrl: url,
        wallhubSteamAccessHostsLastUpdatedAt: result.lastUpdatedAt || Date.now(),
        wallhubSteamAccessHostsLastError: '',
      });
      setCustomSteamHostsUrl(url);
    } finally {
      setHostsFetchBusy(false);
    }
  }, [customSteamHostsUrl, onSave, setSettings]);
  React.useEffect(() => {
    if (settings.wallhubSteamAccessMode && settings.wallhubSteamAccessMode !== steamAccessResolverUiMode) {
      setSteamAccessResolverUiMode(normalizeSteamAccessMode(settings.wallhubSteamAccessMode));
    }
  }, [settings.wallhubSteamAccessMode, steamAccessResolverUiMode]);
  React.useEffect(() => {
    setCustomSteamHostsUrl(settings.wallhubSteamAccessHostsUrl || '');
  }, [settings.wallhubSteamAccessHostsUrl]);
  React.useEffect(() => {
    if (!depotStreamCacheCustomMode) setDepotStreamCacheCustomInput(String(settings.depotStreamCacheMaxMb || 512));
  }, [depotStreamCacheCustomMode, settings.depotStreamCacheMaxMb]);
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

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange} title={text.settings} wide bare fixedHeight={fixedPanelHeight} className="max-w-[calc(100vw-1rem)] overflow-hidden border border-border bg-popover/95 p-0 text-popover-foreground shadow-panel backdrop-blur sm:max-w-6xl">
      <motion.div
        className={cn(
          'flex w-full max-w-full min-w-0 touch-auto flex-col overflow-hidden bg-transparent shadow-none',
          fixedPanelHeight ? 'h-full' : 'max-h-[calc(100dvh-1rem)] sm:max-h-[92vh]',
        )}
      >
        <header className="flex items-center justify-between border-b border-border/50 px-5 py-4">
          <h2 className="text-base font-semibold tracking-tight">{text.settings}</h2>
          <Button variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} aria-label={text.close}>
            <X className="h-4 w-4" />
          </Button>
        </header>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden md:grid md:grid-cols-[180px_1fr]">
          <aside className="shrink-0 border-b border-border/50 bg-card p-2 md:border-b-0 md:border-r md:p-3">
            <nav className="hide-scrollbar flex max-w-full touch-pan-x gap-1 overflow-x-auto md:block md:space-y-1 md:overflow-visible">
              {visibleNavItems.map((item) => {
                const Icon = item.icon;
                const active = tab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setTab(item.id)}
                    className={cn(
                      'flex shrink-0 items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-[background-color,color,filter,transform] active:scale-95 active:brightness-110 md:w-full',
                      active ? 'bg-accent text-accent-foreground' : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
                    )}
                  >
                    <Icon className="h-4 w-4" />
                    {item.label}
                  </button>
                );
              })}
            </nav>
          </aside>

          <ScrollArea className="min-h-0 min-w-0 flex-1 overscroll-contain overflow-x-hidden pb-[calc(env(safe-area-inset-bottom)_+_5rem)] sm:pb-0">
            <AnimatedHeight>
              <AnimatePresence initial={false} mode="wait">
                {tab === 'server' ? (
            <motion.div
              key="settings-server"
              layout
              className="space-y-6 p-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1], layout: { type: 'spring', stiffness: 330, damping: 34, mass: 0.9 } }}
            >
              <section>
                <h3 className="text-base font-semibold">{text.navServer}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{text.serverIntro}</p>
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <InfoRow label={text.runMode} value={(runtime?.effectiveDownloader || '-').toUpperCase()} stackOnMobile />
                <InfoRow label={text.runStatus} value={<RuntimeStatusValue value={setup?.message || setup?.status || '-'} />} stackOnMobile />
                <InfoRow label={text.contentMode} value={runtime?.nsfwEnabled ? 'NSFW' : text.safeMode} stackOnMobile />
                <InfoRow
                  label={text.currentCdnNode}
                  value={runtime?.steamCdn?.currentHost || text.cdnWaiting}
                  stackOnMobile
                />
                {runtimeSteamAccess?.enabled ? (
                  <>
                    <InfoRow
                      label={text.currentResolverServer}
                      value={steamAccessResolverValue}
                      stackOnMobile
                    />
                    {runtimeSteamAccess?.webapiPool ? (
                      <InfoRow
                        label={text.webapiConnectionStatus}
                        value={webapiConnectionValue}
                        stackOnMobile
                      />
                    ) : null}
                    {runtimeSteamAccess?.webapiPool ? (
                      <InfoRow
                        label="WebAPI IP"
                        value={`active ${runtimeSteamAccess.webapiPool.active || 0} · cooling ${runtimeSteamAccess.webapiPool.cooling || 0} · fastest ${runtimeSteamAccess.webapiPool.fastest || '-'} · ${runtimeSteamAccess.webapiPool.rttMs || 0} ms`}
                        stackOnMobile
                      />
                    ) : null}
                  </>
                ) : null}
                {setup?.status && setup.status !== 'ready' ? <Progress value={Number(setup?.progress || 0)} /> : null}
                <div className="break-all text-xs text-muted-foreground">{text.runnerDir}: {runtime?.runnerDir || setup?.runnerDir || '-'}</div>
                <div className="break-all text-xs text-muted-foreground">{text.downloadsDir}: {runtime?.downloadsDir || setup?.downloadsDir || '-'}</div>
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <Download className="h-4 w-4" />
                  {text.appUpdate}
                </h4>
                <InfoRow label={text.currentVersion} value={`v${update?.currentVersion || runtime?.version || '-'}`} />
                <InfoRow label={text.latestVersion} value={update?.latestVersion ? `v${update.latestVersion}` : '-'} />
                <InfoRow label={text.updateStatus} value={updateStatusLabel} />
                {updateBusy ? (
                  <Progress value={Number(update?.progress || 0)} indeterminate={update?.status === 'checking'} />
                ) : null}
                {update?.status === 'downloading' && Number(update.totalBytes || 0) > 0 ? (
                  <p className="text-xs text-muted-foreground">
                    {Math.min(100, Math.max(0, Number(update.progress || 0)))}% · {update.assetName || ''}
                  </p>
                ) : null}
                {update?.error ? (
                  <p className="text-sm text-destructive" role="status">
                    {text.updateStatusError}{update.errorCode ? ` (${update.errorCode})` : ''}
                  </p>
                ) : null}
                {runtime?.docker ? (
                  <p className="text-sm text-muted-foreground">
                    {update?.dockerAutoUpdate ? text.dockerUpdateManaged : text.dockerUpdateManual}
                  </p>
                ) : null}
                <div className="flex flex-wrap justify-end gap-2">
                  {update?.releaseUrl ? (
                    <Button variant="outline" onClick={() => window.open(update.releaseUrl, '_blank', 'noopener,noreferrer')}>
                      <ExternalLink className="h-4 w-4" />
                      {text.viewRelease}
                    </Button>
                  ) : null}
                  <Button variant="outline" disabled={updateBusy} onClick={onCheckUpdate}>
                    <RefreshCw className={cn('h-4 w-4', update?.status === 'checking' && 'animate-spin')} />
                    {text.checkUpdate}
                  </Button>
                  {runtime && !runtime.docker && update?.updateAvailable && update?.canDownload ? (
                    <Button disabled={updateBusy} onClick={onDownloadUpdate}>
                      <Download className="h-4 w-4" />
                      {text.downloadUpdate}
                    </Button>
                  ) : null}
                  {runtime && !runtime.docker && update?.canInstall ? (
                    <Button disabled={updateBusy} onClick={onInstallUpdate}>
                      <ChevronsRight className="h-4 w-4" />
                      {text.installUpdate}
                    </Button>
                  ) : null}
                </div>
              </section>

              {runtime && !runtime.docker ? (
                <ExperimentalToggle
                  icon={RefreshCw}
                  title={text.autoUpdate}
                  description={text.autoUpdateDesc}
                  enabled={settings.wallhubAutoUpdateEnabled}
                  onChange={(enabled) => {
                    setSettings((current) => ({ ...current, wallhubAutoUpdateEnabled: enabled }));
                    onSave({ wallhubAutoUpdateEnabled: enabled });
                  }}
                />
              ) : null}

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="text-sm font-semibold">{text.serverControl}</h4>
                <div className="flex flex-wrap justify-end gap-2">
                  <Button className="w-full sm:w-36" variant="outline" onClick={onRestart}>
                    <RefreshCw className="h-4 w-4" />
                    {text.restartServer}
                  </Button>
                  {runtime?.canShutdown !== false ? (
                    <Button className="w-full sm:w-36" variant="destructive" onClick={onShutdown}>
                      <Power className="h-4 w-4" />
                      {text.shutdownServer}
                    </Button>
                  ) : null}
                </div>
              </section>
            </motion.div>
                ) : tab === 'download' ? (
            <motion.div
              key="settings-download"
              layout
              className="space-y-6 p-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1], layout: { type: 'spring', stiffness: 330, damping: 34, mass: 0.9 } }}
            >
              <section>
                <h3 className="text-base font-semibold">{text.navDownload}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{text.downloadIntro}</p>
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <FolderDown className="h-4 w-4" />
                  {text.downloadDir}
                </h4>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    className="min-w-0 flex-1"
                    value={settings.downloadDir}
                    onChange={(event) => setSettings((current) => ({ ...current, downloadDir: event.target.value }))}
                    placeholder="Downloads"
                  />
                  <Button className="w-full sm:w-32" onClick={() => onSave()}>{text.saveDir}</Button>
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <ImageIcon className="h-4 w-4" />
                  {text.mpkgTextureProfile}
                </h4>
                <p className="text-sm text-muted-foreground">{text.mpkgTextureProfileDesc}</p>
                {!mpkgCompactAvailable ? (
                  <p className="text-sm text-destructive" role="status">
                    {mpkgCompactUnavailableReason || text.mpkgTextureProfileCompactUnavailable}
                  </p>
                ) : null}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(['fast', 'compact'] as const).map((profile) => {
                    const compactUnavailable = profile === 'compact' && !mpkgCompactAvailable;
                    return (
                      <Button
                        key={profile}
                        variant={settings.mpkgTextureProfile === profile ? 'default' : 'outline'}
                        disabled={compactUnavailable}
                        title={compactUnavailable ? (mpkgCompactUnavailableReason || text.mpkgTextureProfileCompactUnavailable) : undefined}
                        onClick={() => {
                          setSettings((current) => ({ ...current, mpkgTextureProfile: profile }));
                          onSave({ mpkgTextureProfile: profile });
                        }}
                      >
                        {profile === 'fast' ? text.mpkgTextureProfileFast : text.mpkgTextureProfileCompact}
                      </Button>
                    );
                  })}
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
                  <span className="inline-flex items-center gap-2"><Gauge className="h-4 w-4" />{text.maxConcurrentDownloads}</span>
                  <Badge className="border border-border bg-background px-3 py-1 text-foreground shadow-sm" variant="outline">
                    {text.current} {settings.maxConcurrentDownloads} {text.itemUnit}
                  </Badge>
                </h4>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select
                    className="min-w-0 flex-1"
                    value={String(settings.maxConcurrentDownloads)}
                    onChange={(value) => {
                      const next = normalizeConcurrentDownloads(value);
                      setSettings((current) => ({ ...current, maxConcurrentDownloads: next }));
                      onSave({ maxConcurrentDownloads: next });
                    }}
                    options={[
                      { value: '1', label: `1 ${text.itemUnit}（${text.defaultMark}）` },
                      { value: '2', label: `2 ${text.itemUnit}` },
                      { value: '3', label: `3 ${text.itemUnit}` },
                      { value: '4', label: `4 ${text.itemUnit}` },
                    ]}
                  />

                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
                  <span className="inline-flex items-center gap-2"><Route className="h-4 w-4" />{text.steamCdnRoute}</span>
                  <Badge className="border border-border bg-background px-3 py-1 text-foreground shadow-sm" variant="outline">
                    {settings.steamHttpProxyUrl ? text.steamCdnProxyShort : text.steamCdnDefaultShort}
                  </Badge>
                </h4>
                <p className="text-sm text-muted-foreground">
                  {text.steamCdnRouteDesc}
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    className="min-w-0 flex-1"
                    value={settings.steamHttpProxyUrl}
                    onChange={(event) => {
                      const nextUrl = event.target.value;
                      setSettings((current) => ({ ...current, steamHttpProxyUrl: nextUrl, steamCdnRouteStrategy: nextUrl.trim() ? 'proxy' : 'nearest' }));
                    }}
                    placeholder={text.steamHttpProxyPlaceholder}
                  />
                  <Button
                    className="w-full sm:w-32"
                    onClick={() => onSave({
                      steamHttpProxyUrl: settings.steamHttpProxyUrl,
                      steamCdnRouteStrategy: settings.steamHttpProxyUrl.trim() ? 'proxy' : 'nearest',
                    })}
                  >
                    {text.saveCdnRoute}
                  </Button>
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
                  <span className="inline-flex items-center gap-2"><Download className="h-4 w-4" />{text.steamKitMaxDownloads}</span>
                  <Badge className="border border-border bg-background px-3 py-1 text-foreground shadow-sm" variant="outline">
                    {text.effectiveValue} {settings.effectiveSteamKitMaxDownloads || settings.steamKitMaxDownloads || 'Auto'}
                  </Badge>
                </h4>
                <p className="text-sm text-muted-foreground">{text.steamKitMaxDownloadsDesc}</p>
                <Select
                  value={String(settings.steamKitMaxDownloads || 0)}
                  onChange={(value) => {
                    const next = normalizeSteamKitMaxDownloads(value);
                    setSettings((current) => ({ ...current, steamKitMaxDownloads: next }));
                    onSave({ steamKitMaxDownloads: next });
                  }}
                  options={[
                    { value: '0', label: `Auto（${text.defaultMark}）` },
                    { value: '8', label: '8' },
                    { value: '12', label: '12' },
                    { value: '16', label: '16' },
                    { value: '24', label: '24' },
                    { value: '32', label: '32' },
                  ]}
                />
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
                  <span className="inline-flex items-center gap-2"><Database className="h-4 w-4" />{text.depotStreamCacheMax}</span>
                  <Badge className="border border-border bg-background px-3 py-1 text-foreground shadow-sm" variant="outline">
                    {text.current} {settings.depotStreamCacheMaxMb} MB
                  </Badge>
                </h4>
                <p className="text-sm text-muted-foreground">{text.depotStreamCacheMaxDesc}</p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select
                    className="min-w-0 flex-1"
                    value={depotStreamCacheSelectValue}
                    onChange={(value) => {
                      if (value === 'custom') {
                        setDepotStreamCacheCustomMode(true);
                        setDepotStreamCacheCustomInput(String(settings.depotStreamCacheMaxMb || 512));
                        return;
                      }
                      const next = normalizeDepotStreamCacheMaxMb(value);
                      setDepotStreamCacheCustomMode(false);
                      setSettings((current) => ({ ...current, depotStreamCacheMaxMb: next }));
                      onSave({ depotStreamCacheMaxMb: next });
                    }}
                    options={[
                      { value: '512', label: `512 MB（${text.defaultMark}）` },
                      { value: '1024', label: '1 GB' },
                      { value: '2048', label: '2 GB' },
                      { value: '3072', label: '3 GB' },
                      { value: '4096', label: '4 GB' },
                      { value: '5120', label: '5 GB' },
                      { value: '6144', label: '6 GB' },
                      { value: '7168', label: '7 GB' },
                      { value: '8192', label: '8 GB' },
                      { value: 'custom', label: text.depotStreamCacheCustom },
                    ]}
                  />
                  {depotStreamCacheSelectValue === 'custom' ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <Input
                        className="min-w-0 flex-1"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={depotStreamCacheCustomInput}
                        onChange={(event) => {
                          const raw = event.target.value.replace(/[^\d]/g, '');
                          setDepotStreamCacheCustomInput(raw);
                          const next = normalizeDepotStreamCacheMaxMb(raw);
                          setSettings((current) => ({ ...current, depotStreamCacheMaxMb: next }));
                          onSave({ depotStreamCacheMaxMb: next });
                        }}
                        placeholder={text.depotStreamCacheCustomPlaceholder}
                      />
                      <span className="shrink-0 text-sm font-medium text-muted-foreground">MB</span>
                    </div>
                  ) : null}
                  <Button className="w-full sm:w-36" variant="outline" onClick={onClearDepotStreamCache}>
                    <Trash2 className="h-4 w-4" />
                    {text.clearDepotStreamCache}
                  </Button>
                </div>
              </section>
            </motion.div>
                ) : tab === 'steam' ? (
            <motion.div
              key="settings-steam"
              layout
              className="space-y-6 p-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1], layout: { type: 'spring', stiffness: 330, damping: 34, mass: 0.9 } }}
            >
              <section>
                <h3 className="text-base font-semibold">{text.navSteam}</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  {steam?.loggedIn ? text.steamIntro : text.steamNotLoggedInDownloadHint}
                </p>
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <User className="h-4 w-4" />
                  {text.accountStatus}
                </h4>
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="text-muted-foreground">{steam?.loggedIn ? text.loggedInAs : text.steamUser}</span>
                  {steam?.loggedIn ? (
                    <strong className="min-w-0 break-all text-foreground">{steam.username || text.unknown}</strong>
                  ) : (
                    <span className="min-w-0 break-all text-muted-foreground">无</span>
                  )}
                </div>
                <div className="flex flex-wrap justify-end gap-2">
                  {steam?.loggedIn ? (
                    <Button className="w-full sm:w-32" variant="outline" onClick={onLogout}>
                      <LogOut className="h-4 w-4" />
                      {text.logout}
                    </Button>
                  ) : (
                    <Button className="w-full sm:w-40" onClick={onLogin}>
                      <User className="h-4 w-4" />
                      {text.loginSteam}
                    </Button>
                  )}
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <KeyRound className="h-4 w-4" />
                  {text.steamApiTitle}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {text.steamApiHelp}{' '}
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 align-baseline text-primary underline-offset-4 hover:underline"
                    onClick={() => window.open(settings.wallhubSteamAccessEnhance ? steamProxyUrl(STEAM_API_KEY_URL) : STEAM_API_KEY_URL, '_blank', 'noopener,noreferrer')}
                  >
                    {text.steamApiQuery}
                    <ExternalLink className="h-3.5 w-3.5" />
                  </button>
                </p>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Input
                    className="min-w-0 flex-1"
                    type="password"
                    value={settings.steamApiKey}
                    onChange={(event) => setSettings((current) => ({ ...current, steamApiKey: event.target.value }))}
                    placeholder={text.steamApiPlaceholder}
                    autoComplete="off"
                  />
                  <Button className="w-full sm:w-32" onClick={() => onSave({ steamApiKey: settings.steamApiKey })}>
                    {text.saveApply}
                  </Button>
                </div>
              </section>

            </motion.div>
                ) : tab === 'experimental' ? (
            <motion.div
              key="settings-experimental"
              layout
              className="space-y-6 p-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1], layout: { type: 'spring', stiffness: 330, damping: 34, mass: 0.9 } }}
            >
              <section>
                <h3 className="text-base font-semibold">{text.navExperimental}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{text.experimentalIntro}</p>
              </section>
              <ExperimentalToggle
                icon={ShieldCheck}
                title={text.wallhubSteamAccessEnhance}
                description={text.wallhubSteamAccessEnhanceDesc}
                enabled={settings.wallhubSteamAccessEnhance}
                onChange={(enabled) => {
                  setSettings((current) => ({
                    ...current,
                    wallhubSteamAccessEnhance: enabled,
                  }));
                  onSave({ wallhubSteamAccessEnhance: enabled });
                }}
              />

              {settings.wallhubSteamAccessEnhance ? (
                <>
                  <div className="space-y-3 rounded-xl border border-border bg-card p-4">
                    <div className="flex flex-col gap-3">
                      <div className="min-w-0">
                        <h4 className="flex items-center gap-2 text-sm font-semibold">
                          <SlidersHorizontal className="h-4 w-4" />
                          {text.resolverPickerTitle}
                        </h4>
                        <p className="mt-1 text-sm text-muted-foreground">{text.resolverSelectDesc}</p>
                      </div>
                      <div className="grid w-full grid-cols-2 gap-1 rounded-lg border border-border bg-input/25 p-1">
                        {([
                          ['resolver', text.resolverModeResolver],
                          ['hosts', text.resolverModeHosts],
                        ] as const).map(([mode, label]) => (
                          <button
                            key={mode}
                            type="button"
                            aria-pressed={resolverUiMode === mode}
                            onClick={() => saveSteamAccessMode(mode)}
                            className={cn(
                              'relative isolate h-9 rounded-md px-2 text-sm font-medium transition-[color,filter,transform] active:scale-[0.98] active:brightness-110',
                              resolverUiMode === mode
                                ? 'text-primary-foreground'
                                : 'text-muted-foreground hover:bg-input/65 hover:text-foreground',
                            )}
                          >
                            {resolverUiMode === mode ? (
                              <motion.span
                                layoutId="settings-resolver-mode-indicator"
                                className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-primary/90 shadow-sm"
                                transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42, mass: 0.72 }}
                              />
                            ) : null}
                            <span className="relative z-10">{label}</span>
                          </button>
                        ))}
                      </div>
                      {showSteamAccessManualSettings ? (
                        <>
                          <div className="grid grid-cols-2 gap-2">
                            <Button variant={resolverProtocol === 'doh' ? 'default' : 'outline'} onClick={() => saveResolverProtocol('doh')}>
                              {text.resolverProtocolDoh}
                            </Button>
                            <Button variant={resolverProtocol === 'dot' ? 'default' : 'outline'} onClick={() => saveResolverProtocol('dot')}>
                              {text.resolverProtocolDot}
                            </Button>
                          </div>
                          <div className="flex flex-col gap-2 rounded-lg border border-border bg-input/25 p-3 sm:flex-row sm:items-center">
                            <div className="min-w-0 flex-1">
                              <div className="text-xs text-muted-foreground">{text.resolverCurrent}</div>
                              <div className="break-all text-sm font-medium text-foreground">
                                {resolverProtocol.toUpperCase()} · {currentResolverEndpoint}
                              </div>
                              <div className="mt-1 text-xs text-muted-foreground">{text.resolverSelectedCount}: {selectedResolverEndpoints.length}</div>
                            </div>
                            <Button className="w-full sm:w-28" variant="outline" onClick={() => setDohPickerOpen(true)}>
                              <SlidersHorizontal className="h-4 w-4" />
                              {text.resolverSwitch}
                            </Button>
                          </div>
                        </>
                      ) : null}
                    </div>
                  </div>

                  {showSteamAccessHostsSettings ? (
                    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                      <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
                        <span className="inline-flex items-center gap-2">
                          <Route className="h-4 w-4" />
                          {text.resolverHostsTitle}
                        </span>
                        <Badge className="border border-border bg-background/70 px-3 py-1 text-foreground shadow-sm" variant="outline">
                          {hostsEntryCount} hosts
                        </Badge>
                      </h4>
                      <p className="text-sm text-muted-foreground">{text.resolverHostsDesc}</p>
                      <textarea
                        className="scrollbar-overlay min-h-40 w-full resize-y rounded-md border border-input bg-input/45 p-3 text-sm text-foreground outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
                        value={settings.wallhubSteamAccessHosts}
                        onChange={(event) => {
                          setHostsEdited(true);
                          setSettings((current) => ({ ...current, wallhubSteamAccessHosts: event.target.value }));
                        }}
                        placeholder={text.resolverHostsPlaceholder}
                        spellCheck={false}
                        disabled={!settingsHostsLoaded}
                        aria-busy={!settingsHostsLoaded}
                      />
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                        <Input
                          className="min-w-0 flex-1"
                          value={customSteamHostsUrl}
                          onChange={(event) => {
                            setCustomSteamHostsUrl(event.target.value);
                            setSettings((current) => ({ ...current, wallhubSteamAccessHostsUrl: event.target.value }));
                          }}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' && hostsUrlReady && !hostsDirty) {
                              event.preventDefault();
                              void fetchHostsFromBackend();
                            }
                          }}
                          placeholder=""
                        />
                        <Button className="w-full sm:w-36" disabled={hostsFetchBusy || !settingsHostsLoaded} variant="outline" onClick={() => (hostsDirty || !hostsUrlReady ? saveSteamHosts() : void fetchHostsFromBackend())}>
                          {hostsDirty || !hostsUrlReady ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}
                          {hostsDirty || !hostsUrlReady ? '保存' : text.resolverHostsFetch}
                        </Button>
                      </div>
                      <div className="space-y-2">
                        <div className="flex items-end gap-2">
                          <Select
                            className="min-w-0 flex-1"
                            label={text.resolverHostsAutoUpdate}
                            value={settings.wallhubSteamAccessHostsAutoUpdateEnabled ? String(settings.wallhubSteamAccessHostsUpdateIntervalHours) : 'off'}
                            onChange={(value) => {
                              const enabled = value !== 'off';
                              const hours = enabled ? normalizeSteamAccessHostsUpdateIntervalHours(value) : settings.wallhubSteamAccessHostsUpdateIntervalHours;
                              setSettings((current) => ({
                                ...current,
                                wallhubSteamAccessHostsAutoUpdateEnabled: enabled,
                                wallhubSteamAccessHostsUpdateIntervalHours: hours,
                              }));
                              onSave({ wallhubSteamAccessHostsAutoUpdateEnabled: enabled, wallhubSteamAccessHostsUpdateIntervalHours: hours });
                            }}
                            options={[
                              { value: 'off', label: text.disabled },
                              { value: '0.5', label: '30 min' },
                              { value: '1', label: '1 h' },
                              { value: '3', label: '3 h' },
                              { value: '6', label: '6 h' },
                              { value: '12', label: '12 h' },
                              { value: '24', label: '24 h' },
                              { value: '72', label: '72 h' },
                              { value: '168', label: '168 h' },
                            ]}
                          />
                          <Badge className="mb-0.5 h-9 border border-border bg-background/70 px-3 text-foreground shadow-sm" variant="outline">
                            {settings.wallhubSteamAccessHostsAutoUpdateEnabled
                              ? settings.wallhubSteamAccessHostsUpdateIntervalHours === 0.5 ? '30 min' : `${settings.wallhubSteamAccessHostsUpdateIntervalHours} h`
                              : text.disabled}
                          </Badge>
                        </div>
                      </div>
                      <div className="space-y-1 text-xs text-muted-foreground">
                        <div>{text.resolverHostsLastUpdated}: {settings.wallhubSteamAccessHostsLastUpdatedAt ? new Date(settings.wallhubSteamAccessHostsLastUpdatedAt).toLocaleString() : '-'}</div>
                        <div>{text.resolverHostsLastError}: {settings.wallhubSteamAccessHostsLastError || runtimeSteamAccess?.hosts?.lastError || '-'}</div>
                      </div>
                    </section>
                  ) : null}

                  <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                    <h4 className="flex items-center gap-2 text-sm font-semibold">
                      <Link2 className="h-4 w-4" />
                      {text.steamProxyQuickOpen}
                    </h4>
                    <p className="text-sm text-muted-foreground">{text.steamProxyQuickOpenDesc}</p>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <Input
                        className="min-w-0 flex-1"
                        value={steamProxyQuickUrl}
                        onChange={(event) => setSteamProxyQuickUrl(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') openSteamProxyQuickUrl();
                        }}
                        placeholder={text.steamProxyQuickOpenPlaceholder}
                      />
                      <Button className="w-full sm:w-32" disabled={!steamProxyQuickUrl.trim()} onClick={openSteamProxyQuickUrl}>
                        <ExternalLink className="h-4 w-4" />
                        {text.openProxyUrl}
                      </Button>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
                      {STEAM_PROXY_QUICK_LINKS.map((item) => (
                        <Button
                          key={item.key}
                          className="justify-start px-3 text-left text-xs"
                          size="sm"
                          variant="outline"
                          onClick={() => openSteamProxyTarget(item.url)}
                        >
                          <ExternalLink className="h-3.5 w-3.5" />
                          {text[item.key]}
                        </Button>
                      ))}
                    </div>
                  </section>
                </>
              ) : null}

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <KeyRound className="h-4 w-4" />
                  {text.wallhubSteamWebApiControl}
                </h4>
                <p className="text-sm text-muted-foreground">{text.wallhubSteamWebApiControlDesc}</p>
                <div className={cn('grid grid-cols-1 gap-3', settings.wallhubSteamAccessEnhance && 'sm:grid-cols-3')}>
                  {settings.wallhubSteamAccessEnhance ? (
                    <Select
                      label={text.wallhubSteamWebApiRouteLabel}
                      value={settings.wallhubSteamWebApiRoute}
                      onChange={(value) => {
                        const route = value as 'direct' | 'follow';
                        const directEnabled = route === 'direct';
                        setSettings((current) => ({ ...current, wallhubSteamWebApiRoute: route, wallhubSteamAccessDirectWebApi: directEnabled }));
                        onSave({ wallhubSteamWebApiRoute: route, wallhubSteamAccessDirectWebApi: directEnabled });
                      }}
                      options={[
                        { value: 'direct', label: text.wallhubSteamWebApiRouteDirect },
                        { value: 'follow', label: text.wallhubSteamWebApiRouteFollow },
                      ]}
                    />
                  ) : null}
                  <Select
                    label={text.wallhubSteamWebApiProtocolLabel}
                    value={settings.wallhubSteamWebApiProtocol}
                    onChange={(value) => {
                      const protocol = value as 'https' | 'http';
                      setSettings((current) => ({ ...current, wallhubSteamWebApiProtocol: protocol }));
                      onSave({ wallhubSteamWebApiProtocol: protocol });
                    }}
                    options={[
                      { value: 'https', label: 'HTTPS' },
                      { value: 'http', label: 'HTTP' },
                    ]}
                  />
                  <Select
                    label={text.wallhubSteamWebApiHostLabel}
                    value={settings.wallhubSteamWebApiHost}
                    onChange={(value) => {
                      const host = value as 'api.steampowered.com' | 'community.steam-api.com';
                      setSettings((current) => ({ ...current, wallhubSteamWebApiHost: host }));
                      onSave({ wallhubSteamWebApiHost: host });
                    }}
                    options={[
                      { value: 'api.steampowered.com', label: 'api.steampowered.com' },
                      { value: 'community.steam-api.com', label: 'community.steam-api.com' },
                    ]}
                  />
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <Gauge className="h-4 w-4" />
                  {text.wallhubLogLevel}
                </h4>
                <p className="text-sm text-muted-foreground">{text.wallhubLogLevelDesc}</p>
                <div className="grid grid-cols-2 gap-2 sm:max-w-xs">
                  {(['info', 'debug'] as const).map((level) => (
                    <Button
                      key={level}
                      variant={settings.wallhubLogLevel === level ? 'default' : 'outline'}
                      onClick={() => {
                        const experimental = { ...settings.wallhubSteamAccessExperimental, verboseNetworkLogs: level === 'debug' };
                        setSettings((current) => ({ ...current, wallhubLogLevel: level, wallhubSteamAccessExperimental: experimental }));
                        onSave({ wallhubLogLevel: level, wallhubSteamAccessExperimental: experimental });
                      }}
                    >
                      {level.toUpperCase()}
                    </Button>
                  ))}
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <Images className="h-4 w-4" />
                  {text.wallhubSteamAccessStaticCdnControl}
                </h4>
                <p className="text-sm text-muted-foreground">{text.wallhubSteamAccessStaticCdnControlDesc}</p>
                <div className="grid gap-3">
                  {([
                    ['imagesSteamusercontent', 'images.steamusercontent.com'],
                    ['sharedAkamaiSteamstatic', 'shared.akamai.steamstatic.com'],
                  ] as const).map(([key, host]) => {
                    const control = settings.wallhubSteamAccessStaticCdnHosts[key] || { enhance: false, reuseConnection: true };
                    return (
                      <div
                        key={key}
                        className={cn(
                          'grid gap-2 rounded-lg border border-border/70 bg-background/40 p-3 sm:items-center',
                          settings.wallhubSteamAccessEnhance && 'sm:grid-cols-[1fr_auto_auto]',
                          !settings.wallhubSteamAccessEnhance && 'sm:grid-cols-[1fr_auto]',
                        )}
                      >
                        <div className="min-w-0">
                          <div className="break-all text-sm font-medium">{host}</div>
                          <div className="text-xs text-muted-foreground">{text.wallhubSteamAccessStaticCdnHostDesc}</div>
                        </div>
                        {settings.wallhubSteamAccessEnhance ? (
                          <Button
                            variant={control.enhance ? 'default' : 'outline'}
                            onClick={() => saveStaticCdnHostControl(key, { enhance: !control.enhance })}
                          >
                            {text.builtinEnhance}: {control.enhance ? text.enabled : text.disabled}
                          </Button>
                        ) : null}
                        <Button
                          variant={control.reuseConnection ? 'default' : 'outline'}
                          onClick={() => saveStaticCdnHostControl(key, { reuseConnection: !control.reuseConnection })}
                        >
                          {text.reuseConnection}: {control.reuseConnection ? text.enabled : text.disabled}
                        </Button>
                      </div>
                    );
                  })}
                </div>
              </section>

              <ExperimentalToggle
                icon={ChevronsRight}
                title={text.prefetchNextPage}
                description={text.prefetchNextPageDesc}
                enabled={prefetchNextPage}
                onChange={setPrefetchNextPage}
              />

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <div className="min-w-0">
                  <h4 className="flex items-center gap-2 text-sm font-semibold">
                    <Play className="h-4 w-4" />
                    {text.videoPlayerControls}
                  </h4>
                  <p className="mt-1 text-sm text-muted-foreground">{text.videoPlayerControlsDesc}</p>
                </div>
                <div className="grid w-full grid-cols-2 gap-1 rounded-lg border border-border bg-input/25 p-1" role="group" aria-label={text.videoPlayerControls}>
                  {([
                    ['native', text.videoPlayerModeDefault],
                    ['compatibility', text.videoPlayerModeCompatibility],
                  ] as const).map(([mode, label]) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={videoPlayerMode === mode}
                      onClick={() => setVideoPlayerMode(mode)}
                      className={cn(
                        'relative isolate min-h-9 rounded-md px-3 py-2 text-sm font-medium transition-colors',
                        videoPlayerMode === mode
                          ? 'text-primary-foreground'
                          : 'text-muted-foreground hover:bg-input/65 hover:text-foreground',
                      )}
                    >
                      {videoPlayerMode === mode ? (
                        <motion.span
                          layoutId="settings-video-player-mode-indicator"
                          className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-primary shadow-sm"
                          transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42, mass: 0.72 }}
                        />
                      ) : null}
                      <span className="relative z-10">{label}</span>
                    </button>
                  ))}
                </div>
              </section>

              <ExperimentalToggle
                icon={Film}
                title={text.steamKitDepotStreaming}
                description={text.steamKitDepotStreamingDesc}
                enabled={settings.steamKitDepotStreaming}
                onChange={(enabled) => {
                  setSettings((current) => ({ ...current, steamKitDepotStreaming: enabled }));
                  onSave({ steamKitDepotStreaming: enabled });
                }}
              />

            </motion.div>
                ) : (
            <motion.div
              key="settings-appearance"
              className="relative isolate space-y-6 p-5"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            >
              <section>
                <h3 className="text-base font-semibold">{text.navAppearance}</h3>
                <p className="mt-1 text-sm text-muted-foreground">{text.appearanceIntro}</p>
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <Languages className="h-4 w-4" />
                  {text.language}
                </h4>
                <p className="text-sm text-muted-foreground">{text.languageDesc}</p>
                <Select
                  value={language}
                  onChange={(value) => setLanguage(normalizeLanguage(value))}
                  options={[
                    { value: 'zh', label: text.languageChinese },
                    { value: 'en', label: text.languageEnglish },
                  ]}
                />
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <SunMoon className="h-4 w-4" />
                  {text.themeMode}
                </h4>
                <p className="text-sm text-muted-foreground">{text.themeModeDesc}</p>
                <Select
                  value={themeMode}
                  onChange={(value) => setThemeMode(normalizeThemeMode(value))}
                  options={themeModeOptions(text)}
                />
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <Paintbrush className="h-4 w-4" />
                  {text.accentTheme}
                </h4>
                <p className="text-sm text-muted-foreground">{text.accentThemeDesc}</p>
                <Select
                  value={accentTheme}
                  onChange={(value) => setAccentTheme(normalizeAccentTheme(value))}
                  options={accentThemeOptions(text)}
                />
                {accentTheme === 'custom' ? (
                  <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
                    <span>{text.customAccentColor}</span>
                    <div className="flex items-center gap-2">
                      <input
                        className="h-9 w-12 rounded-md border border-input bg-input p-1"
                        type="color"
                        value={customAccentColor}
                        onChange={(event) => {
                          const color = normalizeCustomAccentColor(event.target.value);
                          setCustomAccentColorDraft(color);
                          setCustomAccentColor(color);
                        }}
                      />
                      <Input
                        value={customAccentColorDraft}
                        onChange={(event) => {
                          const draft = event.target.value;
                          setCustomAccentColorDraft(draft);
                          if (isCompleteCustomAccentColor(draft)) setCustomAccentColor(draft.trim());
                        }}
                        onBlur={() => setCustomAccentColorDraft(customAccentColor)}
                      />
                    </div>
                  </label>
                ) : null}
              </section>

              <section className="relative isolate space-y-3 overflow-hidden rounded-xl border border-border bg-card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h4 className="flex items-center gap-2 text-sm font-semibold">
                      <SlidersHorizontal className="h-4 w-4" />
                      {text.fixedPanelHeight}
                    </h4>
                    <p className="mt-1 text-sm text-muted-foreground">{text.fixedPanelHeightDesc}</p>
                  </div>
                  <Button
                    className="w-full sm:w-24"
                    variant={fixedPanelHeightEnabled ? 'default' : 'outline'}
                    onClick={() => setFixedPanelHeight(!fixedPanelHeightEnabled)}
                  >
                    {fixedPanelHeightEnabled ? text.enabled : text.disabled}
                  </Button>
                </div>
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <LayoutTemplate className="h-4 w-4" />
                  {text.detailsPresentation}
                </h4>
                <p className="text-sm text-muted-foreground">{text.detailsPresentationDesc}</p>
                <Select
                  value={detailsPresentation}
                  onChange={(value) => setDetailsPresentation(value === 'redesigned' ? 'redesigned' : 'classic')}
                  options={[
                    { value: 'classic', label: text.detailsPresentationClassic },
                    { value: 'redesigned', label: text.detailsPresentationRedesigned },
                  ]}
                />
              </section>

              <section className="space-y-3 rounded-xl border border-border bg-card p-4">
                <h4 className="flex items-center gap-2 text-sm font-semibold">
                  <Play className="h-4 w-4" />
                  {text.homeCardDefaultAction}
                </h4>
                <p className="text-sm text-muted-foreground">{text.homeCardDefaultActionDesc}</p>
                <Select
                  value={homeCardDefaultAction}
                  onChange={(value) => setHomeCardDefaultAction(normalizeHomeCardDefaultAction(value))}
                  options={homeCardDefaultActionOptions(text)}
                />
              </section>

              <section className="relative isolate space-y-3 overflow-hidden rounded-xl border border-border bg-card p-4">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="min-w-0">
                    <h4 className="flex items-center gap-2 text-sm font-semibold">
                      <Filter className="h-4 w-4" />
                      {text.homeFilterMultiSelect}
                    </h4>
                    <p className="mt-1 text-sm text-muted-foreground">{text.homeFilterMultiSelectDesc}</p>
                  </div>
                  <button
                    type="button"
                    aria-pressed={homeFilterMultiSelect}
                    className={cn(
                      'relative z-0 inline-flex h-9 w-full shrink-0 touch-manipulation select-none items-center justify-center rounded-md border px-4 text-sm font-medium outline-none transition-[background-color,border-color,color,box-shadow,filter] duration-75 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 active:brightness-110 sm:w-24',
                      homeFilterMultiSelect
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-input bg-input/45 text-foreground shadow-sm [@media(hover:hover)]:hover:bg-input/65',
                    )}
                    onClick={() => setHomeFilterMultiSelect(!homeFilterMultiSelect)}
                  >
                    {homeFilterMultiSelect ? text.enabled : text.disabled}
                  </button>
                </div>
              </section>

              <section className="relative isolate space-y-3 overflow-hidden rounded-xl border border-border bg-card p-4">
                <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
                  <span className="inline-flex items-center gap-2"><Grid3X3 className="h-4 w-4" />{text.homePageSize}</span>
                  <Badge className="border border-border bg-background px-3 py-1 text-foreground shadow-sm" variant="outline">
                    {text.current} {homePageSize} {text.itemUnit}
                  </Badge>
                </h4>
                <p className="text-sm text-muted-foreground">{text.homePageSizeDesc}</p>
                <Select
                  value={String(homePageSize)}
                  onChange={(value) => setHomePageSize(normalizeHomePageSize(value))}
                  options={[
                    { value: '10', label: `10 ${text.itemUnit}` },
                    { value: '15', label: `15 ${text.itemUnit}` },
                    { value: '30', label: `30 ${text.itemUnit}（Wallhub ${text.defaultMark}）` },
                    { value: '50', label: `50 ${text.itemUnit}（Wallpaper Engine ${text.defaultMark}）` },
                  ]}
                />
              </section>

              <section className="relative isolate space-y-3 overflow-hidden rounded-xl border border-border bg-card p-4">
                <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
                  <span className="inline-flex items-center gap-2"><Smartphone className="h-4 w-4" />{text.mobileColumns}</span>
                  <Badge className="border border-border bg-background px-3 py-1 text-foreground shadow-sm" variant="outline">
                    {text.current} {mobileColumns} {text.itemUnit}
                  </Badge>
                </h4>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select
                    className="min-w-0 flex-1"
                    value={String(mobileColumns)}
                    onChange={(value) => setMobileColumns(normalizeMobileColumns(value))}
                    options={[
                      { value: '1', label: `1 ${text.itemUnit}` },
                      { value: '2', label: `2 ${text.itemUnit}（${text.defaultMark}）` },
                      { value: '3', label: `3 ${text.itemUnit}` },
                      { value: '4', label: `4 ${text.itemUnit}` },
                    ]}
                  />

                </div>
              </section>

              <section className="relative isolate space-y-3 overflow-hidden rounded-xl border border-border bg-card p-4">
                <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold">
                  <span className="inline-flex items-center gap-2"><Monitor className="h-4 w-4" />{text.desktopColumns}</span>
                  <Badge className="border border-border bg-background px-3 py-1 text-foreground shadow-sm" variant="outline">
                    {desktopColumns ? `${text.current} ${desktopColumns} ${text.itemUnit}` : text.auto}
                  </Badge>
                </h4>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <Select
                    className="min-w-0 flex-1"
                    value={String(desktopColumns)}
                    onChange={(value) => setDesktopColumns(normalizeDesktopColumns(value))}
                    options={[
                      { value: '0', label: `${text.autoFit}（${text.defaultMark}）` },
                      { value: '3', label: `3 ${text.itemUnit}` },
                      { value: '4', label: `4 ${text.itemUnit}` },
                      { value: '5', label: `5 ${text.itemUnit}` },
                      { value: '6', label: `6 ${text.itemUnit}` },
                      { value: '7', label: `7 ${text.itemUnit}` },
                      { value: '8', label: `8 ${text.itemUnit}` },
                    ]}
                  />

                </div>
              </section>
            </motion.div>
                )}
              </AnimatePresence>
            </AnimatedHeight>
          </ScrollArea>
        </div>
      </motion.div>
    </Dialog>
    <Dialog
      open={dohPickerOpen}
      onOpenChange={setDohPickerOpen}
      title={text.resolverPickerTitle}
      fitContent
      lightweight
      className="w-[min(520px,calc(100vw-1rem))]"
      bodyClassName="space-y-3 p-3 sm:p-4"
    >
      <div className="rounded-lg border border-border bg-input/25 p-3">
        <div className="text-xs text-muted-foreground">{text.resolverCurrent}</div>
        <div className="mt-1 break-all text-sm font-medium text-foreground">{resolverProtocol.toUpperCase()} · {currentResolverEndpoint}</div>
      </div>
      <div className="grid max-h-[45vh] gap-2 overflow-y-auto pr-1">
        {allResolverEndpointOptions.map((endpoint, index) => {
          const normalizedEndpoint = resolverProtocol === 'dot'
            ? normalizeSteamAccessDotEndpoint(endpoint, DEFAULT_STEAM_ACCESS_DOT_ENDPOINT)
            : normalizeSteamAccessDohEndpoint(endpoint, DEFAULT_STEAM_ACCESS_DOH_ENDPOINT);
          const active = selectedResolverEndpoints.includes(normalizedEndpoint);
          const isCustom = customResolverEndpoints.includes(normalizedEndpoint);
          return (
            <div
              key={`${endpoint}-${index}`}
              className={cn(
                'flex min-h-9 min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-input/45 px-3 py-2 text-left text-xs text-foreground transition-[background-color,border-color,color,filter,transform]',
                active && 'border-primary/40 bg-accent text-accent-foreground',
              )}
            >
              <button type="button" className="flex min-w-0 flex-1 items-center gap-2 text-left" onClick={() => toggleResolverEndpoint(normalizedEndpoint)}>
                {active ? <Check className="h-4 w-4 shrink-0" /> : <span className="h-4 w-4 shrink-0 rounded border border-border" />}
                <span className="min-w-0 break-all">{isCustom ? `${text.resolverCustomEndpoint}: ` : ''}{endpoint}</span>
              </button>
              {isCustom ? (
                <Button size="icon-sm" variant="ghost" onClick={() => removeCustomResolverEndpoint(normalizedEndpoint)}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              ) : null}
            </div>
          );
        })}
      </div>
      <div className="flex flex-col gap-2 border-t border-border/50 pt-3 sm:flex-row sm:items-center">
        <Input
          className="min-w-0 flex-1"
          value={customDohEndpoint}
          onChange={(event) => setCustomDohEndpoint(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && customDohEndpoint.trim()) saveResolverEndpoint(customDohEndpoint);
          }}
          placeholder={resolverProtocol === 'dot' ? 'dns.example.com:853' : 'https://dns.example.com/resolve'}
        />
        <Button className="w-full sm:w-32" disabled={!validateSteamAccessEndpoint(customDohEndpoint, resolverProtocol)} onClick={() => saveResolverEndpoint(customDohEndpoint)}>
          <Check className="h-4 w-4" />
          {text.resolverSave}
        </Button>
      </div>
    </Dialog>
    </>
  );
}
import { InfoRowCard, InfoRow, ExperimentalToggle, translateRuntimeStatus, RuntimeStatusValue } from '@/components/settings/SettingPrimitives';
