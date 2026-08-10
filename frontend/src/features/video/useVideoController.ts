import * as React from 'react';
import type { VideoState } from '@/components/dialogs/VideoDialog';
import {
  playVideo,
  releaseDepotVideoStream,
  type QueueTask,
  type RuntimeStatus,
  type WorkshopItem,
} from '@/lib/api';
import type { AppText } from '@/lib/text';

type Toast = (message: string, type?: 'info' | 'ok' | 'warn', timeoutMs?: number) => number;

const VIDEO_CDN_TOAST_TIMEOUT_MS = 2400;

type UseVideoControllerOptions = {
  pageVisible: boolean;
  text: AppText;
  toast: Toast;
  fetchRuntime: (fresh?: boolean) => Promise<RuntimeStatus>;
  setRuntime: React.Dispatch<React.SetStateAction<RuntimeStatus | null>>;
  requestLogin: (errorLike?: unknown, force?: boolean) => boolean;
  reportDownloadClick: (item: WorkshopItem, action: string, source?: string) => void;
  refreshQueue: () => void;
};

export function useVideoController({
  pageVisible,
  text,
  toast,
  fetchRuntime,
  setRuntime,
  requestLogin,
  reportDownloadClick,
  refreshQueue,
}: UseVideoControllerOptions) {
  const [video, setVideo] = React.useState<VideoState | null>(null);
  const videoPlayRequestRef = React.useRef<{ token: number; controller: AbortController } | null>(null);
  const videoCdnToastRef = React.useRef(0);
  const showVideoCdnToast = React.useCallback((host: string, watchSince: number) => {
    const value = host.trim();
    if (!value || videoCdnToastRef.current === watchSince) return false;
    videoCdnToastRef.current = watchSince;
    toast(`${text.currentCdnNode}: ${value}`, 'info', VIDEO_CDN_TOAST_TIMEOUT_MS);
    return true;
  }, [text.currentCdnNode, toast]);

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
        if (updatedAt >= watchSince - 1000 && showVideoCdnToast(host, watchSince)) closed = true;
      } catch (error) {
        console.warn('[runtime-cdn]', error);
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
  }, [fetchRuntime, pageVisible, setRuntime, showVideoCdnToast, video?.cdnWatchSince, video?.id]);

  React.useEffect(() => {
    const src = video?.src;
    return () => releaseDepotVideoStream(src);
  }, [video?.src]);

  React.useEffect(() => {
    const releaseCurrentVideo = () => releaseDepotVideoStream(video?.src);
    window.addEventListener('pagehide', releaseCurrentVideo);
    return () => window.removeEventListener('pagehide', releaseCurrentVideo);
  }, [video?.src]);

  const closeVideo = React.useCallback(() => {
    if (videoPlayRequestRef.current) {
      videoPlayRequestRef.current.controller.abort();
      videoPlayRequestRef.current = null;
    }
    releaseDepotVideoStream(video?.src);
    setVideo(null);
  }, [video?.src]);

  const dismissLoginTaskVideo = React.useCallback((taskId: string) => {
    setVideo((current) => (current && String(current.id || '') === taskId ? null : current));
  }, []);

  const doPlayVideo = React.useCallback(async (item: WorkshopItem) => {
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
      showVideoCdnToast(cdnHost, cdnWatchSince);
      if (data.status === 'ready' && data.streamUrl) {
        setVideo({ id, title, src: data.streamUrl, status: 'ready', cdnWatchSince });
      } else {
        toast(text.videoQueued, 'info');
        setVideo({ id, title, src: data.streamUrl || `/api/video/stream?id=${encodeURIComponent(id)}`, status: 'loading', message: text.videoPreparing, cdnWatchSince });
        refreshQueue();
      }
    } catch (error) {
      if ((error as Error)?.name === 'AbortError') return;
      if (videoPlayRequestRef.current?.token !== token) return;
      setVideo(null);
      if (!requestLogin(error)) toast(error instanceof Error ? error.message : String(error), 'warn');
    } finally {
      if (videoPlayRequestRef.current?.token === token) videoPlayRequestRef.current = null;
    }
  }, [refreshQueue, reportDownloadClick, requestLogin, showVideoCdnToast, text, toast, video?.src]);

  const playQueueTask = React.useCallback((task: QueueTask) => {
    const id = String(task.id || task.cacheKey || '');
    const cdnWatchSince = Date.now();
    const src = task.source === 'cache'
      ? `/api/cache/video/stream?key=${encodeURIComponent(id)}`
      : `/api/video/stream?id=${encodeURIComponent(id)}`;
    setVideo({ id, title: task.title || task.name || text.videoPlayer, src, status: 'ready', cdnWatchSince });
  }, [text.videoPlayer]);

  return {
    video,
    setVideo,
    closeVideo,
    dismissLoginTaskVideo,
    doPlayVideo,
    playQueueTask,
  };
}
