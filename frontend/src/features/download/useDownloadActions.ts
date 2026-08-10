import * as React from 'react';
import {
  backgroundDownload,
  clientDownload,
  mpkgConvertOnly,
  mpkgDownload,
  type WorkshopItem,
} from '@/lib/api';
import type { AppText } from '@/lib/text';
import type { DownloadChoiceState } from '@/features/overlays/useAppOverlays';
import { steamProxyUrl } from '@/lib/workshop';

type ToastKind = 'info' | 'ok' | 'warn';

type UseDownloadActionsOptions = {
  text: AppText;
  textureProfile: 'fast' | 'compact';
  steamAccessEnhance: boolean;
  toast: (message: string, type?: ToastKind, timeoutMs?: number) => number;
  updateToast: (id: number, message: string, type?: ToastKind) => void;
  dismissToast: (id: number) => void;
  refreshQueue: () => void;
  requestLogin: (errorLike?: unknown, force?: boolean) => boolean;
  reportDownloadClick: (item: WorkshopItem, action: string, source?: string) => void;
  setDownloadChoice: React.Dispatch<React.SetStateAction<DownloadChoiceState | null>>;
};

export function useDownloadActions({
  text,
  textureProfile,
  steamAccessEnhance,
  toast,
  updateToast,
  dismissToast,
  refreshQueue,
  requestLogin,
  reportDownloadClick,
  setDownloadChoice,
}: UseDownloadActionsOptions) {
  const openDownloadChoice = React.useCallback((item: WorkshopItem, stage: DownloadChoiceState['stage'] = 'start') => {
    reportDownloadClick(item, 'open-download-choice');
    setDownloadChoice({ item, stage });
  }, [reportDownloadClick, setDownloadChoice]);

  const doClientDownload = React.useCallback(async (item: WorkshopItem) => {
    reportDownloadClick(item, 'client-download');
    const title = item.title || `Wallpaper ${item.publishedfileid}`;
    toast(text.clientPreparing, 'info');
    refreshQueue();
    const queueRefreshTimer = window.setInterval(refreshQueue, 1000);
    try {
      await clientDownload(item.publishedfileid, title);
      toast(text.clientSent, 'ok');
      refreshQueue();
    } catch (error) {
      if (!requestLogin(error)) toast(error instanceof Error ? error.message : String(error), 'warn');
      refreshQueue();
    } finally {
      window.clearInterval(queueRefreshTimer);
    }
  }, [refreshQueue, reportDownloadClick, requestLogin, text.clientPreparing, text.clientSent, toast]);

  const doMpkgDownload = React.useCallback(async (item: WorkshopItem) => {
    reportDownloadClick(item, 'mpkg-download');
    const title = item.title || `Wallpaper ${item.publishedfileid}`;
    refreshQueue();
    const queueRefreshTimer = window.setInterval(refreshQueue, 1000);
    try {
      await mpkgDownload(item.publishedfileid, title, { textureProfile });
      toast(text.mpkgSent, 'ok');
      refreshQueue();
    } catch (error) {
      if (!requestLogin(error)) toast(error instanceof Error ? error.message : String(error), 'warn');
      refreshQueue();
    } finally {
      window.clearInterval(queueRefreshTimer);
    }
  }, [refreshQueue, reportDownloadClick, requestLogin, text.mpkgSent, textureProfile, toast]);

  const doBackgroundDownload = React.useCallback(async (item: WorkshopItem) => {
    reportDownloadClick(item, 'background-download');
    try {
      const data = await backgroundDownload(item.publishedfileid, item.title || '');
      toast(data.message || text.queuedDownload, 'ok');
      refreshQueue();
    } catch (error) {
      if (!requestLogin(error)) toast(error instanceof Error ? error.message : String(error), 'warn');
    }
  }, [refreshQueue, reportDownloadClick, requestLogin, text.queuedDownload, toast]);

  const doMpkgConvertOnly = React.useCallback(async (item: WorkshopItem) => {
    reportDownloadClick(item, 'mpkg-convert-only');
    const title = item.title || `Wallpaper ${item.publishedfileid}`;
    const preparingToastId = toast(text.mpkgPreparingStart, 'info', 0);
    let lastElapsedSeconds = -1;
    let lastStage = '';
    refreshQueue();
    const queueRefreshTimer = window.setInterval(refreshQueue, 1000);
    try {
      await mpkgConvertOnly(item.publishedfileid, title, {
        textureProfile,
        onPreparing: (preparation) => {
          const stage = preparation.stage === 'converting' ? 'converting' : 'downloading';
          const elapsedSeconds = Math.max(0, Math.floor(Number(preparation.elapsedMs || 0) / 1000));
          if (stage === lastStage && elapsedSeconds <= lastElapsedSeconds) return;
          lastStage = stage;
          lastElapsedSeconds = elapsedSeconds;
          const message = stage === 'converting'
            ? text.mpkgConvertOnlyPreparingProgress
            : text.mpkgConvertOnlySourceDownloadingProgress;
          updateToast(preparingToastId, message.replace('{seconds}', String(elapsedSeconds)));
        },
      });
      dismissToast(preparingToastId);
      toast(text.mpkgConvertOnlyReady, 'ok');
      refreshQueue();
    } catch (error) {
      dismissToast(preparingToastId);
      if (!requestLogin(error)) toast(error instanceof Error ? error.message : String(error), 'warn');
      refreshQueue();
    } finally {
      dismissToast(preparingToastId);
      window.clearInterval(queueRefreshTimer);
    }
  }, [dismissToast, refreshQueue, reportDownloadClick, requestLogin, text, textureProfile, toast, updateToast]);

  const openSteamPage = React.useCallback((item: WorkshopItem) => {
    const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${item.publishedfileid}`;
    window.open(steamAccessEnhance ? steamProxyUrl(url) : url, '_blank');
  }, [steamAccessEnhance]);

  return {
    openDownloadChoice,
    doClientDownload,
    doMpkgDownload,
    doBackgroundDownload,
    doMpkgConvertOnly,
    openSteamPage,
    doWallpaperDownload: openDownloadChoice,
  };
}
