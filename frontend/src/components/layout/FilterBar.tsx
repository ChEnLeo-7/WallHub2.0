import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Filter, Shield } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import {
  normalizeRating,
  normalizeRatings,
  primaryRating,
  ratingOptions,
  type Filters,
} from '@/lib/normalizers';
import { useText } from '@/lib/text';
import { cn } from '@/lib/utils';
import { ViewToggle } from './ViewToggle';

export function FilterBar({
  filters,
  genresCount,
  totalGenres,
  homeFilterMultiSelect,
  setFilters,
  nsfw,
  view,
  setView,
  onGenres,
  steamLoggedIn,
  onLoginRequired,
  steamDataSource = 'community',
}: {
  filters: Filters;
  genresCount: number;
  totalGenres: number;
  homeFilterMultiSelect: boolean;
  setFilters: (patch: Partial<Filters>) => void;
  nsfw: boolean;
  view: 'grid' | 'list';
  setView: (view: 'grid' | 'list') => void;
  onGenres: () => void;
  steamLoggedIn: boolean;
  onLoginRequired: () => void;
  steamDataSource?: 'community' | 'webapi' | 'cm';
}) {
  const text = useText();
  const [typeOpen, setTypeOpen] = React.useState(false);
  const [ratingOpen, setRatingOpen] = React.useState(false);
  const typeRootRef = React.useRef<HTMLDivElement | null>(null);
  const ratingRootRef = React.useRef<HTMLDivElement | null>(null);
  const selectedTypes = new Set(filters.types || []);
  const selectedRatings = new Set(normalizeRatings(filters.ratings, nsfw, undefined, filters.rating));
  const typeOptions = [
    { value: 'Scene', label: text.scene },
    { value: 'Video', label: text.video },
    { value: 'Web', label: text.web },
  ];
  const ageOptions = ratingOptions(nsfw, text);
  const typeSummary = selectedTypes.size === 0
    ? text.all
    : typeOptions.filter((option) => selectedTypes.has(option.value)).map((option) => option.label).join(' / ');
  const ratingSummary = selectedRatings.has('')
    ? text.all
    : ageOptions.filter((option) => selectedRatings.has(option.value)).map((option) => option.label).join(' / ') || text.all;
  const personalSortValue = filters.personalFilter ? `personal:${filters.personalFilter}` : filters.sort;
  const personalTypeFilter = !!filters.personalFilter;
  const secondarySortEnabled = !!filters.personalFilter || filters.sort === 'trend';
  const activeGenreCount = genresCount > 0 && genresCount < totalGenres ? genresCount : 0;
  const advancedFilterCount = activeGenreCount + (filters.officialTags || []).length
    + (filters.excludedOfficialTags || []).length + (filters.mobileCompatibleOnly ? 1 : 0) + (filters.resolutions || []).length;
  const handleSortChange = (value: string) => {
    if (value.startsWith('personal:')) {
      if (!steamLoggedIn) {
        onLoginRequired();
        return;
      }
      setFilters({
        personalFilter: value.replace(/^personal:/, ''),
        types: filters.types.slice(0, 1),
      });
      return;
    }
    setFilters({ sort: value, personalFilter: '' });
  };
  const setSingleType = (type: string) => {
    setFilters({ types: type ? [type] : [] });
    setTypeOpen(false);
  };
  const setSingleRating = (rating: string) => {
    const ratings = normalizeRatings([rating], nsfw);
    setFilters({ rating: primaryRating(ratings, nsfw), ratings });
    setRatingOpen(false);
  };
  const toggleType = (type: string) => {
    const next = new Set(selectedTypes);
    if (next.has(type)) next.delete(type);
    else next.add(type);
    setFilters({ types: Array.from(next) });
  };
  const toggleRating = (rating: string) => {
    if (rating === '') {
      setFilters({ rating: '', ratings: [''] });
      setRatingOpen(false);
      return;
    }
    const next = new Set(selectedRatings);
    next.delete('');
    if (next.has(rating)) next.delete(rating);
    else next.add(rating);
    const ratings = normalizeRatings(Array.from(next), nsfw);
    setFilters({ rating: primaryRating(ratings, nsfw), ratings });
  };
  React.useEffect(() => {
    if (!typeOpen && !ratingOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!typeRootRef.current?.contains(target)) setTypeOpen(false);
      if (!ratingRootRef.current?.contains(target)) setRatingOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setTypeOpen(false);
      if (event.key === 'Escape') setRatingOpen(false);
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [ratingOpen, typeOpen]);
  const typeButtonClass = (active: boolean) => cn(
    'flex h-9 w-full items-center justify-between rounded-md border border-input bg-input/45 px-3 text-sm transition-[background-color,border-color,color,filter,transform] active:scale-95 active:brightness-110 hover:bg-input/65',
    active && 'border-primary/30 bg-accent text-accent-foreground',
  );
  return (
    <div className="mx-auto w-full max-w-6xl px-3 pt-2 sm:px-6 sm:pt-6">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.12 }}
        className="grid gap-2 rounded-xl border border-border bg-card p-2 sm:gap-3 sm:p-4"
      >
        <div className="grid grid-cols-2 gap-1.5 sm:gap-3 lg:grid-cols-[1fr_1fr_1fr_1fr_auto_auto] lg:items-end">
          <Select
            label={text.sortBy}
            value={personalSortValue}
            onChange={handleSortChange}
            options={[
              { value: 'trend', label: text.sortTrend },
              { value: 'mostrecent', label: text.sortRecent },
              { value: 'toprated', label: text.sortTopRated },
              { value: 'mostvotes', label: text.sortVotes },
              { value: 'totaluniquesubscribers', label: text.sortSubscribers },
              { separator: true },
              { value: 'personal:mysubscriptions', label: text.sortPersonalSubscriptions },
              { value: 'personal:myfavorites', label: text.sortMyFavorites },
              { value: 'personal:voted', label: text.sortVoted },
              { value: 'personal:friendsfavorites', label: text.sortFriendsFavorites },
              { value: 'personal:friendscreated', label: text.sortFriendsCreated },
              { value: 'personal:followedcreated', label: text.sortFollowedCreated },
            ]}
          />
          <Select
            label={text.timeSort}
            value={filters.personalFilter ? filters.personalSort : filters.days}
            onChange={(value) => {
              if (filters.personalFilter) setFilters({ personalSort: value });
              else if (filters.sort === 'trend') setFilters({ days: value });
            }}
            options={filters.personalFilter
              ? [
                  { value: 'subscriptiondate', label: text.personalSortSubscriptionDate },
                  { value: 'alpha', label: text.personalSortAlphabetical },
                  { value: 'lastupdated', label: text.personalSortLastUpdated },
                  { value: 'creationorder', label: text.personalSortCreationDate },
                ]
                : [
                  { value: '1', label: text.today },
                  { value: '7', label: text.week },
                  { value: '30', label: text.month },
                  ...(steamDataSource === 'community' ? [
                    { value: '90', label: text.threeMonths },
                    { value: '180', label: text.halfYear },
                  ] : []),
                  { value: '365', label: text.year },
                ]}
            disabled={!secondarySortEnabled}
            className={secondarySortEnabled ? '' : 'pointer-events-none opacity-45'}
          />
          <div ref={typeRootRef} className="relative grid gap-1.5 text-xs font-medium text-muted-foreground">
            <span>{text.typeSelect}</span>
            <button
              type="button"
              onClick={() => setTypeOpen((current) => !current)}
              className="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-input/45 px-3 text-left text-sm text-foreground transition-[background-color,border-color,color,filter,transform] active:scale-95 active:brightness-110 hover:bg-input/65"
            >
              <span className="truncate">{typeSummary}</span>
              <Filter className="h-4 w-4 shrink-0 text-muted-foreground" />
            </button>
            <AnimatePresence>
              {typeOpen ? (
                <motion.div
                  initial={{ opacity: 0, y: -4, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -4, scale: 0.98 }}
                  transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}
                  className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-[70] grid gap-1 rounded-lg border border-border bg-popover p-1 text-foreground shadow-panel"
                >
                  <button type="button" className={typeButtonClass(selectedTypes.size === 0)} onClick={() => setSingleType('')}>
                    <span>{text.all}</span>
                    {selectedTypes.size === 0 ? <Check className="h-4 w-4" /> : null}
                  </button>
                  {typeOptions.map((option) => {
                    const active = selectedTypes.has(option.value);
                    return (
                      <button
                        key={option.value}
                        type="button"
                        className={typeButtonClass(active)}
                        onClick={() => (homeFilterMultiSelect && !personalTypeFilter ? toggleType(option.value) : setSingleType(option.value))}
                      >
                        <span>{option.label}</span>
                        {active ? <Check className="h-4 w-4" /> : null}
                      </button>
                    );
                  })}
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>
          {homeFilterMultiSelect ? (
            <div ref={ratingRootRef} className="relative grid gap-1.5 text-xs font-medium text-muted-foreground">
              <span>{text.ageRating}</span>
              <button
                type="button"
                onClick={() => setRatingOpen((current) => !current)}
                className="flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border border-input bg-input/45 px-3 text-left text-sm text-foreground transition-[background-color,border-color,color,filter,transform] active:scale-95 active:brightness-110 hover:bg-input/65"
              >
                <span className="truncate">{ratingSummary}</span>
                <Shield className="h-4 w-4 shrink-0 text-muted-foreground" />
              </button>
              <AnimatePresence>
                {ratingOpen ? (
                  <motion.div
                    initial={{ opacity: 0, y: -4, scale: 0.98 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    exit={{ opacity: 0, y: -4, scale: 0.98 }}
                    transition={{ type: 'spring', stiffness: 420, damping: 34, mass: 0.8 }}
                    className="absolute left-0 right-0 top-[calc(100%+0.35rem)] z-[70] grid gap-1 rounded-lg border border-border bg-popover p-1 text-foreground shadow-panel"
                  >
                    {ageOptions.map((option) => {
                      const active = selectedRatings.has(option.value);
                      return (
                        <button
                          key={option.value || '__all_rating'}
                          type="button"
                          className={typeButtonClass(active)}
                          onClick={() => toggleRating(option.value)}
                        >
                          <span>{option.label}</span>
                          {active ? <Check className="h-4 w-4" /> : null}
                        </button>
                      );
                    })}
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          ) : (
            <Select
              label={text.ageRating}
              value={normalizeRating(filters.rating, nsfw)}
              onChange={(rating) => setSingleRating(rating)}
              options={ageOptions}
            />
          )}
          <Button className="col-span-2 w-full self-end lg:col-span-1 lg:w-auto" variant="outline" onClick={onGenres}>
            <Filter className="h-4 w-4" />
            {text.filter}
            <Badge className="border border-border bg-background text-foreground shadow-sm" variant="outline">
              {advancedFilterCount || text.filterAllShort}
            </Badge>
          </Button>
          <ViewToggle view={view} setView={setView} className="hidden self-end lg:inline-grid" />
        </div>
      </motion.div>
    </div>
  );
}
