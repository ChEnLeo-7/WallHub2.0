import * as React from 'react';

function hasTouchVideoInteraction(pointerQuery?: MediaQueryList | null) {
  if (typeof window === 'undefined') return false;
  const touchPoints = typeof navigator === 'undefined' ? 0 : navigator.maxTouchPoints;
  const coarsePointer = pointerQuery
    || (typeof window.matchMedia === 'function' ? window.matchMedia('(pointer: coarse)') : null);
  return touchPoints > 0 || !!coarsePointer?.matches;
}

export function useVideoLayout(videoSize: { width: number; height: number } | null) {
  const [viewportSize, setViewportSize] = React.useState(() => ({
    width: typeof window === 'undefined' ? 1024 : window.innerWidth,
    height: typeof window === 'undefined' ? 768 : window.innerHeight,
  }));
  const [touchVideoInteraction, setTouchVideoInteraction] = React.useState(() => hasTouchVideoInteraction());

  React.useEffect(() => {
    const update = () => setViewportSize({ width: window.innerWidth, height: window.innerHeight });
    update();
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);

  React.useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const pointerQuery = window.matchMedia('(pointer: coarse)');
    const update = () => setTouchVideoInteraction(hasTouchVideoInteraction(pointerQuery));
    update();
    if (typeof pointerQuery.addEventListener === 'function') {
      pointerQuery.addEventListener('change', update);
      return () => pointerQuery.removeEventListener('change', update);
    }
    pointerQuery.addListener(update);
    return () => pointerQuery.removeListener(update);
  }, []);

  const fittedVideoSize = React.useMemo(() => {
    if (!videoSize) return null;
    const desktop = viewportSize.width >= 640;
    const shellPadding = desktop ? 32 : 16;
    const headerHeight = desktop ? 86 : 76;
    const controlsReserve = desktop ? 34 : 42;
    const maxDialogHeight = Math.min(viewportSize.height - shellPadding, viewportSize.height * 0.92);
    const maxWidth = Math.max(240, viewportSize.width - shellPadding);
    const maxHeight = Math.max(180, maxDialogHeight - headerHeight - controlsReserve);
    const scale = Math.min(maxWidth / videoSize.width, maxHeight / videoSize.height, 1);
    return {
      width: Math.max(1, Math.round(videoSize.width * scale)),
      height: Math.max(1, Math.round(videoSize.height * scale)),
    };
  }, [videoSize, viewportSize.height, viewportSize.width]);

  return {
    desktopVideoInteraction: viewportSize.width >= 640 && !touchVideoInteraction,
    fittedVideoSize,
  };
}
