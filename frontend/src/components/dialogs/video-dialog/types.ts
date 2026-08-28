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
  onOpenChange: (open: boolean) => void;
};
