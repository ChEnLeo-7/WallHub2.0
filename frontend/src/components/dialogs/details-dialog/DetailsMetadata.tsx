import * as React from 'react';
import { motion } from 'motion/react';
import { Clock, Download, Eye, Heart, Search, Shield, Star } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { LanguageContext, useText } from '@/lib/text';
import { REDESIGNED_DETAILS_PANEL_STYLE } from '@/lib/detailsPresentation.mjs';
import { DETAILS_READY_CONTENT_MOTION } from '@/lib/motion';
import { cn, formatBytesText, formatCount } from '@/lib/utils';
import { localizedItemType, localizedWorkshopTag } from '@/lib/workshop';
import type { DetailsDialogController } from './useDetailsDialogController';

function Fact({
  icon,
  label,
  value,
  focused,
  allowFullValue = false,
  compactFullValue = false,
}: {
  icon: React.ReactElement<{ className?: string }>;
  label: string;
  value: React.ReactNode;
  focused: boolean;
  allowFullValue?: boolean;
  compactFullValue?: boolean;
}) {
  const text = useText();
  return (
    <div className={focused ? 'h-16 rounded-lg border border-border/70 bg-background/35 p-2.5 sm:p-3' : 'rounded-xl border border-input bg-input/45 p-2 text-center sm:p-3'}>
      {focused ? (
        <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground sm:text-[11px]">
          {React.cloneElement(icon, { className: 'h-3.5 w-3.5 shrink-0' })}
          <span className="truncate">{label}</span>
        </div>
      ) : React.cloneElement(icon, { className: 'mx-auto mb-1 h-3.5 w-3.5 text-muted-foreground sm:mb-2 sm:h-4 sm:w-4' })}
      <div
        className={cn(
          focused ? 'mt-1 font-semibold tracking-tight text-foreground' : 'font-semibold tracking-tight text-foreground',
          allowFullValue
            ? compactFullValue ? 'whitespace-nowrap text-[11px] sm:text-xs' : 'whitespace-nowrap text-xs sm:text-sm'
            : 'truncate text-xs sm:text-sm',
        )}
        title={allowFullValue ? String(value || text.unknown) : undefined}
      >
        {value || text.unknown}
      </div>
      {!focused ? <div className="mt-0.5 text-[10px] text-muted-foreground sm:mt-1 sm:text-[11px]">{label}</div> : null}
    </div>
  );
}

function DetailTagPicker({
  loading,
  tags,
  selectedTags,
  onToggleTag,
  onSearchTags,
  keepSearchActionVisible = false,
}: {
  loading: boolean;
  tags: string[];
  selectedTags: string[];
  onToggleTag: (tag: string) => void;
  onSearchTags?: (tags: string[]) => void;
  keepSearchActionVisible?: boolean;
}) {
  const { language, text } = React.useContext(LanguageContext);
  if (loading) {
    return (
      <div className="grid gap-2" aria-label={text.loading}>
        <div className="h-4 w-3/4 animate-pulse rounded-full bg-muted-foreground/15" />
        <div className="h-4 w-full animate-pulse rounded-full bg-muted-foreground/15" />
        <div className="h-4 w-2/3 animate-pulse rounded-full bg-muted-foreground/15" />
      </div>
    );
  }
  if (!tags.length) return <span className="text-sm text-muted-foreground">{text.unknown}</span>;
  return (
    <div className={cn('grid gap-3', keepSearchActionVisible && 'max-h-40 min-h-0 grid-rows-[minmax(0,1fr)_auto]')}>
      <div className={cn('flex flex-wrap gap-1.5', keepSearchActionVisible && 'min-h-0 overflow-y-auto overscroll-contain p-1 scrollbar-thin')}>
        {tags.map((tag) => (
          <button
            key={tag}
            type="button"
            className={cn(
              'details-metadata-tag inline-flex items-center !rounded-lg border px-2.5 py-1 text-xs font-medium shadow-sm',
              selectedTags.includes(tag) && 'details-metadata-tag--selected',
            )}
            aria-pressed={selectedTags.includes(tag)}
            onClick={() => onToggleTag(tag)}
          >
            {localizedWorkshopTag(tag, language, text)}
          </button>
        ))}
      </div>
      {selectedTags.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/55 bg-background/35 px-2.5 py-2">
          <span className="text-xs text-muted-foreground">{text.selectedTags}: {selectedTags.length}</span>
          <Button type="button" size="sm" className="h-8 gap-1.5 px-2.5 text-xs" onClick={() => onSearchTags?.(selectedTags)}>
            <Search className="h-3.5 w-3.5" />{text.searchSelectedTags}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function Facts({ controller, focused }: { controller: DetailsDialogController; focused: boolean }) {
  const { compactLastUpdatedText, item, lastUpdatedText, merged, text, type } = controller;
  return (
    <div className={focused
      ? 'grid grid-cols-2 gap-2 sm:grid-cols-3 lg:col-start-1 lg:row-start-2 lg:self-start lg:content-start'
      : 'grid grid-cols-3 gap-2'}>
      <Fact focused={focused} icon={<Heart />} label={text.subscriptions} value={formatCount(merged.subscriptions || item?.subscriptions)} />
      <Fact focused={focused} icon={<Star />} label={text.favorites} value={formatCount(merged.favorited || item?.favorited)} />
      <Fact focused={focused} icon={<Eye />} label={text.views} value={formatCount(merged.views || item?.views)} />
      <Fact focused={focused} icon={<Download />} label={text.fileSize} value={formatBytesText(merged.file_size || item?.file_size, text)} />
      <Fact focused={focused} icon={<Clock />} label={text.lastUpdated} value={lastUpdatedText} allowFullValue compactFullValue={compactLastUpdatedText} />
      <Fact focused={focused} icon={<Shield />} label={text.type} value={localizedItemType(type, text)} />
    </div>
  );
}

export function DetailsMetadata({
  controller,
  loading,
  onSearchTags,
}: {
  controller: DetailsDialogController;
  loading: boolean;
  onSearchTags?: (tags: string[]) => void;
}) {
  const {
    id, isRedesigned, item, merged, reduceMotion, selectedTags, tags, text, toggleTag,
  } = controller;
  const previewUrl = merged.preview_url || item?.preview_url || '';
  if (isRedesigned) {
    return (
      <div data-testid="details-redesigned-layout" className="grid gap-5 lg:items-start lg:grid-cols-[minmax(0,1.08fr)_minmax(17rem,0.92fr)] lg:grid-rows-[auto_auto] lg:gap-x-6 lg:gap-y-3">
        <div className="min-w-0 space-y-3 lg:contents lg:space-y-0">
          {previewUrl ? (
            <img className="aspect-[16/9] h-auto w-full rounded-2xl border border-border/70 bg-muted object-cover shadow-sm lg:col-start-1 lg:row-start-1 lg:self-start" src={previewUrl} alt={merged.title || text.untitledWallpaper} />
          ) : (
            <div className="grid aspect-[16/9] h-auto w-full place-items-center rounded-2xl border border-border/70 bg-muted text-sm text-muted-foreground lg:col-start-1 lg:row-start-1 lg:self-start">{text.noCover}</div>
          )}
          <Facts controller={controller} focused />
        </div>
        <motion.div
          key={`details-late-content-${id}-${loading ? 'loading' : 'ready'}`}
          initial={loading || reduceMotion ? false : DETAILS_READY_CONTENT_MOTION.initial}
          animate={DETAILS_READY_CONTENT_MOTION.animate}
          transition={reduceMotion ? { duration: 0 } : DETAILS_READY_CONTENT_MOTION.transition}
          className="grid min-w-0 min-h-0 overflow-hidden grid-rows-[auto_minmax(0,1fr)] gap-3 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-stretch lg:[contain:size]"
          style={REDESIGNED_DETAILS_PANEL_STYLE.rightColumn}
        >
          <div className="min-h-[5.5rem] rounded-2xl border border-border/70 bg-muted/60 p-3.5">
            <DetailTagPicker loading={loading} tags={tags} selectedTags={selectedTags} onToggleTag={toggleTag} onSearchTags={onSearchTags} />
          </div>
          <div className="min-h-0 max-h-64 overflow-y-auto overscroll-contain whitespace-pre-wrap rounded-2xl border border-border/70 bg-muted/60 p-4 text-sm leading-6 text-muted-foreground scrollbar-thin lg:max-h-none" style={REDESIGNED_DETAILS_PANEL_STYLE.description} aria-live="polite">
            {loading ? text.loadingDescription : merged.description || merged.short_description || text.noDescription}
          </div>
        </motion.div>
      </div>
    );
  }
  return (
    <div className="grid gap-3 sm:gap-5 lg:grid-cols-[280px_1fr]">
      <div>
        {previewUrl ? (
          <img className="mx-auto aspect-square w-full max-w-[260px] rounded-xl border border-border object-cover sm:max-w-none" src={previewUrl} alt={merged.title || ''} />
        ) : (
          <div className="mx-auto grid aspect-square w-full max-w-[260px] place-items-center rounded-xl border border-border bg-input/45 text-sm text-muted-foreground sm:max-w-none">{text.noCover}</div>
        )}
      </div>
      <div className="min-w-0 space-y-3 sm:space-y-4">
        <Facts controller={controller} focused={false} />
        <div className="min-h-14 py-1">
          <DetailTagPicker loading={loading} tags={tags} selectedTags={selectedTags} onToggleTag={toggleTag} onSearchTags={onSearchTags} keepSearchActionVisible />
        </div>
      </div>
      <div className="min-h-32 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl border border-input bg-input/45 p-3 text-sm text-muted-foreground scrollbar-thin sm:min-h-36 sm:max-h-56 lg:col-span-2">
        {loading ? text.loadingDescription : merged.description || merged.short_description || text.noDescription}
      </div>
    </div>
  );
}
