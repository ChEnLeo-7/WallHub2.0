import * as React from 'react';

export type VideoBufferedRange = {
  start: number;
  end: number;
};

export function readVideoBufferedRanges(video: HTMLVideoElement): VideoBufferedRange[] {
  const duration = Number(video.duration);
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const ranges: VideoBufferedRange[] = [];
  for (let index = 0; index < Math.min(video.buffered.length, 32); index++) {
    const start = Math.max(0, Math.min(duration, video.buffered.start(index)));
    const end = Math.max(start, Math.min(duration, video.buffered.end(index)));
    if (end > start) ranges.push({ start, end });
  }
  return ranges;
}

function rangesEqual(left: VideoBufferedRange[], right: VideoBufferedRange[]) {
  return left.length === right.length && left.every((range, index) => (
    Math.abs(range.start - right[index].start) < 0.01
    && Math.abs(range.end - right[index].end) < 0.01
  ));
}

export function useVideoBufferedRanges(readySrc: string) {
  const [bufferedRanges, setBufferedRanges] = React.useState<VideoBufferedRange[]>([]);
  const syncBufferedRanges = React.useCallback((video: HTMLVideoElement) => {
    const next = readVideoBufferedRanges(video);
    setBufferedRanges((current) => rangesEqual(current, next) ? current : next);
  }, []);

  React.useEffect(() => {
    setBufferedRanges([]);
  }, [readySrc]);

  return { bufferedRanges, syncBufferedRanges };
}
