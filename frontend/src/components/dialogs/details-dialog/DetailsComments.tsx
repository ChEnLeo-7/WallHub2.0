import { AnimatePresence, motion } from 'motion/react';
import { ArrowUp, Loader2, MessageCircle } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { CommentItem } from '@/lib/api';
import { BACK_TO_TOP_MOTION, DETAILS_READY_CONTENT_MOTION } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { formatCommentTime } from '@/lib/workshop';
import type { DetailsDialogController } from './useDetailsDialogController';

export function DetailsComments({ controller, loading }: { controller: DetailsDialogController; loading: boolean }) {
  const {
    canLoadMoreComments,
    commentsLoadingMore,
    commentsScrollRootRef,
    commentsSentinelRef,
    id,
    isRedesigned,
    merged,
    reduceMotion,
    runLoadMore,
    scrollDetailsTop,
    showScrollTop,
    text,
  } = controller;
  const loadedComments = merged.comments?.length ? (
    <div
      className="grid gap-2 pr-1"
      onScroll={(event) => {
        const el = event.currentTarget;
        if (el.scrollTop + el.clientHeight >= el.scrollHeight - 36) runLoadMore();
      }}
    >
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
    <>
      <section className={cn(
        'mt-4 border-t border-border/50 pt-3 sm:mt-5 sm:pt-4',
        isRedesigned && 'mt-6 border-border/70 pt-5',
        showScrollTop && 'pb-16',
      )}>
        <h3 className="mb-3 flex items-center gap-2 font-semibold"><MessageCircle className="h-4 w-4" />{text.comments}</h3>
        {loading ? (
          isRedesigned ? (
            <div className="grid gap-2" aria-label={text.loadingComments}>
              {[0, 1, 2].map((index) => <div key={index} className={cn('details-comment-skeleton rounded-2xl', index === 2 ? 'h-24' : 'h-20')} />)}
            </div>
          ) : (
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />{text.loadingComments}</div>
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
        ) : loadedComments}
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
            <Button type="button" size="icon" className="pointer-events-auto h-11 w-11 rounded-full shadow-lg shadow-black/35 ring-1 ring-black/10 sm:h-10 sm:w-10" onClick={scrollDetailsTop} aria-label={text.backToTop}>
              <ArrowUp className="h-4 w-4" />
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
