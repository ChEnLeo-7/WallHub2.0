import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';

import { Card } from '@/components/ui/card';
import type { WorkshopItem } from '@/lib/api';
import { HOME_VIEW_MEDIA_LAYOUT_TRANSITION } from '@/lib/motion';
import { useText } from '@/lib/text';
import { cn } from '@/lib/utils';
import { itemType } from '@/lib/workshop';
import { WallpaperCardActions, type HomeCardDefaultAction } from './wallpaper-card/WallpaperCardActions';
import { WallpaperCardMedia } from './wallpaper-card/WallpaperCardMedia';
import { WallpaperCardMetadata } from './wallpaper-card/WallpaperCardMetadata';

export type WallpaperContextMenuAnchor = { x: number; y: number };

type WallpaperCardProps = {
  item: WorkshopItem;
  index: number;
  view: 'grid' | 'list';
  defaultAction: HomeCardDefaultAction;
  onOpen: (item: WorkshopItem) => void;
  onDefaultAction: (item: WorkshopItem) => void;
  onOpenContextMenu: (item: WorkshopItem, anchor: WallpaperContextMenuAnchor) => void;
  suppressLayoutAnimation?: boolean;
};

const MotionCard = motion.create(Card);
const CARD_HOVER_DURATION = 0.25;
const CARD_HOVER_EASE = [0.25, 0.46, 0.45, 0.94] as [number, number, number, number];
const CARD_HOVER_TRANSITION = { duration: CARD_HOVER_DURATION, ease: CARD_HOVER_EASE };

function WallpaperCardComponent({
  item,
  index,
  view,
  defaultAction,
  onOpen,
  onDefaultAction,
  onOpenContextMenu,
  suppressLayoutAnimation = false,
}: WallpaperCardProps) {
  const text = useText();
  const type = itemType(item);
  const title = item.title || text.untitledWallpaper;
  const prefersReducedMotion = useReducedMotion();
  const layoutAnimationEnabled = !suppressLayoutAnimation && !prefersReducedMotion;
  const entryAnimationEnabled = !prefersReducedMotion;
  const preserveAspectLayout = layoutAnimationEnabled ? 'preserve-aspect' as const : false;
  const [cardHovered, setCardHovered] = React.useState(false);
  const [entryFinished, setEntryFinished] = React.useState(!entryAnimationEnabled);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const longPressTimerRef = React.useRef<number | null>(null);
  const touchStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntilRef = React.useRef(0);
  const effectiveAction = defaultAction === 'playVideo' && type !== 'Video' ? 'clientDownload' : defaultAction;
  const actionLabel = effectiveAction === 'playVideo'
    ? text.playVideo
    : effectiveAction === 'backgroundDownload'
      ? text.backgroundDownload
      : effectiveAction === 'openSteamPage'
        ? text.openSteamPage
        : effectiveAction === 'remoteSubscribe'
          ? text.actionSubscribe
          : text.download;
  const typeLabel = type === 'Video' ? text.video : type === 'Web' ? text.web : type === 'Application' ? text.application : text.scene;
  const cardMotionTransition = React.useMemo(() => {
    const interactive = entryFinished || cardHovered;
    return {
      duration: interactive ? CARD_HOVER_DURATION : 0.4,
      delay: interactive ? 0 : Math.min(index * 0.06, 0.36),
      ease: CARD_HOVER_EASE,
      layout: HOME_VIEW_MEDIA_LAYOUT_TRANSITION,
    };
  }, [cardHovered, entryFinished, index]);

  const clearLongPress = React.useCallback(() => {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
    touchStartRef.current = null;
  }, []);
  React.useEffect(() => clearLongPress, [clearLongPress]);
  React.useEffect(() => {
    const card = cardRef.current;
    if (!card) return;
    const preventNativeContextMenu = (event: Event) => event.preventDefault();
    card.addEventListener('contextmenu', preventNativeContextMenu, true);
    return () => card.removeEventListener('contextmenu', preventNativeContextMenu, true);
  }, []);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch') return;
    clearLongPress();
    const point = { x: event.clientX, y: event.clientY };
    touchStartRef.current = point;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      suppressClickUntilRef.current = Date.now() + 800;
      onOpenContextMenu(item, point);
    }, 550);
  };
  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType !== 'touch' || !touchStartRef.current) return;
    if (Math.hypot(event.clientX - touchStartRef.current.x, event.clientY - touchStartRef.current.y) > 12) clearLongPress();
  };

  return (
    <MotionCard
      ref={cardRef}
      layout={layoutAnimationEnabled}
      className={cn(
        'wallpaper-card-shell group relative isolate flex h-full cursor-pointer select-none flex-col overflow-visible border-border bg-card text-card-foreground shadow-none [-webkit-touch-callout:none]',
        view === 'list' && 'grid min-h-[104px] grid-cols-[104px_minmax(0,1fr)_auto] items-stretch sm:min-h-32 sm:grid-cols-[150px_1fr_auto]',
      )}
      initial={entryAnimationEnabled ? { opacity: 0, y: 20 } : false}
      animate={{ opacity: 1, y: cardHovered ? -4 : 0, scale: cardHovered ? 1.01 : 1 }}
      exit={entryAnimationEnabled ? { opacity: 0, y: 8, scale: 0.98 } : undefined}
      transition={!entryAnimationEnabled ? { duration: 0 } : cardMotionTransition}
      whileTap={prefersReducedMotion ? undefined : { scale: 0.98, transition: CARD_HOVER_TRANSITION }}
      onHoverStart={prefersReducedMotion ? undefined : () => setCardHovered(true)}
      onHoverEnd={prefersReducedMotion ? undefined : () => setCardHovered(false)}
      onAnimationComplete={() => setEntryFinished(true)}
      onClick={(event) => {
        if (Date.now() < suppressClickUntilRef.current) {
          event.preventDefault();
          event.stopPropagation();
          return;
        }
        onOpen(item);
      }}
      onContextMenu={(event) => {
        event.preventDefault();
        event.stopPropagation();
        if (Date.now() < suppressClickUntilRef.current) return;
        clearLongPress();
        onOpenContextMenu(item, { x: event.clientX, y: event.clientY });
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={clearLongPress}
      onPointerCancel={clearLongPress}
      onPointerLeave={clearLongPress}
    >
      <WallpaperCardMedia
        previewUrl={item.preview_url}
        previewPending={!!item.detailsPending}
        title={title}
        type={type}
        typeLabel={typeLabel}
        noCoverLabel={text.noCover}
        coverNetworkErrorLabel={text.coverNetworkError}
        view={view}
        layoutAnimationEnabled={layoutAnimationEnabled}
        preserveAspectLayout={preserveAspectLayout}
        reducedMotion={!!prefersReducedMotion}
      />
      <WallpaperCardMetadata item={item} title={title} view={view} preserveAspectLayout={preserveAspectLayout} />
      <WallpaperCardActions
        item={item}
        view={view}
        action={effectiveAction}
        actionLabel={actionLabel}
        layoutAnimationEnabled={layoutAnimationEnabled}
        onDefaultAction={onDefaultAction}
      />
    </MotionCard>
  );
}

export const WallpaperCard = React.memo(WallpaperCardComponent);
