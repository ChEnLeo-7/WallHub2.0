import * as React from 'react';

export function getGridColumns(width: number, mobileColumns = 2, desktopColumns = 0) {
  if (!width || width < 1) return 4;
  if (width < 640) return Math.max(1, Math.min(4, Number.parseInt(String(mobileColumns || '2'), 10) || 2));
  const fixedDesktopColumns = (() => {
    const n = Number.parseInt(String(desktopColumns || '0'), 10);
    if (!n) return 0;
    return Math.max(2, Math.min(8, n));
  })();
  if (fixedDesktopColumns) return fixedDesktopColumns;
  const gap = 16;
  const minCardWidth = 210;
  return Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
}

export function useWallpaperLayout(view: 'grid' | 'list', mobileColumns: number, desktopColumns: number) {
  const ref = React.useRef<HTMLElement | null>(null);
  const [columns, setColumns] = React.useState(() =>
    getGridColumns(typeof window === 'undefined' ? 1120 : Math.min(window.innerWidth, 1152), mobileColumns, desktopColumns),
  );

  React.useEffect(() => {
    if (view !== 'grid') return;
    const target = ref.current;
    const update = () => {
      const width = target?.clientWidth || window.innerWidth;
      const nextColumns = getGridColumns(width, mobileColumns, desktopColumns);
      setColumns((current) => (current === nextColumns ? current : nextColumns));
    };
    update();
    if (typeof ResizeObserver === 'undefined' || !target) {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(target);
    return () => observer.disconnect();
  }, [desktopColumns, mobileColumns, view]);

  const rows = columns <= 2 ? 10 : 6;
  return {
    containerRef: ref,
    columns,
    pageSize: view === 'grid' ? columns * rows : 20,
  };
}
