import * as React from 'react';
import { DownloadChoiceDialog } from '@/components/dialogs/DownloadChoiceDialog';
import { GenreSheet } from '@/components/dialogs/GenreSheet';
import { WallpaperContextMenu } from '@/components/layout/WallpaperContextMenu';
import type { WallpaperContextMenuAnchor } from '@/components/layout/WallpaperCard';
import { ToastStack } from '@/components/app/AppPageStates';
import {
  DetailsDialog,
  LoginDialogV2,
  QueueDialog,
  SettingsDialog,
  VideoDialog,
} from '@/features/overlays/lazyDialogs';
import { delayedSteamActionKey, type useSteamController } from '@/features/steam/useSteamController';
import type { useAppPreferences } from '@/features/preferences/useAppPreferences';
import type { useSettingsState } from '@/features/settings/useSettingsState';
import type { useSettingsControls } from '@/features/settings/useSettingsControls';
import type { useUpdateControls } from '@/features/settings/useUpdateControls';
import type { useQueueController } from '@/features/queue/useQueueController';
import type { useDetailsController } from '@/features/details/useDetailsController';
import type { useVideoController } from '@/features/video/useVideoController';
import type { useDownloadActions } from '@/features/download/useDownloadActions';
import type { DownloadChoiceState } from '@/features/overlays/useAppOverlays';
import {
  logoutSteam,
  restartServer,
  shutdownServer,
  type RuntimeDiagnostics,
  type RuntimeStatus,
  type WorkshopItem,
} from '@/lib/api';
import type { AppText } from '@/lib/text';
import { normalizeDetailsPresentation } from '@/lib/detailsPresentation.mjs';

export type AppToast = { id: number; message: string; type: 'info' | 'ok' | 'warn' };
export type WallpaperContextMenuState = { item: WorkshopItem; anchor: WallpaperContextMenuAnchor };

type AppDialogsProps = {
  loadedDialogs: Record<'settings' | 'queue' | 'details' | 'login' | 'video', boolean>;
  preferences: ReturnType<typeof useAppPreferences>;
  settings: ReturnType<typeof useSettingsState>;
  settingsControls: ReturnType<typeof useSettingsControls>;
  updateControls: ReturnType<typeof useUpdateControls>;
  steamController: ReturnType<typeof useSteamController>;
  queueController: ReturnType<typeof useQueueController>;
  detailsController: ReturnType<typeof useDetailsController>;
  videoController: ReturnType<typeof useVideoController>;
  downloadActions: ReturnType<typeof useDownloadActions>;
  runtime: RuntimeStatus | null;
  runtimeDiagnostics: RuntimeDiagnostics | null;
  items: WorkshopItem[];
  setPage: React.Dispatch<React.SetStateAction<number>>;
  text: AppText;
  genreOpen: boolean;
  setGenreOpen: React.Dispatch<React.SetStateAction<boolean>>;
  downloadChoice: DownloadChoiceState | null;
  setDownloadChoice: React.Dispatch<React.SetStateAction<DownloadChoiceState | null>>;
  wallpaperContextMenu: WallpaperContextMenuState | null;
  setWallpaperContextMenu: React.Dispatch<React.SetStateAction<WallpaperContextMenuState | null>>;
  onUpdateFilter: Parameters<typeof GenreSheet>[0]['setFilters'];
  onAuthor: (creator?: string) => void;
  onSearchTags: (tags: string[]) => void;
  onLoginSuccess: () => void;
  toast: (message: string, type?: AppToast['type'], timeoutMs?: number) => number;
  toasts: AppToast[];
};

export function AppDialogs({
  loadedDialogs,
  preferences,
  settings,
  settingsControls,
  updateControls,
  steamController,
  queueController,
  detailsController,
  videoController,
  downloadActions,
  runtime,
  runtimeDiagnostics,
  items,
  setPage,
  text,
  genreOpen,
  setGenreOpen,
  downloadChoice,
  setDownloadChoice,
  wallpaperContextMenu,
  setWallpaperContextMenu,
  onUpdateFilter,
  onAuthor,
  onSearchTags,
  onLoginSuccess,
  toast,
  toasts,
}: AppDialogsProps) {
  const selectedItemId = String(detailsController.selected?.publishedfileid || '');
  const contextMenuItemId = String(wallpaperContextMenu?.item.publishedfileid || '');
  const subscriptionPendingStep = steamController.pendingSteamActions[delayedSteamActionKey('subscribe', selectedItemId)]?.step;
  const favoritePendingStep = steamController.pendingSteamActions[delayedSteamActionKey('favorite', selectedItemId)]?.step;
  const contextSubscriptionPendingStep = steamController.pendingSteamActions[delayedSteamActionKey('subscribe', contextMenuItemId)]?.step;
  const contextFavoritePendingStep = steamController.pendingSteamActions[delayedSteamActionKey('favorite', contextMenuItemId)]?.step;

  return (
    <>
      <GenreSheet
        open={genreOpen}
        onOpenChange={setGenreOpen}
        fixedPanelHeight={preferences.fixedPanelHeight}
        filters={preferences.filters}
        setFilters={onUpdateFilter}
        steamDataSource={settings.settingsForm.steamDataSource}
      />
      {loadedDialogs.settings ? <React.Suspense fallback={null}><SettingsDialog
        open={settings.settingsOpen}
        onOpenChange={settings.setSettingsOpen}
        fixedPanelHeight={preferences.fixedPanelHeight}
        runtime={runtime}
        runtimeDiagnostics={runtimeDiagnostics}
        settings={settings.settingsForm}
        settingsHostsLoaded={settings.settingsHostsLoaded}
        mpkgCompactAvailable={settings.mpkgCompactAvailable}
        mpkgCompactUnavailableReason={settings.mpkgCompactUnavailableReason}
        setSettings={settings.setSettingsForm}
        steam={steamController.steam}
        language={preferences.language}
        setLanguage={preferences.setLanguage}
        themeMode={preferences.themeMode}
        setThemeMode={preferences.setThemeMode}
        accentTheme={preferences.accentTheme}
        customAccentColor={preferences.customAccentColor}
        setCustomAccentColor={preferences.setCustomAccentColor}
        setAccentTheme={preferences.setAccentTheme}
        fixedPanelHeightEnabled={preferences.fixedPanelHeight}
        setFixedPanelHeight={preferences.setFixedPanelHeight}
        detailsPresentation={preferences.detailsPresentation}
        setDetailsPresentation={(presentation) => preferences.setDetailsPresentation(normalizeDetailsPresentation(presentation))}
        homeCardDefaultAction={preferences.homeCardDefaultAction}
        setHomeCardDefaultAction={preferences.setHomeCardDefaultAction}
        homeFilterMultiSelect={preferences.homeFilterMultiSelect}
        setHomeFilterMultiSelect={preferences.setHomeFilterMultiSelect}
        mobileColumns={preferences.mobileColumns}
        setMobileColumns={preferences.setMobileColumns}
        desktopColumns={preferences.desktopColumns}
        setDesktopColumns={preferences.setDesktopColumns}
        homePageSize={preferences.homePageSize}
        setHomePageSize={(value) => {
          preferences.setHomePageSize(value);
          setPage(1);
        }}
        prefetchNextPage={preferences.prefetchNextPage}
        setPrefetchNextPage={preferences.setPrefetchNextPage}
        onSave={settingsControls.saveSettingsForm}
        onClearDepotStreamCache={settingsControls.clearDepotCache}
        onLogin={() => steamController.setLoginOpen(true)}
        onLogout={async () => {
          await logoutSteam();
          await steamController.refreshSteamStatus();
          steamController.resetLoginPrompt();
          toast(text.loggedOut, 'ok');
        }}
        onCheckUpdate={updateControls.checkUpdate}
        onDownloadUpdate={updateControls.downloadAvailableUpdate}
        onInstallUpdate={updateControls.installAvailableUpdate}
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
        open={queueController.queueOpen}
        onOpenChange={queueController.setQueueOpen}
        fixedPanelHeight={preferences.fixedPanelHeight}
        queue={queueController.queue}
        busyIds={queueController.queueBusyIds}
        onAction={queueController.doQueueAction}
        onOpenItem={(id) => detailsController.selectItemById(id, items)}
        onDownloadChoice={(task) => {
          const item = { publishedfileid: String(task.id || task.cacheKey), title: task.title || task.name, workshopType: task.workshopType };
          downloadActions.openDownloadChoice(item, 'format');
        }}
        onPlay={videoController.playQueueTask}
      /></React.Suspense> : null}
      {loadedDialogs.details ? <React.Suspense fallback={null}><DetailsDialog
        item={detailsController.selected}
        details={detailsController.details}
        loading={detailsController.detailsLoading}
        personalSourceLabel={detailsController.personalSourceLabel}
        fixedPanelHeight={preferences.fixedPanelHeight}
        presentation={preferences.detailsPresentation}
        onOpenChange={(open) => !open && detailsController.setSelected(null)}
        onClientDownload={downloadActions.doWallpaperDownload}
        onLoadMoreComments={detailsController.loadMoreComments}
        onCopyId={(id) => { navigator.clipboard?.writeText(id); toast(text.copied, 'ok'); }}
        onCopyTitle={(title) => { navigator.clipboard?.writeText(title); toast(text.copied, 'ok'); }}
        personalSubscriptionActive={
          preferences.filters.personalFilter === 'mysubscriptions'
          || steamController.subscriptionStates[selectedItemId] === true
        }
        subscriptionPendingStep={subscriptionPendingStep}
        subscriptionSubmitting={!!steamController.submittingSteamActions[delayedSteamActionKey('subscribe', selectedItemId)]}
        personalFavoriteActive={
          preferences.filters.personalFilter === 'myfavorites'
          || steamController.favoriteStates[selectedItemId] === true
        }
        favoritePendingStep={favoritePendingStep}
        favoriteSubmitting={!!steamController.submittingSteamActions[delayedSteamActionKey('favorite', selectedItemId)]}
        onRemoteSubscribe={steamController.doRemoteSubscribe}
        onRemoteUnsubscribe={steamController.doRemoteUnsubscribe}
        onRemoteFavorite={steamController.doRemoteFavorite}
        onRemoteUnfavorite={steamController.doRemoteUnfavorite}
        onPlay={videoController.doPlayVideo}
        onAuthor={onAuthor}
        onSearchTags={onSearchTags}
      /></React.Suspense> : null}
      <WallpaperContextMenu
        entry={wallpaperContextMenu}
        onClose={() => setWallpaperContextMenu(null)}
        personalSubscriptionActive={
          preferences.filters.personalFilter === 'mysubscriptions'
          || steamController.subscriptionStates[contextMenuItemId] === true
        }
        subscriptionPendingStep={contextSubscriptionPendingStep}
        subscriptionSubmitting={!!steamController.submittingSteamActions[delayedSteamActionKey('subscribe', contextMenuItemId)]}
        personalFavoriteActive={
          preferences.filters.personalFilter === 'myfavorites'
          || steamController.favoriteStates[contextMenuItemId] === true
        }
        favoritePendingStep={contextFavoritePendingStep}
        favoriteSubmitting={!!steamController.submittingSteamActions[delayedSteamActionKey('favorite', contextMenuItemId)]}
        onPlay={videoController.doPlayVideo}
        onDownload={downloadActions.doWallpaperDownload}
        onOpenSteamPage={downloadActions.openSteamPage}
        onRemoteSubscribe={steamController.doRemoteSubscribe}
        onRemoteUnsubscribe={steamController.doRemoteUnsubscribe}
        onRemoteFavorite={steamController.doRemoteFavorite}
        onRemoteUnfavorite={steamController.doRemoteUnfavorite}
      />
      <DownloadChoiceDialog
        item={downloadChoice?.item || null}
        stage={downloadChoice?.stage || 'start'}
        onOpenChange={(open) => !open && setDownloadChoice(null)}
        onNormalDownload={(item) => setDownloadChoice((current) => (
          current && String(current.item.publishedfileid) === String(item.publishedfileid)
            ? { ...current, stage: 'format' }
            : current
        ))}
        onPkgDownload={(item) => {
          setDownloadChoice(null);
          void downloadActions.doClientDownload(item);
        }}
        onMpkgDownload={(item) => {
          setDownloadChoice(null);
          void downloadActions.doMpkgDownload(item);
        }}
        onMpkgConvertOnly={(item) => {
          setDownloadChoice(null);
          void downloadActions.doMpkgConvertOnly(item);
        }}
        onBackgroundDownload={(item) => {
          setDownloadChoice(null);
          void downloadActions.doBackgroundDownload(item);
        }}
      />
      {loadedDialogs.login ? <React.Suspense fallback={null}><LoginDialogV2
        open={steamController.loginOpen}
        onOpenChange={steamController.setLoginOpen}
        fixedPanelHeight={preferences.fixedPanelHeight}
        onSuccess={async () => {
          await steamController.refreshSteamStatus();
          steamController.resetLoginPrompt();
          steamController.setLoginOpen(false);
          onLoginSuccess();
          toast(text.loginSuccess, 'ok');
        }}
      /></React.Suspense> : null}
      {loadedDialogs.video ? <React.Suspense fallback={null}><VideoDialog
        video={videoController.video}
        onOpenChange={(open) => !open && videoController.closeVideo()}
      /></React.Suspense> : null}
      <ToastStack items={toasts} />
    </>
  );
}
