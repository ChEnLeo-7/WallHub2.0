import * as React from 'react';
import type { VideoState } from '@/components/dialogs/VideoDialog';
import { useOverlayHistory, type OverlayHistoryLayer } from '@/hooks/useOverlayHistory';
import type { WorkshopItem } from '@/lib/api';
import type { AppText } from '@/lib/text';

export type DownloadChoiceState = { item: WorkshopItem; stage: 'start' | 'format' };

type UseAppOverlaysOptions = {
  genreOpen: boolean;
  setGenreOpen: React.Dispatch<React.SetStateAction<boolean>>;
  settingsOpen: boolean;
  setSettingsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  queueOpen: boolean;
  setQueueOpen: React.Dispatch<React.SetStateAction<boolean>>;
  selected: WorkshopItem | null;
  setSelected: React.Dispatch<React.SetStateAction<WorkshopItem | null>>;
  downloadChoice: DownloadChoiceState | null;
  setDownloadChoice: React.Dispatch<React.SetStateAction<DownloadChoiceState | null>>;
  loginOpen: boolean;
  setLoginOpen: React.Dispatch<React.SetStateAction<boolean>>;
  video: VideoState | null;
  setVideo: React.Dispatch<React.SetStateAction<VideoState | null>>;
  closeVideo: () => void;
  items: WorkshopItem[];
  text: AppText;
  dismissContextMenu: () => void;
};

export function useAppOverlays({
  genreOpen,
  setGenreOpen,
  settingsOpen,
  setSettingsOpen,
  queueOpen,
  setQueueOpen,
  selected,
  setSelected,
  downloadChoice,
  setDownloadChoice,
  loginOpen,
  setLoginOpen,
  video,
  setVideo,
  closeVideo,
  items,
  text,
  dismissContextMenu,
}: UseAppOverlaysOptions) {
  const [loadedDialogs, setLoadedDialogs] = React.useState({ settings: false, queue: false, details: false, login: false, video: false });
  const layers = React.useMemo<OverlayHistoryLayer[]>(() => {
    const next: OverlayHistoryLayer[] = [];
    if (genreOpen) next.push({ kind: 'genre' });
    if (settingsOpen) next.push({ kind: 'settings' });
    if (queueOpen) next.push({ kind: 'queue' });
    if (selected) next.push({
      kind: 'details',
      id: String(selected.publishedfileid || '') || undefined,
      title: selected.title || undefined,
      workshopType: selected.workshopType || undefined,
    });
    if (downloadChoice) next.push({
      kind: 'download-choice',
      id: String(downloadChoice.item.publishedfileid || '') || undefined,
      title: downloadChoice.item.title || undefined,
      workshopType: downloadChoice.item.workshopType || undefined,
    });
    if (loginOpen) next.push({ kind: 'login' });
    if (video) next.push({
      kind: 'video',
      id: String(video.id || '') || undefined,
      title: video.title || undefined,
      src: video.src || undefined,
      status: video.status || undefined,
      message: video.message || undefined,
    });
    return next;
  }, [downloadChoice, genreOpen, loginOpen, queueOpen, selected, settingsOpen, video]);

  const restore = React.useCallback((next: OverlayHistoryLayer[]) => {
    const layerOf = (kind: string) => next.find((layer) => layer.kind === kind);
    const itemForLayer = (layer?: OverlayHistoryLayer): WorkshopItem | null => {
      const id = String(layer?.id || '');
      if (!id) return null;
      return items.find((item) => String(item.publishedfileid) === id) || {
        publishedfileid: id,
        title: layer?.title || '',
        workshopType: layer?.workshopType || '',
      };
    };
    const detailsItem = itemForLayer(layerOf('details'));
    const choiceItem = itemForLayer(layerOf('download-choice'));
    const videoLayer = layerOf('video');

    setGenreOpen(!!layerOf('genre'));
    setSettingsOpen(!!layerOf('settings'));
    setQueueOpen(!!layerOf('queue'));
    setLoginOpen(!!layerOf('login'));
    setSelected((current) => {
      if (!detailsItem) return null;
      return String(current?.publishedfileid || '') === String(detailsItem.publishedfileid) ? current : detailsItem;
    });
    setDownloadChoice((current) => {
      if (!choiceItem) return null;
      return String(current?.item.publishedfileid || '') === String(choiceItem.publishedfileid)
        ? current
        : { item: choiceItem, stage: 'start' };
    });
    if (!videoLayer?.id) {
      if (video) closeVideo();
    } else {
      const status = videoLayer.status === 'loading' ? 'loading' : 'ready';
      const src = videoLayer.src || `/api/video/stream?id=${encodeURIComponent(videoLayer.id)}`;
      setVideo((current) => {
        if (
          current
          && String(current.id || '') === videoLayer.id
          && current.title === (videoLayer.title || text.videoPlayer)
          && current.src === src
          && current.status === status
          && current.message === videoLayer.message
        ) return current;
        return {
          id: videoLayer.id,
          title: videoLayer.title || text.videoPlayer,
          src,
          status,
          message: videoLayer.message,
        };
      });
    }
    dismissContextMenu();
  }, [closeVideo, dismissContextMenu, items, setDownloadChoice, setGenreOpen, setLoginOpen, setQueueOpen, setSelected, setSettingsOpen, setVideo, text.videoPlayer, video]);

  useOverlayHistory(layers, restore);

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

  return loadedDialogs;
}
