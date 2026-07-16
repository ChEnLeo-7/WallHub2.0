import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Check, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  backgroundDownload,
  clearDepotStreamCache,
  clientDownload,
  getCachedItems,
  getComments,
  getDetails,
  getDetailsBatch,
  getPersonalSource,
  getQueue,
  getRuntime,
  getRuntimeDiagnostics,
  getSettings,
  getSettingsDetails,
  getSteamStatus,
  logoutSteam,
  mpkgDownload,
  playVideo,
  queryWorkshop,
  queueAction,
  releaseDepotVideoStream,
  reportClientEvent,
  restartServer,
  saveSettings,
  shutdownServer,
  waitSteamAccessReady,
  type Details,
  type QueueTask,
  type RuntimeDiagnostics,
  type RuntimeStatus,
  type SteamStatus,
  type WorkshopItem,
} from '@/lib/api';
import { PREFS_KEY, readPrefs, markSearchSessionActive } from '@/hooks/usePreferences';
import { usePageVisible } from '@/hooks/usePageVisible';
import { useSystemTheme } from '@/hooks/useSystemTheme';
import { useWallpaperLayout } from '@/hooks/useWallpaperLayout';
import { FilterBar } from '@/components/layout/FilterBar';
import { Header } from '@/components/layout/Header';
import { Pagination } from '@/components/layout/Pagination';
import { ViewToggle } from '@/components/layout/ViewToggle';
import { WallpaperGrid } from '@/components/layout/WallpaperGrid';
import { GenreSheet, GENRES } from '@/components/dialogs/GenreSheet';
import { DownloadChoiceDialog } from '@/components/dialogs/DownloadChoiceDialog';
import type { VideoState } from '@/components/dialogs/VideoDialog';
import type { SettingsForm } from '@/components/dialogs/SettingsDialog';
import { useText, LanguageContext, TEXT, textFor, type Language } from '@/lib/text';
import { cn, formatBytesText } from '@/lib/utils';
import { encodeDetailTagSearch } from '@/lib/detailTagSearch.mjs';
import { BACK_TO_TOP_MOTION } from '@/lib/motion';
import {
  applyCustomAccentVariables,
  clearCustomAccentVariables,
  defaultHomeFilters,
  normalizeConcurrentDownloads,
  normalizeDepotStreamCacheMaxMb,
  normalizeRatings,
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
  primaryRating,
  type Filters,
} from '@/lib/normalizers';
import {
  isRuntimeSetupActive,
  isSteamLoginError,
  itemType,
  queueSignature,
  samePayload,
  steamProxyUrl,
} from '@/lib/workshop';
import {
  buildQuery,
  findWorkshopCacheEntry,
  workshopCacheKey,
  WORKSHOP_QUERY_CACHE_TTL_MS,
  type WorkshopCacheEntry,
} from '@/hooks/useWorkshopQuery';
import { getNextPagePrefetchPlan } from '../../src/shared/paginationPrefetch.mjs';
import { pruneWorkshopCache } from '../../src/shared/workshopCache.mjs';
import { scheduleIdleTask } from '../../src/shared/idleTask.mjs';
import { filterQueueTasksAfterDelete, type QueueDeleteTombstone } from '../../src/shared/queueTombstones.mjs';
import { normalizeDetailsPresentation } from '../../src/shared/detailsPresentation.mjs';
import { EmptyState, ErrorState, LoadingState, sourceLabel, ToastStack } from '@/components/app/AppPageStates';

const DetailsDialog = React.lazy(() => import('@/components/dialogs/DetailsDialog').then((module) => ({ default: module.DetailsDialog })));
const QueueDialog = React.lazy(() => import('@/components/dialogs/QueueDialog').then((module) => ({ default: module.QueueDialog })));
const LoginDialogV2 = React.lazy(() => import('@/components/dialogs/LoginDialog').then((module) => ({ default: module.LoginDialogV2 })));
const VideoDialog = React.lazy(() => import('@/components/dialogs/VideoDialog').then((module) => ({ default: module.VideoDialog })));
const SettingsDialog = React.lazy(() => import('@/components/dialogs/SettingsDialog').then((module) => ({ default: module.SettingsDialog })));

const PROXY_DOMAINS = [
  'steamcommunity.com',
  'api.steampowered.com',
  'community.steam-api.com',
  'store.steampowered.com',
  'images.steamusercontent.com',
  'steamuserimages-a.akamaihd.net',
  'steamstatic.com',
  's.team',
  'community.akamai.steamstatic.com',
  'shared.akamai.steamstatic.com',
  'steamstatic-a.akamaihd.net',
  'cdn.akamai.steamstatic.com',
  'community.fastly.steamstatic.com',
  'shared.fastly.steamstatic.com',
  'cdn.fastly.steamstatic.com',
  'cdn.cloudflare.steamstatic.com',
  'steam-chat.com',
  'steam.tv',
  'steambroadcast.akamaized.net',
  'steamvideo-a.akamaihd.net',
];
const DEFAULT_STEAM_ACCESS_DOH_ENDPOINT = 'https://1.12.12.12/resolve';
const DEFAULT_STEAM_ACCESS_DOT_ENDPOINT = 'dot.pub:853';
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
const DEFAULT_STATIC_CDN_HOST_CONTROLS: SettingsForm['wallhubSteamAccessStaticCdnHosts'] = {
  imagesSteamusercontent: { enhance: false, reuseConnection: true },
  sharedAkamaiSteamstatic: { enhance: false, reuseConnection: true },
};
const MAX_WORKSHOP_QUERY_CACHE_ENTRIES = 60;
function normalizeWallhubLogLevel(value: unknown): SettingsForm['wallhubLogLevel'] {
  return String(value || '').toLowerCase() === 'debug' ? 'debug' : 'info';
}
function normalizeStaticCdnHostControls(value: unknown): SettingsForm['wallhubSteamAccessStaticCdnHosts'] {
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

type ThemeMode = 'system' | 'light' | 'dark';
type AccentTheme = 'mono' | 'blue' | 'green' | 'rose' | 'violet' | 'custom';
type DetailsPresentation = 'classic' | 'redesigned';
type HomeCardDefaultAction = 'playVideo' | 'backgroundDownload' | 'clientDownload' | 'openSteamPage';

type Toast = { id: number; message: string; type: 'info' | 'ok' | 'warn' };

type DetailsCacheEntry = {
  value: Details;
  expiresAt: number;
};

const DETAILS_CACHE_TTL_MS = 20 * 60 * 1000;
const DETAILS_CACHE_MAX_ENTRIES = 150;
const DETAILS_CACHE_MAX_COMMENTS = 100;

function mergeQueueItems(tasks: QueueTask[], cachedItems: QueueTask[]) {
  const taskIds = new Set(tasks.map((task) => String(task.id || task.cacheKey || '')));
  return tasks.concat(cachedItems.filter((item) => !taskIds.has(String(item.id || item.cacheKey || ''))));
}

function readDetailsCache(cache: Map<string, DetailsCacheEntry>, id: string) {
  const entry = cache.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(id);
    return null;
  }
  cache.delete(id);
  cache.set(id, entry);
  return entry.value;
}

function detailsForCache(value: Details): Details {
  const comments = value.comments || [];
  if (comments.length <= DETAILS_CACHE_MAX_COMMENTS) return value;
  const commentsStart = Number(value.commentsStart || 0);
  return {
    ...value,
    comments: comments.slice(0, DETAILS_CACHE_MAX_COMMENTS),
    commentsNextStart: commentsStart + DETAILS_CACHE_MAX_COMMENTS,
    commentsHasMore: true,
  };
}

function writeDetailsCache(cache: Map<string, DetailsCacheEntry>, id: string, value: Details) {
  cache.delete(id);
  cache.set(id, {
    value: detailsForCache(value),
    expiresAt: Date.now() + DETAILS_CACHE_TTL_MS,
  });
  while (cache.size > DETAILS_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

export default function App() {
  const initial = React.useMemo(readPrefs, []);
  const [themeMode, setThemeMode] = React.useState<ThemeMode>(initial.themeMode);
  const [customAccentColor, setCustomAccentColor] = React.useState(initial.customAccentColor);
  const [accentTheme, setAccentTheme] = React.useState<AccentTheme>(initial.accentTheme);
  const [filters, setFilters] = React.useState<Filters>(initial.filters);
  const [exactPhrase, setExactPhrase] = React.useState(initial.exactPhrase);
  const [homeFilterMultiSelect, setHomeFilterMultiSelect] = React.useState(initial.homeFilterMultiSelect);
  const [view, setView] = React.useState<'grid' | 'list'>(initial.view);
  const [mobileColumns, setMobileColumns] = React.useState(initial.mobileColumns);
  const [desktopColumns, setDesktopColumns] = React.useState(initial.desktopColumns);
  const [homePageSize, setHomePageSize] = React.useState(initial.homePageSize);
  const [prefetchNextPage, setPrefetchNextPage] = React.useState(initial.prefetchNextPage);
  const [language, setLanguage] = React.useState<Language>(initial.language);
  const [fixedPanelHeight, setFixedPanelHeight] = React.useState(initial.fixedPanelHeight);
  const [detailsPresentation, setDetailsPresentation] = React.useState<DetailsPresentation>(normalizeDetailsPresentation(initial.detailsPresentation));
  const [homeCardDefaultAction, setHomeCardDefaultAction] = React.useState<HomeCardDefaultAction>(initial.homeCardDefaultAction);
  const [page, setPage] = React.useState(1);
  const [items, setItems] = React.useState<WorkshopItem[]>([]);
  const [total, setTotal] = React.useState(0);
  const [serverTotalPages, setServerTotalPages] = React.useState(0);
  const [dataSource, setDataSource] = React.useState('');
  const [fallbackUsed, setFallbackUsed] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [filterRefreshToken, setFilterRefreshToken] = React.useState(0);
  const [warmingSteamIp, setWarmingSteamIp] = React.useState(false);
  const [error, setError] = React.useState('');
  const [runtime, setRuntime] = React.useState<RuntimeStatus | null>(null);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = React.useState<RuntimeDiagnostics | null>(null);
  const [queue, setQueue] = React.useState<QueueTask[]>([]);
  const [steam, setSteam] = React.useState<SteamStatus | null>(null);
  const [selected, setSelected] = React.useState<WorkshopItem | null>(null);
  const [details, setDetails] = React.useState<Details | null>(null);
  const [detailsLoading, setDetailsLoading] = React.useState(false);
  const [personalSourceLabel, setPersonalSourceLabel] = React.useState('');
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const [settingsHostsLoaded, setSettingsHostsLoaded] = React.useState(false);
  const [mpkgCompactAvailable, setMpkgCompactAvailable] = React.useState(false);
  const [mpkgCompactUnavailableReason, setMpkgCompactUnavailableReason] = React.useState('');
  const [queueOpen, setQueueOpen] = React.useState(false);
  const [loginOpen, setLoginOpen] = React.useState(false);
  const [genreOpen, setGenreOpen] = React.useState(false);
  const [toasts, setToasts] = React.useState<Toast[]>([]);
  const [video, setVideo] = React.useState<VideoState | null>(null);
  const [downloadChoice, setDownloadChoice] = React.useState<WorkshopItem | null>(null);
  const [suppressGridLayoutAnimation, setSuppressGridLayoutAnimation] = React.useState(false);
  const [showHomeScrollTop, setShowHomeScrollTop] = React.useState(false);
  const [loadedDialogs, setLoadedDialogs] = React.useState({ settings: false, queue: false, details: false, login: false, video: false });
  const [settingsForm, setSettingsForm] = React.useState<SettingsForm>({
    steamApiKey: '',
    wallhubLogLevel: 'info',
    mpkgTextureProfile: 'fast',
    useSteamApi: false,
    downloadDir: '',
    maxConcurrentDownloads: 1,
    steamCdnRouteStrategy: 'nearest',
    steamHttpProxyUrl: '',
    steamKitMaxDownloads: 0,
    effectiveSteamKitMaxDownloads: 0,
    steamKitDepotStreaming: false,
    workshopHtmlOrderMode: false,
    wallhubSteamAccessEnhance: false,
    wallhubSteamAccessDirectWebApi: false,
    wallhubSteamWebApiRoute: 'follow',
    wallhubSteamWebApiProtocol: 'https',
    wallhubSteamWebApiHost: 'api.steampowered.com',
    wallhubSteamAccessMode: 'resolver',
    wallhubSteamAccessHosts: '',
    wallhubSteamAccessResolverProtocol: 'doh',
    wallhubSteamAccessSelectedDohEndpoints: DEFAULT_STEAM_ACCESS_SELECTED_DOH_ENDPOINTS,
    wallhubSteamAccessCustomDohEndpoints: [],
    wallhubSteamAccessSelectedDotEndpoints: DEFAULT_STEAM_ACCESS_SELECTED_DOT_ENDPOINTS,
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
    wallhubSteamAccessStaticCdnHosts: DEFAULT_STATIC_CDN_HOST_CONTROLS,
    depotStreamCacheMaxMb: 512,
  });
  const [queueBusyIds, setQueueBusyIds] = React.useState<Set<string>>(() => new Set());
  const pageVisible = usePageVisible();
  const systemTheme = useSystemTheme();
  React.useEffect(() => {
    const update = () => setShowHomeScrollTop(window.scrollY > 360);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);
  const scrollHomeTop = React.useCallback(() => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  const queryCacheRef = React.useRef(new Map<string, WorkshopCacheEntry & { cachedAt: number }>());
  const detailsCacheRef = React.useRef(new Map<string, DetailsCacheEntry>());
  const personalSourceCacheRef = React.useRef(new Map<string, string>());
  const queryRequestRef = React.useRef(0);
  const loginPromptRef = React.useRef({ lastAt: 0, lastKey: '' });
  const queueOptimisticRef = React.useRef<{ until: number; ids: string[] } | null>(null);
  const queueDeleteTombstonesRef = React.useRef(new Map<string, QueueDeleteTombstone>());
  const queueRefreshRequestRef = React.useRef(0);
  const queueRefreshInFlightRef = React.useRef<Promise<void> | null>(null);
  const queueRefreshPendingRef = React.useRef(false);
  const cachedItemsRefreshRef = React.useRef<Promise<void> | null>(null);
  const cachedItemsRefreshPendingRef = React.useRef(false);
  const cachedQueueItemsRef = React.useRef<QueueTask[]>([]);
  const queueStatusRef = React.useRef(new Map<string, string>());
  const visibleRefreshReadyRef = React.useRef(false);
  const runtimeRequestRef = React.useRef<Promise<RuntimeStatus> | null>(null);
  const runtimeDiagnosticsRequestRef = React.useRef<Promise<void> | null>(null);
  const settingsHostsLoadedRef = React.useRef(false);
  const settingsHostsRequestRef = React.useRef<Promise<void> | null>(null);
  const videoPlayRequestRef = React.useRef<{ token: number; controller: AbortController } | null>(null);
  const searchRequestRef = React.useRef<AbortController | null>(null);
  const prefetchRequestRef = React.useRef<AbortController | null>(null);
  const prefetchRequestTokenRef = React.useRef(0);
  const videoCdnToastRef = React.useRef('');
  const steamWebApiToastRef = React.useRef(0);
  const forceRefreshRef = React.useRef(false); // logo 点击强制刷新（跳过后端缓存）
  const backgroundDetailsTokenRef = React.useRef(0);
  const backgroundDetailsCancelRef = React.useRef<(() => void) | null>(null);
  const homeCardActionRef = React.useRef<(item: WorkshopItem) => void>(() => {});
  const text = React.useMemo(() => textFor(language), [language]);

  const nsfw = !!runtime?.nsfwEnabled;
  const { containerRef, columns: gridColumns } = useWallpaperLayout(view, mobileColumns, desktopColumns);
  const pageSize = homePageSize;
  const totalPages = Math.max(1, serverTotalPages || Math.ceil(total / pageSize));
  const activeTasks = queue.filter((task) => ['pending', 'downloading', 'moving'].includes(task.status || '')).length;
  const runtimeSetupBusy = isRuntimeSetupActive(runtime?.runtimeSetup?.status);
  const resolvedTheme = themeMode === 'system' ? systemTheme : themeMode;

  const toast = React.useCallback((message: string, type: Toast['type'] = 'info', timeoutMs = 3200) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, type }]);
    if (timeoutMs > 0) {
      window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), timeoutMs);
    }
    return id;
  }, []);
  const updateToast = React.useCallback((id: number, message: string, type?: Toast['type']) => {
    setToasts((current) => current.map((item) => item.id === id ? { ...item, message, type: type || item.type } : item));
  }, []);
  const dismissToast = React.useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);

  const requestLogin = React.useCallback(
    (errorLike?: unknown, force = true) => {
      if (errorLike && !isSteamLoginError(errorLike)) return false;
      if (!force && steam?.loggedIn) return true;
      const error = errorLike as { code?: string; id?: string | number; cacheKey?: string | number };
      const key = `${error?.code || 'STEAM_LOGIN_REQUIRED'}:${error?.id || error?.cacheKey || ''}`;
      const now = Date.now();
      const recentlyPrompted = key === loginPromptRef.current.lastKey && now - loginPromptRef.current.lastAt < (force ? 8000 : 10 * 60 * 1000);
      if (loginOpen || recentlyPrompted) return true;
      if (!loginOpen) {
        toast(text.loginRequired, 'warn');
        setLoginOpen(true);
      }
      loginPromptRef.current = { lastAt: now, lastKey: key };
      return true;
    },
    [loginOpen, steam?.loggedIn, text.loginRequired, toast],
  );

  React.useEffect(() => {
    if (homeFilterMultiSelect) return;
    setFilters((current) => {
      const ratings = normalizeRatings([current.rating], nsfw);
      const rating = primaryRating(ratings, nsfw);
      return rating === current.rating && JSON.stringify(ratings) === JSON.stringify(current.ratings)
        ? current
        : { ...current, rating, ratings };
    });
  }, [homeFilterMultiSelect, nsfw]);

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('light', resolvedTheme === 'light');
    root.dataset.accent = accentTheme;
    if (accentTheme === 'custom') applyCustomAccentVariables(root, customAccentColor, resolvedTheme === 'light');
    else clearCustomAccentVariables(root);
    root.lang = language === 'en' ? 'en' : 'zh-CN';
    document.title = language === 'en' ? 'WallHub · Steam Workshop Wallpapers' : 'WallHub · Steam 壁纸工坊';
    markSearchSessionActive();
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        filters,
        exactPhrase,
        homeFilterMultiSelect,
        view,
        themeMode,
        accentTheme,
        customAccentColor,
        mobileColumns,
        desktopColumns,
        homePageSize,
        prefetchNextPage,
        language,
        fixedPanelHeight,
        detailsPresentation,
        homeCardDefaultAction,
        homeCardDefaultActionVersion: 3,
      }),
    );
  }, [accentTheme, customAccentColor, desktopColumns, detailsPresentation, exactPhrase, filters, fixedPanelHeight, homeCardDefaultAction, homeFilterMultiSelect, homePageSize, language, mobileColumns, prefetchNextPage, resolvedTheme, themeMode, view]);
  const fetchRuntime = React.useCallback(() => {
    if (runtimeRequestRef.current) return runtimeRequestRef.current;
    const request = getRuntime().finally(() => {
      if (runtimeRequestRef.current === request) runtimeRequestRef.current = null;
    });
    runtimeRequestRef.current = request;
    return request;
  }, []);

  const refreshRuntime = React.useCallback(async () => {
    try {
      const data = await fetchRuntime();
      setRuntime((current) => (current?.revision === data.revision ? current : data));
      setFilters((current) => {
        const ratings = normalizeRatings(current.ratings, !!data.nsfwEnabled, undefined, current.rating);
        const rating = primaryRating(ratings, !!data.nsfwEnabled);
        return rating === current.rating && JSON.stringify(ratings) === JSON.stringify(current.ratings)
          ? current
          : { ...current, rating, ratings };
      });
    } catch (e) {
      console.warn('[runtime]', e);
    }
  }, [fetchRuntime]);

  const refreshRuntimeDiagnostics = React.useCallback(() => {
    if (runtimeDiagnosticsRequestRef.current) return runtimeDiagnosticsRequestRef.current;
    const request = getRuntimeDiagnostics()
      .then((data) => {
        setRuntimeDiagnostics((current) => (current?.revision === data.revision ? current : data));
      })
      .catch((error) => {
        console.warn('[runtime-diagnostics]', error);
      })
      .finally(() => {
        if (runtimeDiagnosticsRequestRef.current === request) runtimeDiagnosticsRequestRef.current = null;
      });
    runtimeDiagnosticsRequestRef.current = request;
    return request;
  }, []);

  const refreshSteamStatus = React.useCallback(async () => {
    try {
      const data = await getSteamStatus();
      setSteam((current) => (samePayload(current, data) ? current : data));
    } catch (e) {
      console.warn('[steam]', e);
    }
  }, []);

  React.useEffect(() => {
    refreshRuntime();
    refreshSteamStatus();
  }, [refreshRuntime, refreshSteamStatus]);

  React.useEffect(() => {
    if (!pageVisible) return;
    if (!settingsOpen && !runtimeSetupBusy) return;
    const intervalMs = runtimeSetupBusy || activeTasks ? 1000 : 15000;
    const timer = window.setInterval(() => {
      refreshRuntime();
      if (settingsOpen) refreshSteamStatus();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [activeTasks, pageVisible, refreshRuntime, refreshSteamStatus, runtimeSetupBusy, settingsOpen]);

  React.useEffect(() => {
    if (!pageVisible || !settingsOpen) return;
    refreshRuntimeDiagnostics();
    const timer = window.setInterval(refreshRuntimeDiagnostics, 30000);
    return () => window.clearInterval(timer);
  }, [pageVisible, refreshRuntimeDiagnostics, settingsOpen]);

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
    const loadSettings = async () => {
      try {
        const data = await getSettings();
        settingsHostsLoadedRef.current = !data.wallhubSteamAccessHostsDeferred;
        setSettingsHostsLoaded(settingsHostsLoadedRef.current);
        const accessEnhance = !!data.wallhubSteamAccessEnhance;
        setMpkgCompactAvailable(data.mpkgCompactAvailable === true);
        setMpkgCompactUnavailableReason(String(data.mpkgCompactUnavailableReason || ''));
        setSettingsForm({
          steamApiKey: data.steamApiKey || '',
          wallhubLogLevel: normalizeWallhubLogLevel(data.wallhubLogLevel),
          mpkgTextureProfile: data.mpkgCompactAvailable === true && data.mpkgTextureProfile === 'compact' ? 'compact' : 'fast',
          useSteamApi: !!data.useSteamApi,
          downloadDir: data.downloadDir || '',
          maxConcurrentDownloads: normalizeConcurrentDownloads(data.maxConcurrentDownloads),
          steamCdnRouteStrategy: normalizeSteamCdnRouteStrategy(data.steamCdnRouteStrategy),
          steamHttpProxyUrl: data.steamHttpProxyUrl || '',
          steamKitMaxDownloads: normalizeSteamKitMaxDownloads(data.steamKitMaxDownloads),
          effectiveSteamKitMaxDownloads: normalizeSteamKitMaxDownloads(data.effectiveSteamKitMaxDownloads),
          steamKitDepotStreaming: !!data.steamKitDepotStreaming,
          workshopHtmlOrderMode: !!data.workshopHtmlOrderMode,
          wallhubSteamAccessEnhance: accessEnhance,
          wallhubSteamAccessDirectWebApi: !!data.wallhubSteamAccessDirectWebApi,
          wallhubSteamWebApiRoute: data.wallhubSteamWebApiRoute || (data.wallhubSteamAccessDirectWebApi ? 'direct' : 'follow'),
          wallhubSteamWebApiProtocol: data.wallhubSteamWebApiProtocol || ('https' as const),
          wallhubSteamWebApiHost: data.wallhubSteamWebApiHost || ('api.steampowered.com' as const),
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
        });
      } catch (e) {
        console.warn('[settings]', e);
      }
    };
    loadSettings();
  }, []);

  const refreshCachedItems = React.useCallback(() => {
    if (cachedItemsRefreshRef.current) {
      cachedItemsRefreshPendingRef.current = true;
      return cachedItemsRefreshRef.current;
    }
    const request = getCachedItems()
      .then((data) => {
        const cached = filterQueueTasksAfterDelete(data.items || [], queueDeleteTombstonesRef.current);
        cachedQueueItemsRef.current = cached;
        setQueue((current) => {
          const queueTasks = current.filter((item) => item.source !== 'cache');
          const nextItems = mergeQueueItems(queueTasks, cached);
          return queueSignature(current) === queueSignature(nextItems) ? current : nextItems;
        });
      })
      .catch((error) => {
        console.warn('[cache-items]', error);
      })
      .finally(() => {
        if (cachedItemsRefreshRef.current !== request) return;
        cachedItemsRefreshRef.current = null;
        if (cachedItemsRefreshPendingRef.current) {
          cachedItemsRefreshPendingRef.current = false;
          void refreshCachedItems();
        }
      });
    cachedItemsRefreshRef.current = request;
    return request;
  }, []);

  const refreshQueue = React.useCallback(() => {
    if (queueRefreshInFlightRef.current) {
      queueRefreshPendingRef.current = true;
      return queueRefreshInFlightRef.current;
    }
    const requestId = ++queueRefreshRequestRef.current;
    const request = getQueue()
      .then((data) => {
      if (requestId !== queueRefreshRequestRef.current) return;
      const nextTasks = filterQueueTasksAfterDelete(
        data.tasks || [],
        queueDeleteTombstonesRef.current,
      );
      const previousStatuses = queueStatusRef.current;
      const nextStatuses = new Map(nextTasks.map((task) => [String(task.id || task.cacheKey || ''), String(task.status || '')]));
      queueStatusRef.current = nextStatuses;
      const completedNow = nextTasks.some((task) => {
        const id = String(task.id || task.cacheKey || '');
        return task.status === 'completed' && previousStatuses.get(id) !== 'completed';
      });
      if (completedNow) void refreshCachedItems();
      const nextItems = filterQueueTasksAfterDelete(
        mergeQueueItems(nextTasks, cachedQueueItemsRef.current),
        queueDeleteTombstonesRef.current,
      );
      const optimistic = queueOptimisticRef.current;
      const nextIds = nextItems.map((task) => String(task.id || task.cacheKey || ''));
      if (optimistic && Date.now() < optimistic.until && JSON.stringify(nextIds) !== JSON.stringify(optimistic.ids)) {
        setQueue((current) => {
          const nextById = new Map(nextItems.map((task) => [String(task.id || task.cacheKey || ''), task]));
          const merged = current.map((task) => {
            const taskId = String(task.id || task.cacheKey || '');
            return { ...task, ...(nextById.get(taskId) || {}) };
          });
          const currentIds = new Set(current.map((task) => String(task.id || task.cacheKey || '')));
          return merged.concat(nextItems.filter((task) => !currentIds.has(String(task.id || task.cacheKey || ''))));
        });
      } else {
        queueOptimisticRef.current = null;
        setQueue((current) => (queueSignature(current) === queueSignature(nextItems) ? current : nextItems));
      }
      const loginTask = nextTasks.find((task) => task.status === 'error' && isSteamLoginError(task));
      if (loginTask) {
        const loginTaskId = String(loginTask.id || loginTask.cacheKey || '');
        setVideo((current) => (current && String(current.id || '') === loginTaskId ? null : current));
        requestLogin(loginTask, false);
      }
      })
      .catch((error) => {
        console.warn('[queue]', error);
      })
      .finally(() => {
        if (queueRefreshInFlightRef.current !== request) return;
        queueRefreshInFlightRef.current = null;
        if (queueRefreshPendingRef.current) {
          queueRefreshPendingRef.current = false;
          void refreshQueue();
        }
      });
    queueRefreshInFlightRef.current = request;
    return request;
  }, [refreshCachedItems, requestLogin]);

  React.useEffect(() => {
    if (!pageVisible) return;
    if (!queueOpen && !activeTasks) return;
    refreshQueue();
    const timer = window.setInterval(refreshQueue, activeTasks ? 1000 : 10000);
    return () => window.clearInterval(timer);
  }, [activeTasks, pageVisible, queueOpen, refreshQueue]);

  React.useEffect(() => {
    if (queueOpen) void refreshCachedItems();
  }, [queueOpen, refreshCachedItems]);

  React.useEffect(() => {
    if (!video || !pageVisible) return;
    const watchSince = Number(video.cdnWatchSince || Date.now());
    const expiresAt = Date.now() + 12000;
    let closed = false;
    const pollCdn = async () => {
      if (closed) return;
      try {
        const data = await fetchRuntime();
        setRuntime((current) => (current?.revision === data.revision ? current : data));
        const host = String(data.steamCdn?.currentHost || '').trim();
        const updatedAt = Number(data.steamCdn?.updatedAt || 0);
        const key = `${video.id || ''}:${host}:${updatedAt}`;
        if (host && updatedAt >= watchSince - 1000 && videoCdnToastRef.current !== key) {
          videoCdnToastRef.current = key;
          toast(`${text.currentCdnNode}: ${host}`, 'info');
          closed = true;
        }
      } catch (e) {
        console.warn('[runtime-cdn]', e);
      }
    };
    pollCdn();
    const timer = window.setInterval(() => {
      if (Date.now() >= expiresAt) {
        window.clearInterval(timer);
        return;
      }
      pollCdn();
    }, 1000);
    return () => {
      closed = true;
      window.clearInterval(timer);
    };
  }, [fetchRuntime, pageVisible, text.currentCdnNode, toast, video]);

  React.useEffect(() => {
    const src = video?.src;
    return () => releaseDepotVideoStream(src);
  }, [video?.src]);

  React.useEffect(() => {
    const releaseCurrentVideo = () => releaseDepotVideoStream(video?.src);
    window.addEventListener('pagehide', releaseCurrentVideo);
    return () => window.removeEventListener('pagehide', releaseCurrentVideo);
  }, [video?.src]);

  React.useEffect(() => {
    if (!pageVisible) return;
    if (!visibleRefreshReadyRef.current) {
      visibleRefreshReadyRef.current = true;
      return;
    }
    refreshRuntime();
    refreshQueue();
    if (settingsOpen || loginOpen) refreshSteamStatus();
  }, [loginOpen, pageVisible, refreshQueue, refreshRuntime, refreshSteamStatus, settingsOpen]);

  const effectiveExactPhrase = !!filters.search.trim() && exactPhrase;

  const scheduleBackgroundDetails = React.useCallback((baseItems: WorkshopItem[], cacheKey: string, totalValue: number, requestId: number) => {
    const needsDetails = baseItems.filter((item) => {
      const tags = Array.isArray(item.tags) ? item.tags : [];
      const preview = String(item.preview_url || '');
      return !preview || /[?&](?:ima|impolicy)=/i.test(preview) || !tags.length || !item.file_size || item.file_size === '未知';
    });
    if (!needsDetails.length) return;

    const token = ++backgroundDetailsTokenRef.current;
    backgroundDetailsCancelRef.current?.();
    backgroundDetailsCancelRef.current = scheduleIdleTask(() => {
      getDetailsBatch(needsDetails.slice(0, 12).map((item) => item.publishedfileid))
      .then((detailItems) => {
        if (token !== backgroundDetailsTokenRef.current || requestId !== queryRequestRef.current || !detailItems.length) return;
        const detailsById = new Map(detailItems.map((item) => [String(item.publishedfileid), item]));
        const mergeItem = (item: WorkshopItem): WorkshopItem => {
          const detail = detailsById.get(String(item.publishedfileid));
          if (!detail) return item;
          return {
            ...item,
            ...detail,
            title: detail.title || item.title,
            preview_url: detail.preview_url || item.preview_url,
            short_description: detail.short_description || item.short_description,
            author: detail.author || item.author,
            creator: detail.creator || item.creator,
            tags: detail.tags && detail.tags.length ? detail.tags : item.tags,
          };
        };
        setSuppressGridLayoutAnimation(true);
        setItems((current) => current.map(mergeItem));
        window.requestAnimationFrame(() => setSuppressGridLayoutAnimation(false));
        const previous = queryCacheRef.current.get(cacheKey);
        const sourceItems = previous && previous.items.length ? previous.items : baseItems;
        queryCacheRef.current.set(cacheKey, {
          pageSize,
          items: sourceItems.map(mergeItem),
          total: previous?.total || totalValue,
          totalPages: previous?.totalPages,
          source: previous?.source,
          fallbackUsed: previous?.fallbackUsed,
          cachedAt: Date.now(),
        });
        pruneWorkshopCache(queryCacheRef.current, {
          ttlMs: WORKSHOP_QUERY_CACHE_TTL_MS,
          maxEntries: MAX_WORKSHOP_QUERY_CACHE_ENTRIES,
        });
      })
      .catch((e) => console.warn('[details-batch]', e));
    });
  }, [pageSize]);

  const cancelNextPagePrefetch = React.useCallback(() => {
    prefetchRequestTokenRef.current += 1;
    prefetchRequestRef.current?.abort();
    prefetchRequestRef.current = null;
  }, []);

  const prefetchFollowingPage = React.useCallback((currentPage: number, currentTotalPages: number) => {
    const nextPage = currentPage + 1;
    const alreadyCached = !!findWorkshopCacheEntry(queryCacheRef.current, filters, nextPage, pageSize, effectiveExactPhrase);
    const plan = getNextPagePrefetchPlan({
      enabled: prefetchNextPage,
      page: currentPage,
      totalPages: currentTotalPages,
      alreadyCached,
    });
    if (!plan) return;

    cancelNextPagePrefetch();
    const controller = new AbortController();
    const token = prefetchRequestTokenRef.current;
    prefetchRequestRef.current = controller;
    const cacheKey = workshopCacheKey(filters, plan.page, pageSize, effectiveExactPhrase);
    void queryWorkshop(buildQuery(filters, plan.page, pageSize, effectiveExactPhrase, nsfw), { signal: controller.signal })
      .then((data) => {
        if (token !== prefetchRequestTokenRef.current || controller.signal.aborted) return;
        const totalValue = data.total || data.items.length;
        const nextEntry = {
          pageSize,
          items: data.items,
          total: totalValue,
          totalPages: Math.max(1, data.totalPages || Math.ceil(totalValue / pageSize)),
          source: data.source,
          fallbackUsed: data.fallbackUsed,
          cachedAt: Date.now(),
        };
        const previous = queryCacheRef.current.get(cacheKey);
        if (!previous || previous.items.length <= nextEntry.items.length) queryCacheRef.current.set(cacheKey, nextEntry);
        pruneWorkshopCache(queryCacheRef.current, {
          ttlMs: WORKSHOP_QUERY_CACHE_TTL_MS,
          maxEntries: MAX_WORKSHOP_QUERY_CACHE_ENTRIES,
        });
      })
      .catch((error) => {
        if (!controller.signal.aborted) console.warn('[next-page-prefetch]', error);
      })
      .finally(() => {
        if (token === prefetchRequestTokenRef.current && prefetchRequestRef.current === controller) prefetchRequestRef.current = null;
      });
  }, [cancelNextPagePrefetch, effectiveExactPhrase, filters, nsfw, pageSize, prefetchNextPage]);

  React.useEffect(() => {
    if (!prefetchNextPage) cancelNextPagePrefetch();
  }, [cancelNextPagePrefetch, prefetchNextPage]);

  React.useEffect(() => () => cancelNextPagePrefetch(), [cancelNextPagePrefetch]);

  const loadItems = React.useCallback(async () => {
    // 消费强制刷新标记（来自 Logo 点击），只影响紧接着的这一次加载
    const forceThis = forceRefreshRef.current;
    if (forceThis) {
      forceRefreshRef.current = false;
    }

    const cacheKey = workshopCacheKey(filters, page, pageSize, effectiveExactPhrase);
    // 强制刷新时忽略前端本地缓存
    const cached = forceThis ? null : findWorkshopCacheEntry(queryCacheRef.current, filters, page, pageSize, effectiveExactPhrase);
    if (cached) {
      setError('');
      setItems(cached.items.slice(0, pageSize));
      setTotal(cached.total);
      setServerTotalPages(cached.totalPages || Math.ceil(cached.total / pageSize));
      setDataSource(cached.source || '');
      setFallbackUsed(!!cached.fallbackUsed);
      setLoading(false);
      scheduleBackgroundDetails(cached.items.slice(0, pageSize), cacheKey, cached.total, queryRequestRef.current);
      prefetchFollowingPage(page, cached.totalPages || Math.ceil(cached.total / pageSize));
      return;
    }

    const requestId = ++queryRequestRef.current;
    if (searchRequestRef.current) searchRequestRef.current.abort();
    const searchController = new AbortController();
    searchRequestRef.current = searchController;
    setItems([]);
    setLoading(true);
    setError('');
    try {
      const queryParams = buildQuery(filters, page, pageSize, effectiveExactPhrase, nsfw);
      if (forceThis) {
        queryParams._refresh = 1;
      }
      if (settingsForm.wallhubSteamAccessEnhance) {
        setWarmingSteamIp(true);
        await waitSteamAccessReady({ signal: searchController.signal });
        if (requestId !== queryRequestRef.current) return;
        setWarmingSteamIp(false);
      }
      const data = await queryWorkshop(queryParams, { signal: searchController.signal });
      if (requestId !== queryRequestRef.current) return;
      if (data.warningCode === 'STEAM_WEBAPI_SLOW_OR_FAILED' && Date.now() - steamWebApiToastRef.current > 30000) {
        steamWebApiToastRef.current = Date.now();
        toast('api.steampowered.com 加载较慢或失败，可在实验性选项中调整 API 域名控制以改善连接。', 'warn');
      }
      const responseTotal = data.total || data.items.length;
      const responseTotalPages = Math.max(1, data.totalPages || Math.ceil(responseTotal / pageSize));
      if (!data.items.length && responseTotal > 0 && page > responseTotalPages) {
        setTotal(responseTotal);
        setLoading(false);
        setPage(responseTotalPages);
        return;
      }
      const nextEntry = { pageSize, items: data.items, total: responseTotal, totalPages: responseTotalPages, source: data.source, fallbackUsed: data.fallbackUsed, cachedAt: Date.now() };
      // 只有非强制刷新的正常加载才写入前端本地缓存
      // 强制刷新（logo 点击）是实时的，不保存到缓存中
      if (!forceThis) {
        const previous = queryCacheRef.current.get(cacheKey);
        if (!previous || previous.items.length <= nextEntry.items.length) {
          queryCacheRef.current.set(cacheKey, nextEntry);
        }
        pruneWorkshopCache(queryCacheRef.current, {
          ttlMs: WORKSHOP_QUERY_CACHE_TTL_MS,
          maxEntries: MAX_WORKSHOP_QUERY_CACHE_ENTRIES,
        });
      }
      setItems(data.items);
      setTotal(responseTotal);
      setServerTotalPages(responseTotalPages);
      setDataSource(data.source || '');
      setFallbackUsed(!!data.fallbackUsed);
      scheduleBackgroundDetails(data.items, cacheKey, responseTotal, requestId);
      prefetchFollowingPage(page, responseTotalPages);
    } catch (e) {
      if (requestId !== queryRequestRef.current) return;
      if (e instanceof DOMException && e.name === 'AbortError') return;
      if (e instanceof Error && e.name === 'AbortError') return;
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
      setTotal(0);
      setServerTotalPages(0);
      setDataSource('');
      setFallbackUsed(false);
    } finally {
      if (requestId === queryRequestRef.current) {
        if (searchRequestRef.current === searchController) searchRequestRef.current = null;
        setWarmingSteamIp(false);
        setLoading(false);
      }
      // 兜底：确保标记被清除（正常情况下已在上面消费）
      if (forceThis) forceRefreshRef.current = false;
    }
  }, [effectiveExactPhrase, filterRefreshToken, filters, nsfw, page, pageSize, prefetchFollowingPage, scheduleBackgroundDetails, settingsForm.wallhubSteamAccessEnhance, toast]);

  React.useEffect(() => {
    loadItems();
  }, [loadItems]);

  React.useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [page]);

  React.useEffect(() => {
    personalSourceCacheRef.current.clear();
    setPersonalSourceLabel('');
  }, [steam?.loggedIn, steam?.username]);

  React.useEffect(() => {
    if (!selected) {
      setDetails(null);
      setDetailsLoading(false);
      return;
    }
    const id = String(selected.publishedfileid);
    const cached = readDetailsCache(detailsCacheRef.current, id);
    if (cached) {
      setDetails(cached);
      setDetailsLoading(false);
      return;
    }
    let cancelled = false;
    setDetails(null);
    setDetailsLoading(true);
    getDetails(id)
      .then((data) => {
        if (cancelled) return;
        writeDetailsCache(detailsCacheRef.current, id, data);
        setDetails(data);
      })
      .catch((e) => {
        if (cancelled) return;
        console.warn('[details]', e);
        setDetails(null);
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  React.useEffect(() => {
    const filter = String(filters.personalFilter || '').trim().toLowerCase();
    if (!selected || !filter) {
      setPersonalSourceLabel('');
      return;
    }

    const author = String(details?.author || selected.author || '').trim();
    if (filter === 'myfavorites') {
      setPersonalSourceLabel('我的收藏');
      return;
    }
    if (filter === 'voted') {
      setPersonalSourceLabel('我的投票');
      return;
    }
    if (filter === 'friendscreated') {
      setPersonalSourceLabel(author ? `好友 ${author} 创建` : '好友创建');
      return;
    }
    if (filter === 'followedcreated') {
      setPersonalSourceLabel(author ? `关注者 ${author} 创建` : '关注者创建');
      return;
    }
    if (filter !== 'friendsfavorites') {
      setPersonalSourceLabel('');
      return;
    }

    const id = String(selected.publishedfileid || '');
    const cacheKey = `${filter}:${id}`;
    const cached = personalSourceCacheRef.current.get(cacheKey);
    if (cached) {
      setPersonalSourceLabel(cached);
      return;
    }
    let cancelled = false;
    setPersonalSourceLabel('好友收藏');
    getPersonalSource(id, filter)
      .then((result) => {
        if (cancelled) return;
        const label = String(result.label || '好友收藏');
        personalSourceCacheRef.current.set(cacheKey, label);
        setPersonalSourceLabel(label);
      })
      .catch((error) => {
        if (!cancelled) console.warn('[personal-source]', error);
      });
    return () => { cancelled = true; };
  }, [selected, details?.author, filters.personalFilter]);

  const loadMoreComments = React.useCallback(async (id: string) => {
    const current = String(details?.publishedfileid || '') === id
      ? details
      : readDetailsCache(detailsCacheRef.current, id);
    if (!current) return;
    const existingCount = current.comments?.length || 0;
    const commentPageSize = Number(current.commentsCount || 10);
    const likelyHasMore = !!current.commentsHasMore || existingCount >= commentPageSize || (existingCount === 0 && Number(current.commentsNextStart || 0) === 0);
    if (!likelyHasMore) return;
    const start = Number(current.commentsNextStart ?? existingCount ?? 0);
    const page = await getComments(id, start, commentPageSize, current.commentsOwnerId || current.creator || '');
    const existing = current.comments || [];
    const seen = new Set(existing.map((comment) => `${comment.author || ''}\u001f${comment.date || comment.timestamp || ''}\u001f${comment.text || ''}`));
    const appended = (page.comments || []).filter((comment) => {
      const key = `${comment.author || ''}\u001f${comment.date || comment.timestamp || ''}\u001f${comment.text || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const next: Details = {
      ...current,
      comments: existing.concat(appended),
      commentsNextStart: page.nextStart ?? start + appended.length,
      commentsTotal: page.total ?? current.commentsTotal,
      commentsOwnerId: page.ownerId || current.commentsOwnerId || current.creator || '',
      commentsHasMore: !!page.hasMore && (page.nextStart ?? start) > start,
      commentsCount: page.count ?? current.commentsCount,
    };
    writeDetailsCache(detailsCacheRef.current, id, next);
    setDetails((value) => (String(value?.publishedfileid || '') === id ? next : value));
  }, [details]);
  const updateFilter = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    const forceFilterRefresh = Object.prototype.hasOwnProperty.call(patch, 'rating') || Object.prototype.hasOwnProperty.call(patch, 'ratings');
    if (forceFilterRefresh) {
      queryCacheRef.current.clear();
      forceRefreshRef.current = true;
    }
    if (JSON.stringify(next) === JSON.stringify(filters)) {
      if (forceFilterRefresh) setFilterRefreshToken((value) => value + 1);
      return;
    }
    setPage(1);
    setFilters(next);
  };

  const reportDownloadClick = (item: WorkshopItem, action: string, source = 'wallpaper-card') => {
    reportClientEvent({
      event: 'download-click',
      action,
      source,
      id: String(item.publishedfileid || ''),
      title: item.title || '',
      itemType: item.workshopType || '',
    });
  };

  const openDownloadChoice = (item: WorkshopItem) => {
    reportDownloadClick(item, 'open-download-choice');
    setDownloadChoice(item);
  };
  const doClientDownload = async (item: WorkshopItem) => {
    reportDownloadClick(item, 'client-download');
    const title = item.title || `Wallpaper ${item.publishedfileid}`;
    toast(text.clientPreparing, 'info');
    refreshQueue();
    const queueRefreshTimer = window.setInterval(refreshQueue, 1000);
    try {
      await clientDownload(item.publishedfileid, title);
      toast(text.clientSent, 'ok');
      refreshQueue();
    } catch (e) {
      if (!requestLogin(e)) toast(e instanceof Error ? e.message : String(e), 'warn');
      refreshQueue();
    } finally {
      window.clearInterval(queueRefreshTimer);
    }
  };

  const doMpkgDownload = async (item: WorkshopItem) => {
    reportDownloadClick(item, 'mpkg-download');
    const title = item.title || `Wallpaper ${item.publishedfileid}`;
    const preparingToastId = toast(text.mpkgPreparing, 'info', 0);
    let lastElapsedSeconds = 0;
    refreshQueue();
    const queueRefreshTimer = window.setInterval(refreshQueue, 1000);
    try {
      await mpkgDownload(item.publishedfileid, title, {
        textureProfile: settingsForm.mpkgTextureProfile,
        onPreparing: (preparation) => {
          const elapsedSeconds = Math.max(0, Math.floor(Number(preparation.elapsedMs || 0) / 1000));
          if (elapsedSeconds <= lastElapsedSeconds) return;
          lastElapsedSeconds = elapsedSeconds;
          updateToast(preparingToastId, text.mpkgPreparingProgress.replace('{seconds}', String(elapsedSeconds)));
        },
      });
      dismissToast(preparingToastId);
      toast(text.mpkgSent, 'ok');
      refreshQueue();
    } catch (e) {
      dismissToast(preparingToastId);
      if (!requestLogin(e)) toast(e instanceof Error ? e.message : String(e), 'warn');
      refreshQueue();
    } finally {
      dismissToast(preparingToastId);
      window.clearInterval(queueRefreshTimer);
    }
  };

  const doBackgroundDownload = async (item: WorkshopItem) => {
    reportDownloadClick(item, 'background-download');
    try {
      const data = await backgroundDownload(item.publishedfileid, item.title || '');
      toast(data.message || text.queuedDownload, 'ok');
      refreshQueue();
    } catch (e) {
      if (!requestLogin(e)) toast(e instanceof Error ? e.message : String(e), 'warn');
    }
  };

  const closeVideo = React.useCallback(() => {
    if (videoPlayRequestRef.current) {
      videoPlayRequestRef.current.controller.abort();
      videoPlayRequestRef.current = null;
    }
    releaseDepotVideoStream(video?.src);
    setVideo(null);
  }, [video?.src]);

  const doPlayVideo = async (item: WorkshopItem) => {
    reportDownloadClick(item, 'play-video');
    const id = String(item.publishedfileid);
    const title = item.title || text.videoPlayer;
    const cdnWatchSince = Date.now();
    if (videoPlayRequestRef.current) videoPlayRequestRef.current.controller.abort();
    releaseDepotVideoStream(video?.src);
    const controller = new AbortController();
    const token = cdnWatchSince + Math.random();
    videoPlayRequestRef.current = { token, controller };
    setVideo({ id, title, status: 'loading', message: text.videoPreparing, cdnWatchSince });
    try {
      const data = await playVideo(item.publishedfileid, item.title || '', controller.signal);
      if (videoPlayRequestRef.current?.token !== token) return;
      const cdnHost = String(data.cdnHost || '').trim();
      if (cdnHost) {
        const key = `${id}:${cdnHost}:${cdnWatchSince}`;
        if (videoCdnToastRef.current !== key) {
          videoCdnToastRef.current = key;
          toast(`${text.currentCdnNode}: ${cdnHost}`, 'info');
        }
      }
      if (data.status === 'ready' && data.streamUrl) {
        setVideo({ id, title, src: data.streamUrl, status: 'ready', cdnWatchSince });
      } else {
        toast(text.videoQueued, 'info');
        setVideo({ id, title, src: data.streamUrl || `/api/video/stream?id=${encodeURIComponent(id)}`, status: 'loading', message: text.videoPreparing, cdnWatchSince });
        refreshQueue();
      }
    } catch (e) {
      if ((e as Error)?.name === 'AbortError') return;
      if (videoPlayRequestRef.current?.token !== token) return;
      setVideo(null);
      if (!requestLogin(e)) toast(e instanceof Error ? e.message : String(e), 'warn');
    } finally {
      if (videoPlayRequestRef.current?.token === token) videoPlayRequestRef.current = null;
    }
  };

  const openSteamPage = React.useCallback((item: WorkshopItem) => {
    const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${item.publishedfileid}`;
    window.open(settingsForm.wallhubSteamAccessEnhance ? steamProxyUrl(url) : url, '_blank');
  }, [settingsForm.wallhubSteamAccessEnhance]);

  const handleHomeCardAction = (item: WorkshopItem) => {
    const action = homeCardDefaultAction === 'playVideo' && itemType(item) !== 'Video' ? 'backgroundDownload' : homeCardDefaultAction;
    if (action === 'playVideo') {
      doPlayVideo(item);
      return;
    }
    if (action === 'backgroundDownload') {
      doBackgroundDownload(item);
      return;
    }
    if (action === 'openSteamPage') {
      openSteamPage(item);
      return;
    }
    if (itemType(item) === 'Scene') openDownloadChoice(item);
    else doClientDownload(item);
  };
  homeCardActionRef.current = handleHomeCardAction;
  const onHomeCardDefaultAction = React.useCallback((item: WorkshopItem) => homeCardActionRef.current(item), []);

  const openAuthor = (creator?: string) => {
    if (!creator) return;
    setSelected(null);
    updateFilter({ search: `author:${creator}` });
  };

  const searchByDetailTags = (tags: string[]) => {
    if (!encodeDetailTagSearch(tags)) return;
    setSelected(null);
    updateFilter({ search: encodeDetailTagSearch(tags) });
  };

  const saveSettingsForm = async (patch?: Partial<SettingsForm>) => {
    try {
      const nextSettings = { ...settingsForm, ...(patch || {}) };
      if (!patch || Object.prototype.hasOwnProperty.call(patch, 'steamApiKey')) {
        nextSettings.useSteamApi = !!nextSettings.steamApiKey.trim();
      }
      const payload: Partial<SettingsForm> = patch
        ? { ...patch }
        : { ...nextSettings };
      if (!patch || Object.prototype.hasOwnProperty.call(patch, 'steamApiKey')) {
        payload.useSteamApi = !!nextSettings.steamApiKey.trim();
      }
      if (!settingsHostsLoadedRef.current) {
        delete payload.wallhubSteamAccessHosts;
      }

      const data = await saveSettings(payload);
      const accessEnhance = !!(data.wallhubSteamAccessEnhance ?? nextSettings.wallhubSteamAccessEnhance);
      setMpkgCompactAvailable(data.mpkgCompactAvailable === true);
      setMpkgCompactUnavailableReason(String(data.mpkgCompactUnavailableReason || ''));
      const queryModeChanged = !!patch && (
        Object.prototype.hasOwnProperty.call(patch, 'workshopHtmlOrderMode') ||
        Object.prototype.hasOwnProperty.call(patch, 'useSteamApi') ||
        Object.prototype.hasOwnProperty.call(patch, 'steamApiKey')
      );
      setSettingsForm((current) => ({
        ...current,
        ...nextSettings,
        steamApiKey: data.steamApiKey ?? nextSettings.steamApiKey,
        wallhubLogLevel: normalizeWallhubLogLevel(data.wallhubLogLevel ?? nextSettings.wallhubLogLevel),
        mpkgTextureProfile: data.mpkgCompactAvailable === true && data.mpkgTextureProfile === 'compact' ? 'compact' : 'fast',
        useSteamApi: data.useSteamApi ?? nextSettings.useSteamApi,
        downloadDir: data.downloadDir || nextSettings.downloadDir || current.downloadDir,
        maxConcurrentDownloads: normalizeConcurrentDownloads(data.maxConcurrentDownloads ?? nextSettings.maxConcurrentDownloads),
        steamCdnRouteStrategy: normalizeSteamCdnRouteStrategy(data.steamCdnRouteStrategy ?? nextSettings.steamCdnRouteStrategy),
        steamHttpProxyUrl: data.steamHttpProxyUrl ?? nextSettings.steamHttpProxyUrl,
        steamKitMaxDownloads: normalizeSteamKitMaxDownloads(data.steamKitMaxDownloads ?? nextSettings.steamKitMaxDownloads),
        effectiveSteamKitMaxDownloads: normalizeSteamKitMaxDownloads(data.effectiveSteamKitMaxDownloads ?? nextSettings.effectiveSteamKitMaxDownloads),
        steamKitDepotStreaming: !!(data.steamKitDepotStreaming ?? nextSettings.steamKitDepotStreaming),
        workshopHtmlOrderMode: !!(data.workshopHtmlOrderMode ?? nextSettings.workshopHtmlOrderMode),
        wallhubSteamAccessEnhance: accessEnhance,
        wallhubSteamAccessDirectWebApi: !!(data.wallhubSteamAccessDirectWebApi ?? nextSettings.wallhubSteamAccessDirectWebApi),
        wallhubSteamWebApiRoute: (data.wallhubSteamWebApiRoute ?? nextSettings.wallhubSteamWebApiRoute) || (nextSettings.wallhubSteamAccessDirectWebApi ? 'direct' : 'follow'),
        wallhubSteamWebApiProtocol: data.wallhubSteamWebApiProtocol ?? nextSettings.wallhubSteamWebApiProtocol ?? ('https' as const),
        wallhubSteamWebApiHost: data.wallhubSteamWebApiHost ?? nextSettings.wallhubSteamWebApiHost ?? ('api.steampowered.com' as const),
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
      }));
      if (queryModeChanged) {
        queryCacheRef.current.clear();
        forceRefreshRef.current = true;
        setFilterRefreshToken((value) => value + 1);
      }
      toast(text.settingsSaved, 'ok');
      await refreshRuntime();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'warn');
    }
  };

  const doClearDepotStreamCache = async () => {
    try {
      const result = await clearDepotStreamCache();
      const bytes = Number(result.bytes || 0);
      const suffix = bytes > 0 ? ` · ${formatBytesText(bytes, text)}` : '';
      toast(`${text.depotStreamCacheCleared}${suffix}`, 'ok');
      await refreshRuntime();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'warn');
    }
  };

  const openSettings = () => {
    setSettingsOpen(true);
    refreshRuntime();
    refreshRuntimeDiagnostics();
    loadSettingsDetails();
    refreshSteamStatus();
  };

  const openQueue = () => {
    setQueueOpen(true);
    refreshQueue();
    refreshCachedItems();
  };

  const doQueueAction = async (action: string, id?: string | number) => {
    const snapshot = queue;
    const idText = id == null ? '' : String(id);
    const applyQueueChange = (current: QueueTask[]) => {
      if (!idText) return current;
      const index = current.findIndex((task) => String(task.id || task.cacheKey || '') === idText);
      if (index < 0) return current;
      if (action === 'delete' || action === 'delete_cache') return current.filter((_, itemIndex) => itemIndex !== index);
      if (action === 'up' && index > 0) {
        const next = current.slice();
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        return next;
      }
      if (action === 'down' && index < current.length - 1) {
        const next = current.slice();
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        return next;
      }
      if (action === 'pause') return current.map((task, itemIndex) => (itemIndex === index ? { ...task, status: 'paused' } : task));
      if (action === 'resume') return current.map((task, itemIndex) => (itemIndex === index ? { ...task, status: 'pending' } : task));
      return current;
    };

    if ((action === 'delete' || action === 'delete_cache') && idText) {
      const deletedAt = Date.now();
      queueDeleteTombstonesRef.current.set(idText, { deletedAt, expiresAt: deletedAt + 15000 });
    }

    if (['delete', 'delete_cache', 'up', 'down', 'pause', 'resume'].includes(action)) {
      setQueue((current) => applyQueueChange(current));
      if (idText) {
        setQueueBusyIds((current) => new Set(current).add(idText));
        window.setTimeout(() => {
          setQueueBusyIds((current) => {
            const next = new Set(current);
            next.delete(idText);
            return next;
          });
        }, 380);
      }
    }

    if (['up', 'down'].includes(action)) {
      const optimisticIds = applyQueueChange(queue).map((task) => String(task.id || task.cacheKey || ''));
      queueOptimisticRef.current = { until: Date.now() + 1200, ids: optimisticIds };
    }

    try {
      await queueAction(action, id);
      if (action === 'delete' || action === 'delete_cache') toast(text.deleted, 'ok');
      queueOptimisticRef.current = null;
      if (['delete', 'delete_cache', 'clear_completed'].includes(action)) await refreshCachedItems();
      refreshQueue();
    } catch (e) {
      queueOptimisticRef.current = null;
      if ((action === 'delete' || action === 'delete_cache') && idText) {
        queueDeleteTombstonesRef.current.delete(idText);
      }
      setQueue(snapshot);
      toast(e instanceof Error ? e.message : String(e), 'warn');
      refreshQueue();
    }
  };

  const resetHome = React.useCallback(() => {
    setSelected(null);
    setQueueOpen(false);
    setSettingsOpen(false);
    setGenreOpen(false);
    setPage(1);
    setFilters(defaultHomeFilters(GENRES, TEXT.zh));
    // 清空前端本地缓存，并标记强制刷新（下次 loadItems 向后端带刷新参数）
    queryCacheRef.current.clear();
    detailsCacheRef.current.clear();
    forceRefreshRef.current = true;
  }, []);

  React.useEffect(() => {
    const activated = { settings: settingsOpen, queue: queueOpen, details: !!selected, login: loginOpen, video: !!video };
    if (Object.entries(activated).some(([key, value]) => value && !loadedDialogs[key as keyof typeof loadedDialogs])) {
      setLoadedDialogs((current) => ({
        settings: current.settings || activated.settings,
        queue: current.queue || activated.queue,
        details: current.details || activated.details,
        login: current.login || activated.login,
        video: current.video || activated.video,
      }));
    }
  }, [loadedDialogs, loginOpen, queueOpen, selected, settingsOpen, video]);

  return (
    <LanguageContext.Provider value={{ language, text }}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.2 }}
        className="min-h-screen bg-background"
      >
        <Header
          filters={filters}
          setFilters={updateFilter}
          exactPhrase={exactPhrase}
          setExactPhrase={setExactPhrase}
          onHome={resetHome}
          onSettings={openSettings}
          onQueue={openQueue}
          queueCount={activeTasks}
        />

        <FilterBar
          filters={filters}
          homeFilterMultiSelect={homeFilterMultiSelect}
          nsfw={nsfw}
          genresCount={filters.genres.length}
          totalGenres={GENRES.length}
          view={view}
          setView={setView}
          setFilters={updateFilter}
          onGenres={() => setGenreOpen(true)}
          steamLoggedIn={!!steam?.loggedIn}
          onLoginRequired={() => requestLogin({ requiresSteamLogin: true })}
        />

        <main ref={containerRef} className="mx-auto w-full max-w-6xl px-3 pb-20 pt-2 sm:px-6 sm:pb-24 sm:pt-6">
          <section className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-5 sm:gap-3">
            <div>
              <h1 className="text-base font-semibold tracking-tight sm:text-lg">{text.homeTitle}</h1>
              <p className="text-xs text-muted-foreground sm:text-sm">
                {loading
                  ? (warmingSteamIp ? text.warmingSteamIp : text.loading)
                  : total
                    ? language === 'en'
                      ? `${text.homeApprox} ${total.toLocaleString('en-US')} ${text.homeItems} · ${totalPages} ${text.homePagesSuffix}`
                      : `${text.homeApprox} ${total.toLocaleString('zh-CN')} ${text.homeItems} · ${text.homePagesPrefix} ${totalPages} ${text.homePagesSuffix}`
                    : text.noResults}
                {!loading && dataSource ? ` · ${sourceLabel(dataSource, fallbackUsed, language)}` : ''}
              </p>
            </div>
            <ViewToggle view={view} setView={setView} className="lg:hidden" />
          </section>

          {loading ? <LoadingState warmingSteamIp={warmingSteamIp} /> : null}
          {!loading && error ? <ErrorState message={error} onRetry={loadItems} proxyDomains={PROXY_DOMAINS} /> : null}
          {!loading && !error && !items.length ? <EmptyState /> : null}
          {!loading && !error && items.length ? (
            <>
              <WallpaperGrid
                items={items}
                view={view}
                columns={gridColumns}
                onOpen={setSelected}
                defaultAction={homeCardDefaultAction}
                onDefaultAction={onHomeCardDefaultAction}
                suppressLayoutAnimation={suppressGridLayoutAnimation}
              />
              <Pagination page={page} totalPages={totalPages} setPage={setPage} />
            </>
          ) : null}
        </main>

        <AnimatePresence>
          {showHomeScrollTop ? (
            <motion.div
              initial={BACK_TO_TOP_MOTION.initial}
              animate={BACK_TO_TOP_MOTION.animate}
              exit={BACK_TO_TOP_MOTION.exit}
              transition={BACK_TO_TOP_MOTION.transition}
              className="pointer-events-none fixed bottom-5 right-3 z-30 sm:bottom-6 sm:right-5"
            >
              <Button
                type="button"
                size="icon"
                className="pointer-events-auto h-11 w-11 rounded-full shadow-lg shadow-black/35 ring-1 ring-black/10 sm:h-10 sm:w-10"
                onClick={scrollHomeTop}
                aria-label={text.backToTop}
              >
                <ArrowUp className="h-4 w-4" />
              </Button>
            </motion.div>
          ) : null}
        </AnimatePresence>

      <GenreSheet open={genreOpen} onOpenChange={setGenreOpen} fixedPanelHeight={fixedPanelHeight} filters={filters} setFilters={updateFilter} />
      {loadedDialogs.settings ? <React.Suspense fallback={null}><SettingsDialog
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        fixedPanelHeight={fixedPanelHeight}
        runtime={runtime}
        runtimeDiagnostics={runtimeDiagnostics}
        settings={settingsForm}
        settingsHostsLoaded={settingsHostsLoaded}
        mpkgCompactAvailable={mpkgCompactAvailable}
        mpkgCompactUnavailableReason={mpkgCompactUnavailableReason}
        setSettings={setSettingsForm}
        steam={steam}
        language={language}
        setLanguage={setLanguage}
        themeMode={themeMode}
        setThemeMode={setThemeMode}
        accentTheme={accentTheme}
        customAccentColor={customAccentColor}
        setCustomAccentColor={setCustomAccentColor}
        setAccentTheme={setAccentTheme}
        fixedPanelHeightEnabled={fixedPanelHeight}
        setFixedPanelHeight={setFixedPanelHeight}
        detailsPresentation={detailsPresentation}
        setDetailsPresentation={(presentation) => setDetailsPresentation(normalizeDetailsPresentation(presentation))}
        homeCardDefaultAction={homeCardDefaultAction}
        setHomeCardDefaultAction={setHomeCardDefaultAction}
        homeFilterMultiSelect={homeFilterMultiSelect}
        setHomeFilterMultiSelect={setHomeFilterMultiSelect}
        mobileColumns={mobileColumns}
        setMobileColumns={setMobileColumns}
        desktopColumns={desktopColumns}
        setDesktopColumns={setDesktopColumns}
        homePageSize={homePageSize}
        setHomePageSize={(value) => {
          setHomePageSize(value);
          setPage(1);
        }}
        prefetchNextPage={prefetchNextPage}
        setPrefetchNextPage={setPrefetchNextPage}
        onSave={saveSettingsForm}
        onClearDepotStreamCache={doClearDepotStreamCache}
        onLogin={() => setLoginOpen(true)}
        onLogout={async () => {
          await logoutSteam();
          await refreshSteamStatus();
          loginPromptRef.current = { lastAt: 0, lastKey: '' };
          toast(text.loggedOut, 'ok');
        }}
        onRestart={async () => {
          const data = await restartServer();
          toast(data.message || text.restartingServer, 'ok');
        }}
        onShutdown={async () => {
          if (!window.confirm(text.shutdownConfirm)) return;
          const data = await shutdownServer();
          toast(data.message || text.shuttingDownServer, 'ok');
        }}
      /></React.Suspense> : null}
      {loadedDialogs.queue ? <React.Suspense fallback={null}><QueueDialog
        open={queueOpen}
        onOpenChange={setQueueOpen}
        fixedPanelHeight={fixedPanelHeight}
        queue={queue}
        busyIds={queueBusyIds}
        onAction={doQueueAction}
        onOpenItem={(id) => {
          const cached = items.find((item) => String(item.publishedfileid) === String(id));
          if (cached) setSelected(cached);
          else {
            const detail = readDetailsCache(detailsCacheRef.current, String(id));
            if (detail) setSelected(detail);
            else setSelected({ publishedfileid: String(id) });
          }
        }}
        onDownloadChoice={(task) => {
          const item = { publishedfileid: String(task.id || task.cacheKey), title: task.title || task.name, workshopType: task.workshopType };
          if (task.workshopType === 'Scene') openDownloadChoice(item);
          else doClientDownload(item);
        }}
        onPlay={(task) => {
          const id = String(task.id || task.cacheKey || '');
          const src = task.source === 'cache' ? `/api/cache/video/stream?key=${encodeURIComponent(id)}` : `/api/video/stream?id=${encodeURIComponent(id)}`;
          setVideo({ id, title: task.title || task.name || text.videoPlayer, src, status: 'ready' });
        }}
      /></React.Suspense> : null}
      {loadedDialogs.details ? <React.Suspense fallback={null}><DetailsDialog
        item={selected}
        details={details}
        loading={detailsLoading}
        personalSourceLabel={personalSourceLabel}
        fixedPanelHeight={fixedPanelHeight}
        presentation={detailsPresentation}
        onOpenChange={(open) => !open && setSelected(null)}
        onClientDownload={(item) => {
          if (itemType(item) === 'Scene') openDownloadChoice(item);
          else doClientDownload(item);
        }}
        onBackgroundDownload={doBackgroundDownload}
        onLoadMoreComments={loadMoreComments}
        onCopyId={(id) => { navigator.clipboard?.writeText(id); toast(text.copied, 'ok'); }}
        homeCardDefaultAction={homeCardDefaultAction}
        onPlay={doPlayVideo}
        onOpenSteamPage={openSteamPage}
        onAuthor={openAuthor}
        onSearchTags={searchByDetailTags}
      /></React.Suspense> : null}
      <DownloadChoiceDialog
        item={downloadChoice}
        onOpenChange={(open) => !open && setDownloadChoice(null)}
        onPkgDownload={(item) => {
          setDownloadChoice(null);
          doClientDownload(item);
        }}
        onMpkgDownload={(item) => {
          setDownloadChoice(null);
          doMpkgDownload(item);
        }}
      />
      {loadedDialogs.login ? <React.Suspense fallback={null}><LoginDialogV2
        open={loginOpen}
        onOpenChange={setLoginOpen}
        fixedPanelHeight={fixedPanelHeight}
        onSuccess={async () => {
          await refreshSteamStatus();
          loginPromptRef.current = { lastAt: 0, lastKey: '' };
          setLoginOpen(false);
          toast(text.loginSuccess, 'ok');
        }}
      /></React.Suspense> : null}
      {loadedDialogs.video ? <React.Suspense fallback={null}><VideoDialog video={video} onOpenChange={(open) => !open && closeVideo()} /></React.Suspense> : null}
        <ToastStack items={toasts} />
      </motion.div>
    </LanguageContext.Provider>
  );
}
