import * as React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';

import { useVideoDialogController, type VideoDialogController } from './useVideoDialogController';

function ControllerHarness({ onController }: { onController: (controller: VideoDialogController) => void }) {
  const controller = useVideoDialogController({
    video: { title: 'Ready video', src: '/ready.mp4', status: 'ready' },
    playerMode: 'compatibility',
    onOpenChange: () => {},
  });
  onController(controller);
  return (
    <div ref={controller.playerShellRef}>
      <div ref={controller.controlsRef}>
        <input aria-label="Seek" type="range" />
      </div>
      <video
        ref={controller.videoRef}
        src={controller.readySrc}
        onPointerDown={controller.startLongPress}
        onPointerUp={controller.finishLongPress}
      />
    </div>
  );
}

describe('useVideoDialogController', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  test('keeps playback and drag-seek behavior in the composed controller', () => {
    let controller: VideoDialogController | null = null;
    render(<ControllerHarness onController={(value) => { controller = value; }} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperties(video, {
      duration: { configurable: true, value: 120 },
      currentTime: { configurable: true, writable: true, value: 20 },
      paused: { configurable: true, value: true },
    });
    const play = vi.spyOn(video, 'play').mockResolvedValue();

    act(() => controller!.togglePlayback());
    expect(play).toHaveBeenCalledOnce();

    act(() => {
      controller!.beginVideoSeek();
      controller!.previewVideoPosition(45);
    });
    expect(video.currentTime).toBe(20);
    expect(controller!.displayedVideoTime).toBe(45);

    act(() => controller!.finishVideoSeek());
    expect(video.currentTime).toBe(45);
    expect(controller!.displayedVideoTime).toBe(45);
  });

  test('commits arrow seek on release and uses two-times rate only while held', () => {
    vi.useFakeTimers();
    let controller: VideoDialogController | null = null;
    render(<ControllerHarness onController={(value) => { controller = value; }} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperties(video, {
      duration: { configurable: true, value: 120 },
      currentTime: { configurable: true, writable: true, value: 20 },
      playbackRate: { configurable: true, writable: true, value: 1.5 },
    });

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(video.currentTime).toBe(20);
    fireEvent.keyUp(window, { key: 'ArrowLeft' });
    expect(video.currentTime).toBe(15);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    act(() => vi.advanceTimersByTime(350));
    expect(video.playbackRate).toBe(2);
    expect(controller!.keyboardLongPressActive).toBe(true);
    fireEvent.keyUp(window, { key: 'ArrowRight' });
    expect(video.currentTime).toBe(15);
    expect(video.playbackRate).toBe(1.5);
    expect(controller!.keyboardLongPressActive).toBe(false);
  });

  test('restores the selected rate after pointer long press', () => {
    vi.useFakeTimers();
    let controller: VideoDialogController | null = null;
    render(<ControllerHarness onController={(value) => { controller = value; }} />);
    const video = document.querySelector('video') as HTMLVideoElement;
    Object.defineProperty(video, 'playbackRate', { configurable: true, writable: true, value: 1 });

    act(() => controller!.setVideoPlaybackRate(1.75));
    act(() => controller!.startLongPress({
      button: 0,
      currentTarget: video,
      pointerId: 1,
      pointerType: 'touch',
    } as React.PointerEvent<HTMLVideoElement>));
    act(() => vi.advanceTimersByTime(350));
    expect(video.playbackRate).toBe(2);
    expect(controller!.longPressActive).toBe(true);

    act(() => controller!.finishLongPress());
    expect(video.playbackRate).toBe(1.75);
    expect(controller!.longPressActive).toBe(false);
    expect(screen.getByLabelText('Seek')).toBeInTheDocument();
  });
});
