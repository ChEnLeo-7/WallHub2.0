import type { VideoPlayerMode } from '@/hooks/usePreferences';

export type VideoState = {
  id?: string;
  title: string;
  src?: string;
  status?: 'loading' | 'ready';
  message?: string;
  cdnWatchSince?: number;
};

export type VideoDialogProps = {
  video: VideoState | null;
  playerMode: VideoPlayerMode;
  onOpenChange: (open: boolean) => void;
};
