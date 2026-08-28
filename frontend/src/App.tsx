import * as React from 'react';
import { motion } from 'motion/react';
import {
  getRuntime,
  getRuntimeDiagnostics,
  reportClientEvent,
  type RuntimeDiagnostics,
  type RuntimeStatus,
  type WorkshopItem,
} from '@/lib/api';
import { usePageVisible } from '@/hooks/usePageVisible';
import { useWorkshopQuery } from '@/hooks/useWorkshopQuery';
import { LanguageContext, textFor } from '@/lib/text';
import { encodeDetailTagSearch } from '@/lib/detailTagSearch.mjs';
import { normalizeRatings, primaryRating } from '@/lib/normalizers';
import { isRuntimeSetupActive } from '@/lib/workshop';
import { HomePage } from '@/components/app/HomePage';
import { isSteamAccountRecoveryBlockingWorkshop } from '@/components/app/AppPageStates';
import {
  AppDialogs,
  type AppToast,
  type WallpaperContextMenuState,
} from '@/components/app/AppDialogs';
import { useDetailsController } from '@/features/details/useDetailsController';
import { useQueueController } from '@/features/queue/useQueueController';
import { useSteamController } from '@/features/steam/useSteamController';
import { useVideoController } from '@/features/video/useVideoController';
import { useAppPreferences } from '@/features/preferences/useAppPreferences';
import { useSettingsState } from '@/features/settings/useSettingsState';
import { useSettingsControls } from '@/features/settings/useSettingsControls';
import { useUpdateControls } from '@/features/settings/useUpdateControls';
import { useAppOverlays, type DownloadChoiceState } from '@/features/overlays/useAppOverlays';
import { useDownloadActions } from '@/features/download/useDownloadActions';
import { useAuthorNavigation } from '@/features/author/useAuthorNavigation';
import {
  useHomeCardAction,
  useHomeCoordinator,
  useHomeQueryState,
} from '@/features/home/useHomeCoordinator';

export default function App({ workshopQueryEnabled = true }: { workshopQueryEnabled?: boolean }) {
  const preferences = useAppPreferences();
  const settings = useSettingsState();
  const { page, setPage, filterRefreshToken, setFilterRefreshToken } = useHomeQueryState();
  const [runtime, setRuntime] = React.useState<RuntimeStatus | null>(null);
  const [runtimeDiagnostics, setRuntimeDiagnostics] = React.useState<RuntimeDiagnostics | null>(null);
  const [genreOpen, setGenreOpen] = React.useState(false);
  const [toasts, setToasts] = React.useState<AppToast[]>([]);
  const [downloadChoice, setDownloadChoice] = React.useState<DownloadChoiceState | null>(null);
  const [wallpaperContextMenu, setWallpaperContextMenu] = React.useState<WallpaperContextMenuState | null>(null);
  const pageVisible = usePageVisible();
  const visibleRefreshReadyRef = React.useRef(false);
  const runtimeRequestRef = React.useRef<Promise<RuntimeStatus> | null>(null);
  const runtimeRefreshIdRef = React.useRef(0);
  const runtimeDiagnosticsRequestRef = React.useRef<Promise<void> | null>(null);
  const queueLoginTaskHandlerRef = React.useRef<(taskId: string) => void>(() => {});
  const text = React.useMemo(() => textFor(preferences.language), [preferences.language]);
  const nsfw = !!runtime?.nsfwEnabled;
  const effectiveExactPhrase = !!preferences.filters.search.trim() && preferences.exactPhrase;

  const toast = React.useCallback((message: string, type: AppToast['type'] = 'info', timeoutMs = 3200) => {
    const id = Date.now() + Math.random();
    setToasts((current) => [...current, { id, message, type }]);
    if (timeoutMs > 0) {
      window.setTimeout(() => setToasts((current) => current.filter((item) => item.id !== id)), timeoutMs);
    }
    return id;
  }, []);
  const updateToast = React.useCallback((id: number, message: string, type?: AppToast['type']) => {
    setToasts((current) => current.map((item) => item.id === id ? { ...item, message, type: type || item.type } : item));
  }, []);
  const dismissToast = React.useCallback((id: number) => {
    setToasts((current) => current.filter((item) => item.id !== id));
  }, []);
  const reportDownloadClick = React.useCallback((item: WorkshopItem, action: string, source = 'wallpaper-card') => {
    reportClientEvent({
      event: 'download-click',
      action,
      source,
      id: String(item.publishedfileid || ''),
      title: item.title || '',
      itemType: item.workshopType || '',
    });
  }, []);

  const steamController = useSteamController({ text, toast, dismissToast, reportDownloadClick });
  const detailsController = useDetailsController({
    personalFilter: preferences.filters.personalFilter,
    steamLoggedIn: !!steamController.steam?.loggedIn,
    steamUsername: String(steamController.steam?.username || ''),
  });
  const onQueueLoginTask = React.useCallback((taskId: string) => queueLoginTaskHandlerRef.current(taskId), []);
  const queueController = useQueueController({
    pageVisible,
    text,
    toast,
    requestLogin: steamController.requestLogin,
    onLoginTask: onQueueLoginTask,
  });
  const runtimeSetupBusy = isRuntimeSetupActive(runtime?.runtimeSetup?.status);
  const restoringSteamAccount = isSteamAccountRecoveryBlockingWorkshop(
    !!steamController.steam?.pendingValidation,
    settings.settingsForm.steamDataSource,
  );
  const updateBusy = ['checking', 'downloading', 'installing'].includes(String(runtime?.update?.status || ''));
  const onWorkshopWarning = React.useCallback((message: string) => toast(message, 'warn'), [toast]);
  const workshopQuery = useWorkshopQuery({
    enabled: workshopQueryEnabled,
    filters: preferences.filters,
    page,
    pageSize: preferences.homePageSize,
    exactPhrase: effectiveExactPhrase,
    nsfw,
    prefetchNextPage: preferences.prefetchNextPage,
    steamAccessEnhance: settings.settingsForm.wallhubSteamAccessEnhance,
    steamDataSource: settings.settingsForm.steamDataSource,
    language: preferences.language,
    refreshToken: filterRefreshToken,
    setPage,
    onWarning: onWorkshopWarning,
  });

  const fetchRuntime = React.useCallback((fresh = false) => {
    if (!fresh && runtimeRequestRef.current) return runtimeRequestRef.current;
    const request = getRuntime().finally(() => {
      if (runtimeRequestRef.current === request) runtimeRequestRef.current = null;
    });
    runtimeRequestRef.current = request;
    return request;
  }, []);
  const refreshRuntime = React.useCallback(async (fresh = false) => {
    const refreshId = ++runtimeRefreshIdRef.current;
    try {
      const data = await fetchRuntime(fresh);
      if (refreshId !== runtimeRefreshIdRef.current) return;
      setRuntime((current) => (current?.revision === data.revision ? current : data));
      preferences.setFilters((current) => {
        const ratings = normalizeRatings(current.ratings, !!data.nsfwEnabled, undefined, current.rating);
        const rating = primaryRating(ratings, !!data.nsfwEnabled);
        return rating === current.rating && JSON.stringify(ratings) === JSON.stringify(current.ratings)
          ? current
          : { ...current, rating, ratings };
      });
    } catch (error) {
      console.warn('[runtime]', error);
    }
  }, [fetchRuntime, preferences.setFilters]);
  const refreshWorkshopForSettings = React.useCallback(() => setFilterRefreshToken((value) => value + 1), [setFilterRefreshToken]);
  const refreshWorkshopAfterLogin = React.useCallback(() => {
    workshopQuery.clearCache();
    workshopQuery.markForceRefresh();
    setFilterRefreshToken((value) => value + 1);
  }, [setFilterRefreshToken, workshopQuery.clearCache, workshopQuery.markForceRefresh]);
  const settingsControls = useSettingsControls({
    settingsForm: settings.settingsForm,
    setSettingsForm: settings.setSettingsForm,
    settingsHostsLoadedRef: settings.settingsHostsLoadedRef,
    setCompactAvailability: settings.setCompactAvailability,
    text,
    toast,
    refreshRuntime,
    clearWorkshopCache: workshopQuery.clearCache,
    markWorkshopForceRefresh: workshopQuery.markForceRefresh,
    refreshWorkshop: refreshWorkshopForSettings,
  });
  const refreshRuntimeDiagnostics = React.useCallback(() => {
    if (runtimeDiagnosticsRequestRef.current) return runtimeDiagnosticsRequestRef.current;
    const request = getRuntimeDiagnostics()
      .then((data) => setRuntimeDiagnostics((current) => (current?.revision === data.revision ? current : data)))
      .catch((error) => console.warn('[runtime-diagnostics]', error))
      .finally(() => {
        if (runtimeDiagnosticsRequestRef.current === request) runtimeDiagnosticsRequestRef.current = null;
      });
    runtimeDiagnosticsRequestRef.current = request;
    return request;
  }, []);
  const videoController = useVideoController({
    pageVisible,
    text,
    toast,
    fetchRuntime,
    setRuntime,
    requestLogin: steamController.requestLogin,
    reportDownloadClick,
    refreshQueue: queueController.refreshQueue,
  });
  queueLoginTaskHandlerRef.current = videoController.dismissLoginTaskVideo;
  const updateControls = useUpdateControls({ runtime, text, toast, refreshRuntime });
  const downloadActions = useDownloadActions({
    text,
    textureProfile: settings.settingsForm.mpkgTextureProfile,
    steamAccessEnhance: settings.settingsForm.wallhubSteamAccessEnhance,
    toast,
    updateToast,
    dismissToast,
    refreshQueue: queueController.refreshQueue,
    requestLogin: steamController.requestLogin,
    reportDownloadClick,
    setDownloadChoice,
  });

  const closeHomeOverlays = React.useCallback(() => {
    detailsController.setSelected(null);
    queueController.setQueueOpen(false);
    settings.setSettingsOpen(false);
    setGenreOpen(false);
  }, [detailsController.setSelected, queueController.setQueueOpen, settings.setSettingsOpen]);
  const homeCoordinator = useHomeCoordinator({
    filters: preferences.filters,
    setFilters: preferences.setFilters,
    homeFilterMultiSelect: preferences.homeFilterMultiSelect,
    nsfw,
    steamDataSource: settings.settingsForm.steamDataSource,
    setPage,
    setFilterRefreshToken,
    cancelNextPagePrefetch: workshopQuery.cancelNextPagePrefetch,
    clearWorkshopCache: workshopQuery.clearCache,
    markWorkshopForceRefresh: workshopQuery.markForceRefresh,
    clearDetailsCache: detailsController.clearDetailsCache,
    closeOverlays: closeHomeOverlays,
  });
  const authorNavigation = useAuthorNavigation({
    filters: preferences.filters,
    exactPhrase: preferences.exactPhrase,
    page,
    querySnapshot: {
      filters: preferences.filters,
      exactPhrase: preferences.exactPhrase,
      page,
      items: workshopQuery.items,
      total: workshopQuery.total,
      serverTotalPages: workshopQuery.serverTotalPages,
      dataSource: workshopQuery.dataSource,
      steamDataSource: settings.settingsForm.steamDataSource,
      fallbackUsed: workshopQuery.fallbackUsed,
      error: workshopQuery.error,
    },
    setFilters: preferences.setFilters,
    setExactPhrase: preferences.setExactPhrase,
    setPage,
    setSelected: detailsController.setSelected,
    updateFilter: homeCoordinator.updateFilter,
    cancelActiveQuery: workshopQuery.cancelActiveQuery,
    restoreWorkshopState: workshopQuery.restoreState,
  });
  const onHomeCardDefaultAction = useHomeCardAction({
    defaultAction: preferences.homeCardDefaultAction,
    playVideo: videoController.doPlayVideo,
    backgroundDownload: downloadActions.doBackgroundDownload,
    openSteamPage: downloadActions.openSteamPage,
    remoteSubscribe: steamController.doRemoteSubscribe,
    download: downloadActions.doWallpaperDownload,
  });

  React.useEffect(() => {
    refreshRuntime();
    steamController.refreshSteamStatus();
  }, [refreshRuntime, steamController.refreshSteamStatus]);
  React.useEffect(() => {
    if (!pageVisible || !steamController.steam?.pendingValidation) return;
    steamController.refreshSteamStatus();
    if (!workshopQuery.loading) return;
    const timer = window.setInterval(steamController.refreshSteamStatus, 1000);
    return () => window.clearInterval(timer);
  }, [pageVisible, steamController.refreshSteamStatus, steamController.steam?.pendingValidation, workshopQuery.loading]);
  React.useEffect(() => {
    if (!pageVisible || (!settings.settingsOpen && !runtimeSetupBusy && !updateBusy)) return;
    const intervalMs = runtimeSetupBusy || updateBusy || queueController.activeTasks ? 1000 : 15000;
    const timer = window.setInterval(() => {
      refreshRuntime();
      if (settings.settingsOpen) steamController.refreshSteamStatus();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [pageVisible, queueController.activeTasks, refreshRuntime, runtimeSetupBusy, settings.settingsOpen, steamController.refreshSteamStatus, updateBusy]);
  React.useEffect(() => {
    if (!pageVisible || !settings.settingsOpen) return;
    refreshRuntimeDiagnostics();
    const timer = window.setInterval(refreshRuntimeDiagnostics, 30000);
    return () => window.clearInterval(timer);
  }, [pageVisible, refreshRuntimeDiagnostics, settings.settingsOpen]);
  React.useEffect(() => {
    if (!pageVisible) return;
    if (!visibleRefreshReadyRef.current) {
      visibleRefreshReadyRef.current = true;
      return;
    }
    refreshRuntime();
    queueController.refreshQueue();
    if (settings.settingsOpen || steamController.loginOpen) steamController.refreshSteamStatus();
  }, [pageVisible, queueController.refreshQueue, refreshRuntime, settings.settingsOpen, steamController.loginOpen, steamController.refreshSteamStatus]);
  React.useEffect(() => window.scrollTo({ top: 0, left: 0, behavior: 'auto' }), [page]);
  React.useEffect(() => {
    const id = String(detailsController.selected?.publishedfileid || '');
    steamController.syncSelectedItem(id, preferences.filters.personalFilter);
  }, [detailsController.selected?.publishedfileid, preferences.filters.personalFilter, steamController.syncSelectedItem]);

  const openWallpaperContextMenu = React.useCallback((item: WorkshopItem, anchor: WallpaperContextMenuState['anchor']) => {
    reportDownloadClick(item, 'open-context-menu');
    if (preferences.filters.personalFilter !== 'mysubscriptions' && preferences.filters.personalFilter !== 'myfavorites') {
      void steamController.refreshSubscriptionStatus(item.publishedfileid);
    }
    setWallpaperContextMenu({ item, anchor });
  }, [preferences.filters.personalFilter, reportDownloadClick, steamController.refreshSubscriptionStatus]);
  const searchByDetailTags = React.useCallback((tags: string[]) => {
    const search = encodeDetailTagSearch(tags);
    if (!search) return;
    detailsController.setSelected(null);
    homeCoordinator.updateFilter({ search });
  }, [detailsController.setSelected, homeCoordinator.updateFilter]);
  const openSettings = React.useCallback(() => {
    settings.setSettingsOpen(true);
    refreshRuntime();
    refreshRuntimeDiagnostics();
    settings.loadSettingsDetails();
    steamController.refreshSteamStatus();
  }, [refreshRuntime, refreshRuntimeDiagnostics, settings.loadSettingsDetails, settings.setSettingsOpen, steamController.refreshSteamStatus]);
  const dismissWallpaperContextMenu = React.useCallback(() => setWallpaperContextMenu(null), []);
  const loadedDialogs = useAppOverlays({
    genreOpen,
    setGenreOpen,
    settingsOpen: settings.settingsOpen,
    setSettingsOpen: settings.setSettingsOpen,
    queueOpen: queueController.queueOpen,
    setQueueOpen: queueController.setQueueOpen,
    selected: detailsController.selected,
    setSelected: detailsController.setSelected,
    downloadChoice,
    setDownloadChoice,
    loginOpen: steamController.loginOpen,
    setLoginOpen: steamController.setLoginOpen,
    video: videoController.video,
    setVideo: videoController.setVideo,
    closeVideo: videoController.closeVideo,
    items: workshopQuery.items,
    text,
    dismissContextMenu: dismissWallpaperContextMenu,
  });

  return (
    <LanguageContext.Provider value={{ language: preferences.language, text }}>
      <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.2 }} className="min-h-screen bg-background">
        <HomePage
          preferences={preferences}
          query={workshopQuery}
          page={page}
          setPage={setPage}
          nsfw={nsfw}
          authorNavigationActive={authorNavigation.active}
          onAuthorBack={authorNavigation.restore}
          onHome={() => homeCoordinator.resetHome(authorNavigation.clear)}
          onSettings={openSettings}
          onQueue={queueController.openQueue}
          queueCount={queueController.activeTasks}
          onUpdateFilter={homeCoordinator.updateFilter}
          onOpenGenres={() => setGenreOpen(true)}
          steamLoggedIn={!!steamController.steam?.loggedIn}
          restoringSteamAccount={restoringSteamAccount}
          onLoginRequired={() => steamController.requestLogin({ requiresSteamLogin: true })}
          onOpenItem={detailsController.setSelected}
          onDefaultAction={onHomeCardDefaultAction}
          onOpenContextMenu={openWallpaperContextMenu}
          detailsDialogOpen={!!detailsController.selected}
          steamDataSource={settings.settingsForm.steamDataSource}
        />
        <AppDialogs
          loadedDialogs={loadedDialogs}
          preferences={preferences}
          settings={settings}
          settingsControls={settingsControls}
          updateControls={updateControls}
          steamController={steamController}
          queueController={queueController}
          detailsController={detailsController}
          videoController={videoController}
          downloadActions={downloadActions}
          runtime={runtime}
          runtimeDiagnostics={runtimeDiagnostics}
          items={workshopQuery.items}
          setPage={setPage}
          text={text}
          genreOpen={genreOpen}
          setGenreOpen={setGenreOpen}
          downloadChoice={downloadChoice}
          setDownloadChoice={setDownloadChoice}
          wallpaperContextMenu={wallpaperContextMenu}
          setWallpaperContextMenu={setWallpaperContextMenu}
          onUpdateFilter={homeCoordinator.updateFilter}
          onAuthor={authorNavigation.openAuthor}
          onSearchTags={searchByDetailTags}
          onLoginSuccess={refreshWorkshopAfterLogin}
          toast={toast}
          toasts={toasts}
        />
      </motion.div>
    </LanguageContext.Provider>
  );
}
