import { Loader2 } from 'lucide-react';

import { Dialog } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';
import type { VideoDialogProps, VideoState } from './video-dialog/types';
import { useVideoDialogController, VIDEO_READY_POLL_MS } from './video-dialog/useVideoDialogController';
import { VideoDialogHeader } from './video-dialog/VideoDialogHeader';
import { VideoPlayer } from './video-dialog/VideoPlayer';

export { VIDEO_READY_POLL_MS };
export type { VideoState };

export function VideoDialog(props: VideoDialogProps) {
  const { video } = props;
  const controller = useVideoDialogController(props);
  const {
    checking,
    compatibilityMode,
    fallbackFullscreen,
    fittedVideoSize,
    fullscreenActive,
    handleDialogOpenChange,
    readySrc,
    text,
  } = controller;
  return (
    <Dialog
      open={!!video}
      onOpenChange={handleDialogOpenChange}
      fixedHeight={false}
      bare
      lightweight={compatibilityMode}
      title={video?.title || text.videoPlayer}
      fitContent={!!readySrc}
      className={cn(
        'max-h-[calc(100dvh-1rem)] border border-border bg-popover/95 text-popover-foreground shadow-panel backdrop-blur sm:max-h-[calc(100dvh-2rem)]',
        readySrc ? 'max-w-[calc(100vw-1rem)] sm:max-w-[calc(100vw-2rem)]' : 'w-full max-w-2xl',
        fallbackFullscreen && 'wallhub-video-fullscreen-height !fixed !inset-0 !max-h-none !w-screen !max-w-none !rounded-none !border-0 !bg-black',
      )}
    >
      {video ? (
        <div
          className={cn('overflow-hidden rounded-2xl', fallbackFullscreen && 'wallhub-video-fullscreen-height flex w-screen flex-col rounded-none')}
          style={readySrc && fittedVideoSize && !fullscreenActive ? { width: `${fittedVideoSize.width}px` } : undefined}
        >
          <VideoDialogHeader controller={controller} title={video.title} />
          {readySrc ? (
            <VideoPlayer controller={controller} />
          ) : (
            <div className="grid min-h-[220px] place-items-center bg-black px-6 py-12 text-center text-white sm:min-h-[420px]">
              <div>
                <Loader2 className="mx-auto mb-3 h-6 w-6 animate-spin text-white/80" />
                <div className="text-sm font-medium">{text.videoLoading}</div>
                <div className="mt-1 text-xs text-white/60">{video.message || (checking ? text.videoPreparing : text.videoQueued)}</div>
              </div>
            </div>
          )}
        </div>
      ) : null}
    </Dialog>
  );
}
