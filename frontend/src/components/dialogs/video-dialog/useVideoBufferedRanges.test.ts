import { describe, expect, test } from 'vitest';

import { readVideoBufferedRanges } from './useVideoBufferedRanges';

describe('readVideoBufferedRanges', () => {
  test('returns every valid browser buffered segment clamped to media duration', () => {
    const video = {
      duration: 100,
      buffered: {
        length: 3,
        start: (index: number) => [-2, 30, 99][index],
        end: (index: number) => [12, 45, 120][index],
      },
    } as unknown as HTMLVideoElement;

    expect(readVideoBufferedRanges(video)).toEqual([
      { start: 0, end: 12 },
      { start: 30, end: 45 },
      { start: 99, end: 100 },
    ]);
  });

  test('returns no buffered display before a finite duration is known', () => {
    const video = {
      duration: Number.NaN,
      buffered: { length: 1, start: () => 0, end: () => 10 },
    } as unknown as HTMLVideoElement;

    expect(readVideoBufferedRanges(video)).toEqual([]);
  });
});
