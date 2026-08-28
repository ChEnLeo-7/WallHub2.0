import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { FilterBar } from '@/components/layout/FilterBar';
import { Header } from '@/components/layout/Header';
import { Pagination } from '@/components/layout/Pagination';
import { ViewToggle } from '@/components/layout/ViewToggle';
import type { WallpaperContextMenuAnchor } from '@/components/layout/WallpaperCard';
import { WallpaperGrid } from '@/components/layout/WallpaperGrid';
import { EmptyState, ErrorState, LoadingState, sourceLabel } from '@/components/app/AppPageStates';
import { GENRES } from '@/components/dialogs/GenreSheet';
import { useWallpaperLayout } from '@/hooks/useWallpaperLayout';
import type { useWorkshopQuery } from '@/hooks/useWorkshopQuery';
import type { useAppPreferences } from '@/features/preferences/useAppPreferences';
import type { WorkshopItem } from '@/lib/api';
import { BACK_TO_TOP_MOTION } from '@/lib/motion';
import type { Filters } from '@/lib/normalizers';
import { useText } from '@/lib/text';

const PROXY_DOMAINS = [
  'steamcommunity.com',
  'api.steampowered.com',
  'community.steam-api.com',
  'store.steampowered.com',
  'images.steamusercontent.com',
  'steamuserimages-a.akamaihd.net',
  'steamstatic.com',
  's.team',
  'community.akamai.steamstatic.com',
  'shared.akamai.steamstatic.com',
  'steamstatic-a.akamaihd.net',
  'cdn.akamai.steamstatic.com',
  'community.fastly.steamstatic.com',
  'shared.fastly.steamstatic.com',
  'cdn.fastly.steamstatic.com',
  'cdn.cloudflare.steamstatic.com',
  'steam-chat.com',
  'steam.tv',
  'steambroadcast.akamaized.net',
  'steamvideo-a.akamaihd.net',
];

type Preferences = ReturnType<typeof useAppPreferences>;
type WorkshopQuery = ReturnType<typeof useWorkshopQuery>;

type HomePageProps = {
  preferences: Preferences;
  query: WorkshopQuery;
  page: number;
  setPage: React.Dispatch<React.SetStateAction<number>>;
  nsfw: boolean;
  authorNavigationActive: boolean;
  onAuthorBack: () => void;
  onHome: () => void;
  onSettings: () => void;
  onQueue: () => void;
  queueCount: number;
  onUpdateFilter: (patch: Partial<Filters>) => void;
  onOpenGenres: () => void;
  steamLoggedIn: boolean;
  restoringSteamAccount: boolean;
  onLoginRequired: () => void;
  onOpenItem: (item: WorkshopItem) => void;
  onDefaultAction: (item: WorkshopItem) => void;
  onOpenContextMenu: (item: WorkshopItem, anchor: WallpaperContextMenuAnchor) => void;
  detailsDialogOpen: boolean;
  steamDataSource: 'community' | 'webapi' | 'cm';
};

export function HomePage({
  preferences,
  query,
  page,
  setPage,
  nsfw,
  authorNavigationActive,
  onAuthorBack,
  onHome,
  onSettings,
  onQueue,
  queueCount,
  onUpdateFilter,
  onOpenGenres,
  steamLoggedIn,
  restoringSteamAccount,
  onLoginRequired,
  onOpenItem,
  onDefaultAction,
  onOpenContextMenu,
  detailsDialogOpen,
  steamDataSource,
}: HomePageProps) {
  const {
    filters,
    exactPhrase,
    setExactPhrase,
    homeFilterMultiSelect,
    view,
    setView,
    mobileColumns,
    desktopColumns,
    homePageSize,
    language,
    homeCardDefaultAction,
  } = preferences;
  const {
    items,
    total,
    serverTotalPages,
    dataSource,
    fallbackUsed,
    loading,
    warmingSteamIp,
    error,
    requiresSteamLogin,
    suppressGridLayoutAnimation,
    loadItems,
  } = query;
  const text = useText();
  const { containerRef, columns } = useWallpaperLayout(view, mobileColumns, desktopColumns);
  const [showHomeScrollTop, setShowHomeScrollTop] = React.useState(false);
  const [suppressGridLayoutForDialog, setSuppressGridLayoutForDialog] = React.useState(false);
  const totalPages = Math.max(1, serverTotalPages || Math.ceil(total / homePageSize));

  React.useEffect(() => {
    const update = () => setShowHomeScrollTop(window.scrollY > 360);
    update();
    window.addEventListener('scroll', update, { passive: true });
    return () => window.removeEventListener('scroll', update);
  }, []);

  React.useLayoutEffect(() => {
    if (detailsDialogOpen) {
      setSuppressGridLayoutForDialog(true);
      return;
    }
    let restoreFrame = window.requestAnimationFrame(() => {
      restoreFrame = window.requestAnimationFrame(() => setSuppressGridLayoutForDialog(false));
    });
    return () => window.cancelAnimationFrame(restoreFrame);
  }, [detailsDialogOpen]);

  return (
    <>
      <Header
        filters={filters}
        setFilters={onUpdateFilter}
        exactPhrase={exactPhrase}
        setExactPhrase={setExactPhrase}
        onHome={onHome}
        authorNavigationActive={authorNavigationActive}
        onAuthorBack={onAuthorBack}
        onSettings={onSettings}
        onQueue={onQueue}
        queueCount={queueCount}
      />
      <FilterBar
        filters={filters}
        homeFilterMultiSelect={homeFilterMultiSelect}
        nsfw={nsfw}
        genresCount={filters.genres.length}
        totalGenres={GENRES.length}
        view={view}
        setView={setView}
        setFilters={onUpdateFilter}
        onGenres={onOpenGenres}
        steamLoggedIn={steamLoggedIn}
        onLoginRequired={onLoginRequired}
        steamDataSource={steamDataSource}
      />
      <main ref={containerRef} className="mx-auto w-full max-w-6xl px-3 pb-20 pt-2 sm:px-6 sm:pb-24 sm:pt-6">
        <section className="mb-3 flex flex-wrap items-center justify-between gap-2 sm:mb-5 sm:gap-3">
          <div>
            <h1 className="text-base font-semibold tracking-tight sm:text-lg">{text.homeTitle}</h1>
            <p className="text-xs text-muted-foreground sm:text-sm">
              {loading
                ? (restoringSteamAccount ? text.restoringSteamAccount : warmingSteamIp ? text.warmingSteamIp : text.loading)
                : total
                  ? language === 'en'
                    ? `${text.homeApprox} ${total.toLocaleString('en-US')} ${text.homeItems} · ${totalPages} ${text.homePagesSuffix}`
                    : `${text.homeApprox} ${total.toLocaleString('zh-CN')} ${text.homeItems} · ${text.homePagesPrefix} ${totalPages} ${text.homePagesSuffix}`
                  : text.noResults}
              {!loading && dataSource ? ` · ${sourceLabel(dataSource, fallbackUsed, language)}` : ''}
            </p>
          </div>
          <ViewToggle view={view} setView={setView} className="lg:hidden" />
        </section>
        {loading ? <LoadingState warmingSteamIp={warmingSteamIp} restoringSteamAccount={restoringSteamAccount} /> : null}
        {!loading && error ? <ErrorState message={error} onRetry={loadItems} proxyDomains={PROXY_DOMAINS} requiresSteamLogin={requiresSteamLogin} onLoginRequired={onLoginRequired} /> : null}
        {!loading && !error && !items.length ? <EmptyState /> : null}
        {!loading && !error && items.length ? (
          <>
            <WallpaperGrid
              items={items}
              view={view}
              columns={columns}
              onOpen={onOpenItem}
              defaultAction={homeCardDefaultAction}
              onDefaultAction={onDefaultAction}
              onOpenContextMenu={onOpenContextMenu}
              suppressLayoutAnimation={suppressGridLayoutAnimation || detailsDialogOpen || suppressGridLayoutForDialog}
            />
            <Pagination page={page} totalPages={totalPages} setPage={setPage} />
          </>
        ) : null}
      </main>
      <AnimatePresence>
        {showHomeScrollTop ? (
          <motion.div
            initial={BACK_TO_TOP_MOTION.initial}
            animate={BACK_TO_TOP_MOTION.animate}
            exit={BACK_TO_TOP_MOTION.exit}
            transition={BACK_TO_TOP_MOTION.transition}
            className="pointer-events-none fixed bottom-5 right-3 z-30 sm:bottom-6 sm:right-5"
          >
            <Button
              type="button"
              size="icon"
              className="pointer-events-auto h-11 w-11 rounded-full shadow-lg shadow-black/35 ring-1 ring-black/10 sm:h-10 sm:w-10"
              onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
              aria-label={text.backToTop}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
