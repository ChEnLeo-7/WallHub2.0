import { describe, expect, test } from 'vitest';

import { isDesktopVideoViewport } from './useVideoLayout';

describe('isDesktopVideoViewport', () => {
  test('uses single-click desktop playback at desktop widths regardless of touch hardware', () => {
    expect(isDesktopVideoViewport(640)).toBe(true);
    expect(isDesktopVideoViewport(1920)).toBe(true);
  });

  test('keeps the mobile interaction at narrow widths', () => {
    expect(isDesktopVideoViewport(639)).toBe(false);
  });
});
