import * as React from 'react';
import type { WorkshopItem } from '@/lib/api';
import type { Filters } from '@/lib/normalizers';
import type { WorkshopQuerySnapshot } from '@/hooks/useWorkshopQuery';

type AuthorNavigationSnapshot = WorkshopQuerySnapshot & { scrollY: number };

type UseAuthorNavigationOptions = {
  filters: Filters;
  exactPhrase: boolean;
  page: number;
  querySnapshot: WorkshopQuerySnapshot;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  setExactPhrase: React.Dispatch<React.SetStateAction<boolean>>;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  setSelected: React.Dispatch<React.SetStateAction<WorkshopItem | null>>;
  updateFilter: (patch: Partial<Filters>) => void;
  cancelActiveQuery: () => void;
  restoreWorkshopState: (snapshot: WorkshopQuerySnapshot) => void;
};

export function useAuthorNavigation({
  filters,
  exactPhrase,
  page,
  querySnapshot,
  setFilters,
  setExactPhrase,
  setPage,
  setSelected,
  updateFilter,
  cancelActiveQuery,
  restoreWorkshopState,
}: UseAuthorNavigationOptions) {
  const [active, setActive] = React.useState(false);
  const snapshotRef = React.useRef<AuthorNavigationSnapshot | null>(null);

  const openAuthor = React.useCallback((creator?: string) => {
    if (!creator) return;
    if (!snapshotRef.current) {
      snapshotRef.current = { ...querySnapshot, filters, exactPhrase, page, scrollY: window.scrollY };
      setActive(true);
    }
    cancelActiveQuery();
    setSelected(null);
    updateFilter({ search: `author:${creator}` });
  }, [cancelActiveQuery, exactPhrase, filters, page, querySnapshot, setSelected, updateFilter]);

  const restore = React.useCallback(() => {
    const snapshot = snapshotRef.current;
    if (!snapshot) return;
    snapshotRef.current = null;
    restoreWorkshopState(snapshot);
    setActive(false);
    setFilters(snapshot.filters);
    setExactPhrase(snapshot.exactPhrase);
    setPage(snapshot.page);
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => window.scrollTo({ top: snapshot.scrollY, behavior: 'auto' }));
    });
  }, [restoreWorkshopState, setExactPhrase, setFilters, setPage]);

  const clear = React.useCallback(() => {
    snapshotRef.current = null;
    setActive(false);
  }, []);

  return { active, openAuthor, restore, clear };
}
