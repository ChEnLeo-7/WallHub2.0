import * as React from 'react';

type WebkitFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void | Promise<void>;
};

type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>;
};

type WebkitFullscreenVideo = HTMLVideoElement & {
  webkitDisplayingFullscreen?: boolean;
  webkitEnterFullscreen?: () => void;
  webkitExitFullscreen?: () => void;
};

type VideoFullscreenOptions = {
  playerMode: string;
  playerShellRef: React.RefObject<HTMLDivElement>;
  readySrc: string;
  showControls: () => void;
  videoRef: React.RefObject<HTMLVideoElement>;
};

export function useVideoFullscreen({ playerMode, playerShellRef, readySrc, showControls, videoRef }: VideoFullscreenOptions) {
  const [systemFullscreen, setSystemFullscreen] = React.useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = React.useState(false);
  const fullscreenActive = systemFullscreen || fallbackFullscreen;

  React.useEffect(() => {
    setFallbackFullscreen(false);
    setSystemFullscreen(false);
  }, [playerMode, readySrc]);

  const updateFullscreenState = React.useCallback(() => {
    const doc = document as WebkitFullscreenDocument;
    const shell = playerShellRef.current;
    const fullscreenElement = document.fullscreenElement || doc.webkitFullscreenElement || null;
    const videoElement = videoRef.current as WebkitFullscreenVideo | null;
    setSystemFullscreen(!!(
      (shell && fullscreenElement && (fullscreenElement === shell || shell.contains(fullscreenElement)))
      || videoElement?.webkitDisplayingFullscreen
    ));
    showControls();
  }, [playerShellRef, showControls, videoRef]);

  React.useEffect(() => {
    if (!readySrc) return;
    const videoElement = videoRef.current;
    document.addEventListener('fullscreenchange', updateFullscreenState);
    document.addEventListener('webkitfullscreenchange', updateFullscreenState);
    videoElement?.addEventListener('webkitbeginfullscreen', updateFullscreenState);
    videoElement?.addEventListener('webkitendfullscreen', updateFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', updateFullscreenState);
      document.removeEventListener('webkitfullscreenchange', updateFullscreenState);
      videoElement?.removeEventListener('webkitbeginfullscreen', updateFullscreenState);
      videoElement?.removeEventListener('webkitendfullscreen', updateFullscreenState);
    };
  }, [readySrc, updateFullscreenState, videoRef]);

  const leaveFullscreen = React.useCallback(async () => {
    if (fallbackFullscreen) {
      setFallbackFullscreen(false);
      setSystemFullscreen(false);
      showControls();
      return;
    }
    const videoElement = videoRef.current as WebkitFullscreenVideo | null;
    if (videoElement?.webkitDisplayingFullscreen && videoElement.webkitExitFullscreen) {
      try {
        videoElement.webkitExitFullscreen();
        return;
      } catch {}
    }
    const doc = document as WebkitFullscreenDocument;
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
      else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
    } catch {
      setSystemFullscreen(false);
    }
  }, [fallbackFullscreen, showControls, videoRef]);
  const enterFullscreen = React.useCallback(async () => {
    const shell = playerShellRef.current as WebkitFullscreenElement | null;
    const videoElement = videoRef.current as WebkitFullscreenVideo | null;
    if (!shell || !videoElement) return;
    showControls();
    if (shell.requestFullscreen) {
      try {
        await shell.requestFullscreen();
        setSystemFullscreen(true);
        return;
      } catch {}
    }
    if (shell.webkitRequestFullscreen) {
      try {
        await shell.webkitRequestFullscreen();
        setSystemFullscreen(true);
        return;
      } catch {}
    }
    if (videoElement.webkitEnterFullscreen) {
      try {
        videoElement.webkitEnterFullscreen();
        setSystemFullscreen(true);
        return;
      } catch {}
    }
    setFallbackFullscreen(true);
  }, [playerShellRef, showControls, videoRef]);
  const toggleFullscreen = React.useCallback(() => {
    if (fullscreenActive) void leaveFullscreen();
    else void enterFullscreen();
  }, [enterFullscreen, fullscreenActive, leaveFullscreen]);

  React.useEffect(() => {
    if (!fallbackFullscreen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setFallbackFullscreen(false);
      showControls();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [fallbackFullscreen, showControls]);

  return { fallbackFullscreen, fullscreenActive, leaveFullscreen, toggleFullscreen };
}
