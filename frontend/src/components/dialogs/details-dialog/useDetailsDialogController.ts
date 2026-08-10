import * as React from 'react';
import { useReducedMotion } from 'motion/react';

import type { Details } from '@/lib/api';
import { useText } from '@/lib/text';
import { formatDateOnlyText, shouldCompactDateOnlyText } from '@/lib/utils';
import { itemType } from '@/lib/workshop';
import type { DetailsDialogProps } from './types';

export function useDetailsDialogController({
  item,
  details,
  loading,
  presentation,
  onLoadMoreComments,
}: Pick<DetailsDialogProps, 'item' | 'details' | 'loading' | 'presentation' | 'onLoadMoreComments'>) {
  const text = useText();
  const reduceMotion = useReducedMotion();
  const [commentsLoadingMore, setCommentsLoadingMore] = React.useState(false);
  const [showScrollTop, setShowScrollTop] = React.useState(false);
  const [selectedTags, setSelectedTags] = React.useState<string[]>([]);
  const commentsScrollRootRef = React.useRef<HTMLDivElement | null>(null);
  const commentsSentinelRef = React.useRef<HTMLElement | null>(null);
  const merged = { ...(item || {}), ...(details || {}) } as Details;
  const tags = (merged.tags || []).map((tag) => (typeof tag === 'string' ? tag : tag.tag)).filter(Boolean);
  const type = item ? itemType(merged) : 'Scene';
  const id = String(item?.publishedfileid || merged.publishedfileid || '');
  const wallpaperTitle = String(merged.title || item?.title || text.untitledWallpaper);
  const lastUpdatedText = formatDateOnlyText(merged.time_updated || item?.time_updated, text);
  const compactLastUpdatedText = shouldCompactDateOnlyText(lastUpdatedText);
  const isRedesigned = presentation === 'redesigned';
  const commentsLength = merged.comments?.length || 0;
  const canLoadMoreComments = !!id && !loading && !!details && !!merged.commentsHasMore;

  React.useEffect(() => setSelectedTags([]), [id]);
  const toggleTag = React.useCallback((tag: string) => {
    setSelectedTags((current) => current.includes(tag)
      ? current.filter((selectedTag) => selectedTag !== tag)
      : [...current, tag]);
  }, []);
  const runLoadMore = React.useCallback(async () => {
    if (!canLoadMoreComments || commentsLoadingMore) return;
    setCommentsLoadingMore(true);
    try {
      await onLoadMoreComments(id);
    } finally {
      setCommentsLoadingMore(false);
    }
  }, [canLoadMoreComments, commentsLoadingMore, id, onLoadMoreComments]);

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

  return {
    canLoadMoreComments,
    commentsLoadingMore,
    commentsScrollRootRef,
    commentsSentinelRef,
    compactLastUpdatedText,
    id,
    isRedesigned,
    item,
    lastUpdatedText,
    merged,
    reduceMotion,
    runLoadMore,
    scrollDetailsTop,
    selectedTags,
    showScrollTop,
    tags,
    text,
    toggleTag,
    type,
    wallpaperTitle,
  };
}

export type DetailsDialogController = ReturnType<typeof useDetailsDialogController>;
