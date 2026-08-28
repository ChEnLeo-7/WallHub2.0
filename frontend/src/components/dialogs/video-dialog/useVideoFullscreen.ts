import * as React from 'react';

type WebkitFullscreenDocument = Document & {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void | Promise<void>;
};

type WebkitFullscreenElement = HTMLElement & {
  webkitRequestFullscreen?: () => void | Promise<void>;
};

type VideoFullscreenOptions = {
  playerShellRef: React.RefObject<HTMLDivElement>;
  readySrc: string;
  showControls: () => void;
};

export function useVideoFullscreen({ playerShellRef, readySrc, showControls }: VideoFullscreenOptions) {
  const [systemFullscreen, setSystemFullscreen] = React.useState(false);
  const [fallbackFullscreen, setFallbackFullscreen] = React.useState(false);
  const fullscreenActive = systemFullscreen || fallbackFullscreen;

  React.useEffect(() => {
    setFallbackFullscreen(false);
    setSystemFullscreen(false);
  }, [readySrc]);

  const updateFullscreenState = React.useCallback(() => {
    const doc = document as WebkitFullscreenDocument;
    const shell = playerShellRef.current;
    const fullscreenElement = document.fullscreenElement || doc.webkitFullscreenElement || null;
    setSystemFullscreen(!!(
      shell && fullscreenElement && (fullscreenElement === shell || shell.contains(fullscreenElement))
    ));
    showControls();
  }, [playerShellRef, showControls]);

  React.useEffect(() => {
    if (!readySrc) return;
    document.addEventListener('fullscreenchange', updateFullscreenState);
    document.addEventListener('webkitfullscreenchange', updateFullscreenState);
    return () => {
      document.removeEventListener('fullscreenchange', updateFullscreenState);
      document.removeEventListener('webkitfullscreenchange', updateFullscreenState);
    };
  }, [readySrc, updateFullscreenState]);

  const leaveFullscreen = React.useCallback(async () => {
    if (fallbackFullscreen) {
      setFallbackFullscreen(false);
      setSystemFullscreen(false);
      showControls();
      return;
    }
    const doc = document as WebkitFullscreenDocument;
    try {
      if (document.fullscreenElement && document.exitFullscreen) await document.exitFullscreen();
      else if (doc.webkitFullscreenElement && doc.webkitExitFullscreen) await doc.webkitExitFullscreen();
    } catch {
      setSystemFullscreen(false);
    }
  }, [fallbackFullscreen, showControls]);
  const enterFullscreen = React.useCallback(async () => {
    const shell = playerShellRef.current as WebkitFullscreenElement | null;
    if (!shell) return;
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
    setFallbackFullscreen(true);
  }, [playerShellRef, showControls]);
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
