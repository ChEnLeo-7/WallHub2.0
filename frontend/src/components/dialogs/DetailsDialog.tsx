import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowUp,
  Clock,
  Copy,
  Download,
  ExternalLink,
  Heart,
  MessageCircle,
  Search,
  Play,
  Shield,
  Star,
  Eye,
  Loader2,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { useText } from '@/lib/text';
import {
  cn,
  formatBytesText,
  formatCount,
  formatDateOnlyText,
  shouldCompactDateOnlyText,
} from '@/lib/utils';
import {
  formatCommentTime,
  itemType,
  localizedItemType,
} from '@/lib/workshop';
import { type WorkshopItem, type Details, type CommentItem } from '@/lib/api';
import { REDESIGNED_DETAILS_PANEL_STYLE } from '../../../../src/shared/detailsPresentation.mjs';
import { BACK_TO_TOP_MOTION, DETAILS_READY_CONTENT_MOTION } from '@/lib/motion';

type HomeCardDefaultAction = 'playVideo' | 'backgroundDownload' | 'clientDownload' | 'openSteamPage';
type DetailsPresentation = 'classic' | 'redesigned';

function Stat({
  icon,
  label,
  value,
  allowFullValue = false,
  compactFullValue = false,
}: {
  icon: React.ReactElement;
  label: string;
  value: React.ReactNode;
  allowFullValue?: boolean;
  compactFullValue?: boolean;
}) {
  const text = useText();
  return (
    <div className="rounded-xl border border-input bg-input/45 p-2 text-center sm:p-3">
      {React.cloneElement(icon, { className: 'mx-auto mb-1 h-3.5 w-3.5 text-muted-foreground sm:mb-2 sm:h-4 sm:w-4' })}
      <div
        className={cn(
          'font-semibold tracking-tight text-foreground',
          allowFullValue
            ? compactFullValue ? 'whitespace-nowrap text-[11px] sm:text-xs' : 'whitespace-nowrap text-xs sm:text-sm'
            : 'truncate text-xs sm:text-sm',
        )}
        title={allowFullValue ? String(value || text.unknown) : undefined}
      >
        {value || text.unknown}
      </div>
      <div className="mt-0.5 text-[10px] text-muted-foreground sm:mt-1 sm:text-[11px]">{label}</div>
    </div>
  );
}

function FocusFact({
  icon,
  label,
  value,
  allowFullValue = false,
  compactFullValue = false,
}: {
  icon: React.ReactElement;
  label: string;
  value: React.ReactNode;
  allowFullValue?: boolean;
  compactFullValue?: boolean;
}) {
  const text = useText();
  return (
    <div className="h-16 rounded-lg border border-border/70 bg-background/35 p-2.5 sm:p-3">
      <div className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground sm:text-[11px]">
        {React.cloneElement(icon, { className: 'h-3.5 w-3.5 shrink-0' })}
        <span className="truncate">{label}</span>
      </div>
      <div
        className={cn(
          'mt-1 font-semibold tracking-tight text-foreground',
          allowFullValue
            ? compactFullValue ? 'whitespace-nowrap text-[11px] sm:text-xs' : 'whitespace-nowrap text-xs sm:text-sm'
            : 'truncate text-xs sm:text-sm',
        )}
        title={allowFullValue ? String(value || text.unknown) : undefined}
      >
        {value || text.unknown}
      </div>
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
  const text = useText();
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
    <div className={cn(
      'grid gap-3',
      keepSearchActionVisible && 'max-h-40 min-h-0 grid-rows-[minmax(0,1fr)_auto]',
    )}>
      <div className={cn(
        'flex flex-wrap gap-1.5',
        keepSearchActionVisible && 'min-h-0 overflow-y-auto overscroll-contain p-1 scrollbar-thin',
      )}>
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
            {tag}
          </button>
        ))}
      </div>
      {selectedTags.length ? (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border/55 bg-background/35 px-2.5 py-2">
          <span className="text-xs text-muted-foreground">{text.selectedTags}: {selectedTags.length}</span>
          <Button type="button" size="sm" className="h-8 gap-1.5 px-2.5 text-xs" onClick={() => onSearchTags?.(selectedTags)}>
            <Search className="h-3.5 w-3.5" />
            {text.searchSelectedTags}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export function DetailsDialog({
  item,
  details,
  loading,
  personalSourceLabel,
  fixedPanelHeight,
  presentation,
  onOpenChange,
  onClientDownload,
  onBackgroundDownload,
  onLoadMoreComments,
  onCopyId,
  homeCardDefaultAction,
  onPlay,
  onOpenSteamPage,
  onAuthor,
  onSearchTags,
}: {
  item: WorkshopItem | null;
  details: Details | null;
  loading: boolean;
  personalSourceLabel?: string;
  fixedPanelHeight: boolean;
  presentation: DetailsPresentation;
  onOpenChange: (open: boolean) => void;
  onClientDownload: (item: WorkshopItem) => void;
  onBackgroundDownload: (item: WorkshopItem) => void;
  onLoadMoreComments: (id: string) => void;
  onCopyId: (id: string) => void;
  homeCardDefaultAction: HomeCardDefaultAction;
  onPlay: (item: WorkshopItem) => void;
  onOpenSteamPage: (item: WorkshopItem) => void;
  onAuthor: (creator?: string) => void;
  onSearchTags?: (tags: string[]) => void;
}) {
  const text = useText();
  const reduceMotion = useReducedMotion();
  const isRedesigned = presentation === 'redesigned';
  const [commentsLoadingMore, setCommentsLoadingMore] = React.useState(false);
  const [showScrollTop, setShowScrollTop] = React.useState(false);
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const commentsScrollRootRef = React.useRef<HTMLDivElement | null>(null);
  const commentsListRef = React.useRef<HTMLDivElement | null>(null);
  const commentsSentinelRef = React.useRef<HTMLElement | null>(null);
  const merged = { ...(item || {}), ...(details || {}) } as Details;
  const tags = (merged.tags || []).map((tag) => (typeof tag === 'string' ? tag : tag.tag)).filter(Boolean);
  const type = item ? itemType(merged) : 'Scene';
  const id = String(item?.publishedfileid || merged.publishedfileid || '');
  const lastUpdatedText = formatDateOnlyText(merged.time_updated || item?.time_updated, text);
  const compactLastUpdatedText = shouldCompactDateOnlyText(lastUpdatedText);
  React.useEffect(() => {
    setSelectedTags([]);
  }, [id]);
  const toggleTag = React.useCallback((tag: string) => {
    setSelectedTags((current) => current.includes(tag)
      ? current.filter((selectedTag) => selectedTag !== tag)
      : [...current, tag]);
  }, []);
  const commentsLength = merged.comments?.length || 0;
  const canLoadMoreComments = !!id && !loading && !!details && !!merged.commentsHasMore;
  const runLoadMore = React.useCallback(async () => {
    if (!canLoadMoreComments || commentsLoadingMore) return;
    setCommentsLoadingMore(true);
    try {
      await onLoadMoreComments(id);
    } finally {
      setCommentsLoadingMore(false);
    }
  }, [canLoadMoreComments, commentsLoadingMore, id, onLoadMoreComments]);
  const onCommentsScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const el = event.currentTarget;
    if (el.scrollTop + el.clientHeight >= el.scrollHeight - 36) runLoadMore();
  };
  React.useEffect(() => {
    if (!canLoadMoreComments || commentsLoadingMore) return;
    const root = commentsScrollRootRef.current;
    const target = commentsSentinelRef.current;
    if (!target) return;
    const frame = window.requestAnimationFrame(() => {
      const scrollRoot = commentsScrollRootRef.current;
      const sentinel = commentsSentinelRef.current;
      if (!scrollRoot || !sentinel) return;
      const rootRect = scrollRoot.getBoundingClientRect();
      const sentinelRect = sentinel.getBoundingClientRect();
      if (sentinelRect.top <= rootRect.bottom + 80) runLoadMore();
    });
    if (typeof IntersectionObserver === 'undefined') {
      return () => window.cancelAnimationFrame(frame);
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) runLoadMore();
      },
      { root, rootMargin: '80px 0px', threshold: 0.01 },
    );
    observer.observe(target);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [canLoadMoreComments, commentsLoadingMore, commentsLength, runLoadMore]);
  React.useEffect(() => {
    const root = commentsScrollRootRef.current;
    if (!root) return;
    const update = () => setShowScrollTop(root.scrollTop > 260);
    update();
    root.addEventListener('scroll', update, { passive: true });
    return () => root.removeEventListener('scroll', update);
  }, [item, details]);
  const scrollDetailsTop = React.useCallback(() => {
    commentsScrollRootRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, []);
  const effectiveDefaultAction = homeCardDefaultAction === 'playVideo' && type !== 'Video' ? 'backgroundDownload' : homeCardDefaultAction;
  const actionVariant = (action: HomeCardDefaultAction) => (effectiveDefaultAction === action ? 'default' : 'secondary');
  const loadedComments = merged.comments?.length ? (
    <div ref={commentsListRef} className="grid gap-2 pr-1" onScroll={onCommentsScroll}>
      {merged.comments.map((comment: CommentItem, index: number) => (
        <div key={`${comment.author}-${index}-${comment.text}`} className="rounded-xl border border-input bg-input/45 p-3">
          <div className="flex justify-between gap-3 text-xs">
            <span className="font-semibold text-primary">{comment.author || text.steamUser}</span>
            <span className="shrink-0 text-right text-muted-foreground">{formatCommentTime(comment)}</span>
          </div>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{comment.text || ''}</p>
        </div>
      ))}
      {merged.commentsHasMore ? (
        <button ref={(node) => { commentsSentinelRef.current = node; }} type="button" className="rounded-xl border border-input bg-input/45 p-3 text-sm text-muted-foreground" onClick={runLoadMore}>
          {commentsLoadingMore ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : text.loadingComments}
        </button>
      ) : null}
    </div>
  ) : (
    <div ref={(node) => { commentsSentinelRef.current = node; }} className="rounded-xl border border-input bg-input/45 p-6 text-center text-sm text-muted-foreground">
      {canLoadMoreComments || commentsLoadingMore ? <Loader2 className="mx-auto h-4 w-4 animate-spin" /> : text.noComments}
    </div>
  );
  return (
    <Dialog
      open={!!item}
      onOpenChange={onOpenChange}
      fixedHeight={fixedPanelHeight}
      title={
        isRedesigned ? (
          <div data-testid="details-redesigned-header" className="flex min-w-0 flex-wrap items-center gap-2 pr-1">
            <div className="min-w-0 max-w-full truncate text-lg font-bold tracking-tight">{merged.title || item?.title || text.untitledWallpaper}</div>
            {id ? (
              <button type="button" className="inline-flex max-w-full items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground" onClick={() => onCopyId(id)}>
                <span className="font-semibold text-foreground">ID</span>
                <span className="truncate">{id}</span>
                <Copy className="h-3 w-3 shrink-0" />
              </button>
            ) : null}
            <button type="button" className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground" onClick={() => onAuthor(merged.creator)}>
              <span className="shrink-0 font-semibold text-foreground">{text.author}</span>
              <span className="truncate">{merged.author || text.loadingAuthor}</span>
            </button>
            {personalSourceLabel ? <span className="rounded-full bg-amber-400/15 px-2.5 py-1 text-xs font-semibold text-amber-500">{personalSourceLabel}</span> : null}
          </div>
        ) : (
          <div className="min-w-0">
            <div className="flex min-w-0 items-baseline gap-3">
              <div className="min-w-0 flex-1 truncate">{merged.title || item?.title || text.untitledWallpaper}</div>
              {personalSourceLabel ? (
                <span className="shrink-0 text-xs font-semibold text-amber-400">来源：{personalSourceLabel}</span>
              ) : null}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-normal text-muted-foreground">
              <button className="inline-flex items-center gap-1 text-primary hover:underline" onClick={() => id && onCopyId(id)}>
                ID {id}
                <Copy className="h-3 w-3" />
              </button>
              <button className="text-primary hover:underline" onClick={() => onAuthor(merged.creator)}>
                {text.author}: {merged.author || text.loadingAuthor}
              </button>
            </div>
          </div>
        )
      }
      className={isRedesigned ? 'max-w-4xl rounded-[1.75rem]' : undefined}
      bodyClassName={isRedesigned ? 'p-5 sm:p-7' : undefined}
      footerClassName={isRedesigned ? 'bg-card/45 px-5 py-4 sm:px-7' : undefined}
      bodyRef={commentsScrollRootRef}
      footer={
        item ? (
          <>
            {type === 'Video' ? (
              <Button variant={actionVariant('playVideo')} onClick={() => onPlay(item)}>
                <Play className="h-4 w-4" />
                {text.playVideo}
              </Button>
            ) : null}
            <Button variant={actionVariant('backgroundDownload')} onClick={() => onBackgroundDownload(item)}>
              <Clock className="h-4 w-4" />
              {text.backgroundDownload}
            </Button>
            <Button variant={actionVariant('clientDownload')} onClick={() => onClientDownload(item)}>
              <Download className="h-4 w-4" />
              {text.download}
            </Button>
            <Button
              className={cn(type !== 'Video' && 'col-span-2 sm:col-span-1')}
              variant={actionVariant('openSteamPage')}
              onClick={() => onOpenSteamPage(item)}
            >
              <ExternalLink className="h-4 w-4" />
              {text.openSteamPage}
            </Button>
          </>
        ) : null
      }
    >
      {isRedesigned ? (
        <div data-testid="details-redesigned-layout" className="grid gap-5 lg:items-start lg:grid-cols-[minmax(0,1.08fr)_minmax(17rem,0.92fr)] lg:grid-rows-[auto_auto] lg:gap-x-6 lg:gap-y-3">
          <div className="min-w-0 space-y-3 lg:contents lg:space-y-0">
            {merged.preview_url || item?.preview_url ? (
              <img className="aspect-[16/9] h-auto w-full rounded-2xl border border-border/70 bg-muted object-cover shadow-sm lg:col-start-1 lg:row-start-1 lg:self-start" src={merged.preview_url || item?.preview_url || ''} alt={merged.title || item?.title || text.untitledWallpaper} />
            ) : (
              <div className="grid aspect-[16/9] h-auto w-full place-items-center rounded-2xl border border-border/70 bg-muted text-sm text-muted-foreground lg:col-start-1 lg:row-start-1 lg:self-start">{text.noCover}</div>
            )}
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:col-start-1 lg:row-start-2 lg:self-start lg:content-start">
              <FocusFact icon={<Heart />} label={text.subscriptions} value={formatCount(merged.subscriptions || item?.subscriptions)} />
              <FocusFact icon={<Star />} label={text.favorites} value={formatCount(merged.favorited || item?.favorited)} />
              <FocusFact icon={<Eye />} label={text.views} value={formatCount(merged.views || item?.views)} />
              <FocusFact icon={<Download />} label={text.fileSize} value={formatBytesText(merged.file_size || item?.file_size, text)} />
              <FocusFact
                icon={<Clock />}
                label={text.lastUpdated}
                value={lastUpdatedText}
                allowFullValue
                compactFullValue={compactLastUpdatedText}
              />
              <FocusFact icon={<Shield />} label={text.type} value={localizedItemType(type, text)} />
            </div>
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
              <DetailTagPicker
                loading={loading}
                tags={tags}
                selectedTags={selectedTags}
                onToggleTag={toggleTag}
                onSearchTags={onSearchTags}
              />
            </div>
            <div className="min-h-0 max-h-64 overflow-y-auto overscroll-contain whitespace-pre-wrap rounded-2xl border border-border/70 bg-muted/60 p-4 text-sm leading-6 text-muted-foreground scrollbar-thin lg:max-h-none" style={REDESIGNED_DETAILS_PANEL_STYLE.description} aria-live="polite">
              {loading ? text.loadingDescription : merged.description || merged.short_description || text.noDescription}
            </div>
          </motion.div>
        </div>
      ) : (
        <div className="grid gap-3 sm:gap-5 lg:grid-cols-[280px_1fr]">
          <div>
            {merged.preview_url || item?.preview_url ? (
              <img className="mx-auto aspect-square w-full max-w-[260px] rounded-xl border border-border object-cover sm:max-w-none" src={merged.preview_url || item?.preview_url || ''} alt={merged.title || ''} />
            ) : (
              <div className="mx-auto grid aspect-square w-full max-w-[260px] place-items-center rounded-xl border border-border bg-input/45 text-sm text-muted-foreground sm:max-w-none">{text.noCover}</div>
            )}
          </div>
          <div className="min-w-0 space-y-3 sm:space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Stat icon={<Heart />} label={text.subscriptions} value={formatCount(merged.subscriptions || item?.subscriptions)} />
              <Stat icon={<Star />} label={text.favorites} value={formatCount(merged.favorited || item?.favorited)} />
              <Stat icon={<Eye />} label={text.views} value={formatCount(merged.views || item?.views)} />
              <Stat icon={<Download />} label={text.fileSize} value={formatBytesText(merged.file_size || item?.file_size, text)} />
              <Stat
                icon={<Clock />}
                label={text.lastUpdated}
                value={lastUpdatedText}
                allowFullValue
                compactFullValue={compactLastUpdatedText}
              />
              <Stat icon={<Shield />} label={text.type} value={localizedItemType(type, text)} />
            </div>
            <div className="min-h-14 py-1">
              <DetailTagPicker
                loading={loading}
                tags={tags}
                selectedTags={selectedTags}
                onToggleTag={toggleTag}
                onSearchTags={onSearchTags}
                keepSearchActionVisible
              />
            </div>
          </div>
          <div className="min-h-32 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-xl border border-input bg-input/45 p-3 text-sm text-muted-foreground scrollbar-thin sm:min-h-36 sm:max-h-56 lg:col-span-2">
            {loading ? text.loadingDescription : merged.description || merged.short_description || text.noDescription}
          </div>
        </div>
      )}
      <section className={cn(
        'mt-4 border-t border-border/50 pt-3 sm:mt-5 sm:pt-4',
        isRedesigned && 'mt-6 border-border/70 pt-5',
        showScrollTop && 'pb-16',
      )}>
        <h3 className="mb-3 flex items-center gap-2 font-semibold">
          <MessageCircle className="h-4 w-4" />
          {text.comments}
        </h3>
        {loading ? (
          isRedesigned ? (
            <div className="grid gap-2" aria-label={text.loadingComments}>
              {[0, 1, 2].map((index) => <div key={index} className={cn('details-comment-skeleton rounded-2xl', index === 2 ? 'h-24' : 'h-20')} />)}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {text.loadingComments}
            </div>
          )
        ) : isRedesigned ? (
          <motion.div
            key={`details-comments-${id}-ready`}
            initial={reduceMotion ? false : DETAILS_READY_CONTENT_MOTION.initial}
            animate={DETAILS_READY_CONTENT_MOTION.animate}
            transition={reduceMotion ? { duration: 0 } : DETAILS_READY_CONTENT_MOTION.transition}
          >
            {loadedComments}
          </motion.div>
        ) : (
          loadedComments
        )}
      </section>
      <AnimatePresence initial={false}>
        {showScrollTop ? (
          <motion.div
            initial={BACK_TO_TOP_MOTION.initial}
            animate={BACK_TO_TOP_MOTION.animate}
            exit={BACK_TO_TOP_MOTION.exit}
            transition={BACK_TO_TOP_MOTION.transition}
            className="sticky bottom-3 z-10 -mt-14 flex justify-end pr-1 pointer-events-none"
          >
            <Button
              type="button"
              size="icon"
              className="pointer-events-auto h-11 w-11 rounded-full shadow-lg shadow-black/35 ring-1 ring-black/10 sm:h-10 sm:w-10"
              onClick={scrollDetailsTop}
              aria-label={text.backToTop}
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </Dialog>
  );
}
