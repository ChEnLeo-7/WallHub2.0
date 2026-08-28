import type { Dispatch, SetStateAction } from 'react';
import type { RuntimeDiagnostics, RuntimeStatus, SteamStatus } from '@/lib/api';
import type { Language } from '@/lib/text';

export type SteamAccessStaticCdnHostControl = {
  enhance: boolean;
  reuseConnection: boolean;
};

export type SettingsForm = {
  steamApiKey: string;
  steamDataSource: 'community' | 'webapi' | 'cm';
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

export type ThemeMode = 'system' | 'light' | 'dark';
export type AccentTheme = 'mono' | 'blue' | 'green' | 'rose' | 'violet' | 'custom';
export type DetailsPresentation = 'classic' | 'redesigned';
export type HomeCardDefaultAction = 'playVideo' | 'backgroundDownload' | 'clientDownload' | 'openSteamPage' | 'remoteSubscribe';

export type SettingsStateProps = {
  settings: SettingsForm;
  setSettings: Dispatch<SetStateAction<SettingsForm>>;
  onSave: (patch?: Partial<SettingsForm>) => void;
};

export type SettingsDialogContentProps = SettingsStateProps & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fixedPanelHeight: boolean;
  runtime: RuntimeStatus | null;
  runtimeDiagnostics: RuntimeDiagnostics | null;
  settingsHostsLoaded: boolean;
  mpkgCompactAvailable: boolean;
  mpkgCompactUnavailableReason: string;
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
  onClearDepotStreamCache: () => void;
  onLogin: () => void;
  onLogout: () => void;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  onRestart: () => void;
  onShutdown: () => void;
};
