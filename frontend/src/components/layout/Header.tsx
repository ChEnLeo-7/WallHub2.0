import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeft, Check, Download, MonitorPlay, Search, Settings } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useText } from '@/lib/text';
import { cn } from '@/lib/utils';
import type { Filters } from '@/lib/normalizers';

export function Header({
  filters,
  setFilters,
  exactPhrase,
  setExactPhrase,
  onHome,
  authorNavigationActive,
  onAuthorBack,
  onSettings,
  onQueue,
  queueCount,
}: {
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
  exactPhrase: boolean;
  setExactPhrase: (enabled: boolean) => void;
  onHome: () => void;
  authorNavigationActive: boolean;
  onAuthorBack: () => void;
  onSettings: () => void;
  onQueue: () => void;
  queueCount: number;
}) {
  const text = useText();
  const [draft, setDraft] = React.useState(filters.search);
  const [searchFocused, setSearchFocused] = React.useState(false);
  React.useEffect(() => setDraft(filters.search), [filters.search]);
  const searchHint = text.searchHint;
  return (
    <header className="sticky top-0 z-40 border-b border-border/50 bg-background/95 backdrop-blur-sm">
      <div className="mx-auto flex min-h-12 max-w-6xl items-center gap-2 px-3 py-2 sm:min-h-14 sm:gap-3 sm:px-6">
        <button
          type="button"
          onClick={authorNavigationActive ? onAuthorBack : onHome}
          className="flex shrink-0 items-center gap-1.5 rounded-md text-[13px] font-semibold tracking-tight text-foreground transition-[filter,transform] active:scale-95 active:brightness-110 sm:gap-2 sm:text-base"
          aria-label={authorNavigationActive ? text.back : 'WallHub'}
        >
          {authorNavigationActive ? (
            <>
              <ArrowLeft className="h-4 w-4 text-primary sm:h-5 sm:w-5" />
              <span>{text.back}</span>
            </>
          ) : (
            <>
              <MonitorPlay className="hidden h-5 w-5 text-primary sm:block" />
              <span>WallHub</span>
            </>
          )}
        </button>
        <form
          className="relative min-w-0 flex-1"
          onSubmit={(event) => {
            event.preventDefault();
            setFilters({ search: draft.trim() });
          }}
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={draft}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => window.setTimeout(() => setSearchFocused(false), 120)}
            onChange={(event) => setDraft(event.target.value)}
            className="peer h-9 overflow-x-auto pl-9 pr-10 text-sm placeholder:text-transparent sm:placeholder:text-muted-foreground"
            placeholder={searchHint}
          />
          {!draft ? (
            <span className="pointer-events-none absolute left-9 right-10 top-1/2 block -translate-y-1/2 overflow-hidden text-sm text-muted-foreground sm:hidden">
              <span className="mobile-search-hint inline-flex min-w-max whitespace-nowrap">
                <span className="pr-8">{searchHint}</span>
                <span className="pr-8" aria-hidden="true">{searchHint}</span>
              </span>
            </span>
          ) : null}
          <AnimatePresence>
            {draft.trim() && searchFocused ? (
              <motion.button
                type="button"
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                transition={{ duration: 0.14 }}
                onClick={() => setExactPhrase(!exactPhrase)}
                className={cn(
                  'absolute left-0 top-[calc(100%+0.35rem)] z-50 inline-flex h-8 items-center gap-2 rounded-md border border-input bg-popover/95 px-2.5 text-xs text-muted-foreground shadow-panel backdrop-blur transition-[background-color,color,transform,filter] active:scale-95 active:brightness-110',
                  exactPhrase && 'border-primary/30 bg-accent text-accent-foreground',
                )}
              >
                <span className={cn('grid h-4 w-4 place-items-center rounded border border-input bg-background', exactPhrase && 'border-primary bg-primary text-primary-foreground')}>
                  {exactPhrase ? <Check className="h-3 w-3" /> : null}
                </span>
                {text.exactPhrase}
              </motion.button>
            ) : null}
          </AnimatePresence>
          <Button className="absolute right-1 top-1" size="icon-xs" type="submit" aria-label={text.search}>
            <Search className="h-3.5 w-3.5" />
          </Button>
        </form>
        <div className="flex shrink-0 justify-end gap-1.5 sm:gap-2">
          <Button className="h-8 w-8 sm:h-9 sm:w-9" variant="outline" size="icon-xs" onClick={onSettings} aria-label={text.settings}>
            <Settings className="h-4 w-4" />
          </Button>
          <Button variant="outline" size="icon-xs" onClick={onQueue} className="relative h-8 w-8 sm:h-9 sm:w-9" aria-label={text.queue}>
            <Download className="h-4 w-4" />
            {queueCount ? <span className="absolute -right-1 -top-1 rounded-full bg-destructive px-1.5 text-[10px] text-white">{queueCount}</span> : null}
          </Button>
        </div>
      </div>
    </header>
  );
}
