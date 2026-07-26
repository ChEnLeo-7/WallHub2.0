import * as React from 'react';
import { motion, useReducedMotion } from 'motion/react';
import { BellPlus, Clock, Download, ExternalLink, Heart, Play, Star } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { WorkshopItem } from '@/lib/api';
import { HOME_VIEW_CARD_LAYOUT_TRANSITION, HOME_VIEW_MEDIA_LAYOUT_TRANSITION } from '@/lib/motion';
import { useText } from '@/lib/text';
import { cn, formatBytesText, formatCount } from '@/lib/utils';
import { itemType } from '@/lib/workshop';

type HomeCardDefaultAction = 'playVideo' | 'backgroundDownload' | 'clientDownload' | 'openSteamPage' | 'remoteSubscribe';

export type WallpaperContextMenuAnchor = {
  x: number;
  y: number;
};

const MotionCard = motion.create(Card);
const MotionCardContent = motion.create(CardContent);

type ActionButtonSize = {
  width: number;
  height: number;
};

const HOME_VIEW_BUTTON_LAYOUT_DURATION = HOME_VIEW_CARD_LAYOUT_TRANSITION.duration * 1000;
const CARD_HOVER_DURATION = 0.25;
const CARD_HOVER_EASE = [0.25, 0.46, 0.45, 0.94] as [number, number, number, number];
const CARD_HOVER_TRANSITION = { duration: CARD_HOVER_DURATION, ease: CARD_HOVER_EASE };
const [
  HOME_VIEW_BUTTON_FIRST_X_CONTROL_POINT,
  HOME_VIEW_BUTTON_FIRST_Y_CONTROL_POINT,
  HOME_VIEW_BUTTON_SECOND_X_CONTROL_POINT,
  HOME_VIEW_BUTTON_SECOND_Y_CONTROL_POINT,
] = HOME_VIEW_CARD_LAYOUT_TRANSITION.ease;

function cubicBezierCoordinate(timeParameter: number, firstControlPoint: number, secondControlPoint: number) {
  const inverseTimeParameter = 1 - timeParameter;
  return (
    3 * inverseTimeParameter * inverseTimeParameter * timeParameter * firstControlPoint +
    3 * inverseTimeParameter * timeParameter * timeParameter * secondControlPoint +
    timeParameter * timeParameter * timeParameter
  );
}

function easeHomeViewLayout(progress: number) {
  if (progress <= 0 || progress >= 1) {
    return progress;
  }

  let lowerBound = 0;
  let upperBound = 1;
  let timeParameter = progress;

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const xCoordinate = cubicBezierCoordinate(
      timeParameter,
      HOME_VIEW_BUTTON_FIRST_X_CONTROL_POINT,
      HOME_VIEW_BUTTON_SECOND_X_CONTROL_POINT,
    );

    if (xCoordinate < progress) {
      lowerBound = timeParameter;
    } else {
      upperBound = timeParameter;
    }

    timeParameter = (lowerBound + upperBound) / 2;
  }

  return cubicBezierCoordinate(
    timeParameter,
    HOME_VIEW_BUTTON_FIRST_Y_CONTROL_POINT,
    HOME_VIEW_BUTTON_SECOND_Y_CONTROL_POINT,
  );
}

function readActionButtonSize(button: HTMLButtonElement): ActionButtonSize {
  return {
    width: button.offsetWidth,
    height: button.offsetHeight,
  };
}

function useActionButtonScale(view: 'grid' | 'list', layoutAnimationEnabled: boolean) {
  const actionButtonRef = React.useRef<HTMLButtonElement>(null);
  const actionContentRef = React.useRef<HTMLSpanElement>(null);
  const animationFrameRef = React.useRef<number | null>(null);
  const animationIdentifierRef = React.useRef(0);
  const previousSizeRef = React.useRef<ActionButtonSize | null>(null);
  const previousViewRef = React.useRef(view);

  const clearTransforms = React.useCallback(() => {
    const actionButton = actionButtonRef.current;
    const actionContent = actionContentRef.current;

    if (actionButton) {
      actionButton.style.transform = '';
      actionButton.style.transformOrigin = '';
      actionButton.style.transition = '';
      actionButton.style.willChange = '';
    }

    if (actionContent) {
      actionContent.style.transform = '';
      actionContent.style.transformOrigin = '';
      actionContent.style.willChange = '';
    }
  }, []);

  const cancelAnimation = React.useCallback(() => {
    animationIdentifierRef.current += 1;

    if (animationFrameRef.current !== null) {
      cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }

    clearTransforms();
  }, [clearTransforms]);

  React.useLayoutEffect(() => {
    const actionButton = actionButtonRef.current;

    if (!actionButton) {
      return;
    }

    const viewChanged = previousViewRef.current !== view;
    cancelAnimation();

    const nextSize = readActionButtonSize(actionButton);
    const previousSize = previousSizeRef.current;

    previousViewRef.current = view;
    previousSizeRef.current = nextSize;

    if (!layoutAnimationEnabled || !viewChanged || !previousSize) {
      return;
    }

    if (
      previousSize.width <= 0 ||
      previousSize.height <= 0 ||
      nextSize.width <= 0 ||
      nextSize.height <= 0
    ) {
      return;
    }

    const initialScaleX = previousSize.width / nextSize.width;
    const initialScaleY = previousSize.height / nextSize.height;
    const layoutChanged =
      Math.abs(initialScaleX - 1) > 0.01 ||
      Math.abs(initialScaleY - 1) > 0.01;

    if (!layoutChanged) {
      return;
    }

    const actionContent = actionContentRef.current;
    const animationIdentifier = animationIdentifierRef.current + 1;
    const animationStartedAt = performance.now();

    animationIdentifierRef.current = animationIdentifier;
    actionButton.style.transformOrigin = 'top left';
    actionButton.style.transition = 'none';
    actionButton.style.willChange = 'transform';

    if (actionContent) {
      actionContent.style.transformOrigin = 'center';
      actionContent.style.willChange = 'transform';
    }

    const renderFrame = (frameTimestamp: number) => {
      if (animationIdentifierRef.current !== animationIdentifier) {
        return;
      }

      const elapsed = frameTimestamp - animationStartedAt;
      const progress = Math.min(elapsed / HOME_VIEW_BUTTON_LAYOUT_DURATION, 1);
      const easedProgress = easeHomeViewLayout(progress);
      const remainingProgress = 1 - easedProgress;
      const currentScaleX = 1 + (initialScaleX - 1) * remainingProgress;
      const currentScaleY = 1 + (initialScaleY - 1) * remainingProgress;

      actionButton.style.transform = `scale(${currentScaleX}, ${currentScaleY})`;

      if (actionContent) {
        actionContent.style.transform = `scale(${1 / currentScaleX}, ${1 / currentScaleY})`;
      }

      if (progress >= 1) {
        animationFrameRef.current = null;
        clearTransforms();
        return;
      }

      animationFrameRef.current = requestAnimationFrame(renderFrame);
    };

    renderFrame(animationStartedAt);
    animationFrameRef.current = requestAnimationFrame(renderFrame);
  }, [cancelAnimation, clearTransforms, layoutAnimationEnabled, view]);

  React.useLayoutEffect(() => {
    const actionButton = actionButtonRef.current;

    if (!actionButton) {
      return;
    }

    const updateLayoutSnapshot = () => {
      if (animationFrameRef.current !== null) {
        return;
      }

      previousSizeRef.current = readActionButtonSize(actionButton);
    };

    updateLayoutSnapshot();

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', updateLayoutSnapshot);
      return () => window.removeEventListener('resize', updateLayoutSnapshot);
    }

    const observer = new ResizeObserver(updateLayoutSnapshot);
    observer.observe(actionButton);

    return () => observer.disconnect();
  }, []);

  React.useEffect(() => cancelAnimation, [cancelAnimation]);

  return { actionButtonRef, actionContentRef };
}

function useViewportActivity(ref: React.RefObject<HTMLElement>, disabled: boolean) {
  const [active, setActive] = React.useState(false);

  React.useEffect(() => {
    if (disabled) {
      setActive(false);
      return;
    }
    const element = ref.current;
    if (!element || typeof IntersectionObserver === 'undefined') {
      setActive(true);
      return;
    }
    const observer = new IntersectionObserver(
      ([entry]) => setActive(!!entry?.isIntersecting),
      { rootMargin: '128px 0px' },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [disabled, ref]);

  return active;
}

function WallpaperCardComponent({
  item,
  index,
  view,
  defaultAction,
  onOpen,
  onDefaultAction,
  onOpenContextMenu,
  suppressLayoutAnimation = false,
}: {
  item: WorkshopItem;
  index: number;
  view: 'grid' | 'list';
  defaultAction: HomeCardDefaultAction;
  onOpen: (item: WorkshopItem) => void;
  onDefaultAction: (item: WorkshopItem) => void;
  onOpenContextMenu: (item: WorkshopItem, anchor: WallpaperContextMenuAnchor) => void;
  suppressLayoutAnimation?: boolean;
}) {
  const type = itemType(item);
  const text = useText();
  const title = item.title || text.untitledWallpaper;
  const prefersReducedMotion = useReducedMotion();
  const layoutAnimationEnabled = !suppressLayoutAnimation && !prefersReducedMotion;
  const entryAnimationEnabled = !prefersReducedMotion;
  const [cardHovered, setCardHovered] = React.useState(false);
  const [entryFinished, setEntryFinished] = React.useState(!entryAnimationEnabled);
  const preserveAspectLayout = layoutAnimationEnabled ? 'preserve-aspect' : false;
  const { actionButtonRef, actionContentRef } = useActionButtonScale(view, layoutAnimationEnabled);
  const cardRef = React.useRef<HTMLDivElement>(null);
  const mediaRef = React.useRef<HTMLDivElement>(null);
  const longPressTimerRef = React.useRef<number | null>(null);
  const touchStartRef = React.useRef<{ x: number; y: number } | null>(null);
  const suppressClickUntilRef = React.useRef(0);
  const equalizerActive = useViewportActivity(mediaRef, !!prefersReducedMotion);
  const cardMotionTransition = React.useMemo(() => {
    const interactive = entryFinished || cardHovered;
    return {
      duration: interactive ? CARD_HOVER_DURATION : 0.4,
      delay: interactive ? 0 : Math.min(index * 0.06, 0.36),
      ease: CARD_HOVER_EASE,
      layout: HOME_VIEW_MEDIA_LAYOUT_TRANSITION,
    };
  }, [cardHovered, entryFinished, index]);
  const effectiveAction = defaultAction === 'playVideo' && type !== 'Video' ? 'clientDownload' : defaultAction;
  const ActionIcon =
    effectiveAction === 'playVideo'
      ? Play
      : effectiveAction === 'backgroundDownload'
        ? Clock
        : effectiveAction === 'openSteamPage'
          ? ExternalLink
          : effectiveAction === 'remoteSubscribe'
            ? BellPlus
          : Download;
  const actionLabel =
    effectiveAction === 'playVideo'
      ? text.playVideo
      : effectiveAction === 'backgroundDownload'
        ? text.backgroundDownload
        : effectiveAction === 'openSteamPage'
          ? text.openSteamPage
          : effectiveAction === 'remoteSubscribe'
            ? text.actionSubscribe
            : text.download;
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
    const distance = Math.hypot(event.clientX - touchStartRef.current.x, event.clientY - touchStartRef.current.y);
    if (distance > 12) clearLongPress();
  };
  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (Date.now() < suppressClickUntilRef.current) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    onOpen(item);
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
      onClick={handleCardClick}
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
      <motion.div
        ref={mediaRef}
        layout={preserveAspectLayout}
        layoutDependency={view}
        transition={{ layout: HOME_VIEW_MEDIA_LAYOUT_TRANSITION }}
        className={cn(
          'relative z-10 aspect-square w-full overflow-hidden bg-muted',
          view === 'grid' ? 'rounded-t-xl' : 'rounded-l-xl',
        )}
        >
          {item.preview_url ? (
            <img className="pointer-events-none h-full w-full select-none object-cover transition-transform duration-[250ms] ease-[cubic-bezier(0.25,0.46,0.45,0.94)] group-hover:scale-105" src={item.preview_url} alt={title} loading="lazy" decoding="async" draggable={false} />
          ) : (
            <div className="grid h-full place-items-center text-muted-foreground">{text.noCover}</div>
          )}
        </motion.div>
        <motion.div
          aria-hidden="true"
          layout={preserveAspectLayout}
          layoutDependency={view}
          transition={{ layout: HOME_VIEW_MEDIA_LAYOUT_TRANSITION }}
          className={cn(
            'pointer-events-none absolute left-0 top-0 z-20 aspect-square',
            view === 'grid' ? 'w-full' : 'w-[104px] sm:w-[150px]',
          )}
        >
          <motion.div
            layout={layoutAnimationEnabled}
            layoutDependency={view}
            transition={{ layout: HOME_VIEW_MEDIA_LAYOUT_TRANSITION }}
            className={cn(
              'absolute left-2 top-2 inline-flex h-6 w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-full border border-border bg-background/80 px-2 text-xs font-medium text-foreground backdrop-blur',
              view === 'list' && 'h-4 px-1.5 text-[10px] leading-none',
            )}
          >
            {type === 'Video' ? text.video : type === 'Web' ? text.web : type === 'Application' ? text.application : text.scene}
          </motion.div>
          {type === 'Video' ? (
            <motion.div
              layout={layoutAnimationEnabled}
              layoutDependency={view}
              transition={{ layout: HOME_VIEW_MEDIA_LAYOUT_TRANSITION }}
              className={cn(
                'wallpaper-card-equalizer absolute right-2 top-2 flex h-6 items-end gap-0.5 rounded-full border border-border/50 bg-background/70 px-2 py-1 backdrop-blur',
                view === 'list' && 'h-4 gap-px px-1.5 py-0.5',
              )}
              data-active={equalizerActive ? 'true' : 'false'}
              data-compact={view === 'list' ? 'true' : 'false'}
            >
              {[0, 1, 2].map((bar) => (
                <span
                  key={bar}
                  className={cn('wallpaper-card-equalizer-bar w-0.5 rounded-full bg-primary/60', view === 'list' && 'w-px')}
                  style={{ animationDelay: `${bar * 0.15}s` }}
                />
              ))}
            </motion.div>
          ) : null}
        </motion.div>
        <MotionCardContent
          layout={preserveAspectLayout}
          layoutDependency={view}
          transition={{ layout: HOME_VIEW_CARD_LAYOUT_TRANSITION }}
          className={cn('relative z-10 flex flex-1 flex-col p-2 sm:p-4', view === 'list' && 'min-w-0 justify-center py-2 pr-1 sm:py-4 sm:pr-4')}
        >
          <motion.h2
            layout={preserveAspectLayout}
            layoutDependency={view}
            transition={{ layout: HOME_VIEW_CARD_LAYOUT_TRANSITION }}
            className="line-clamp-2 min-h-8 text-xs font-semibold leading-4 text-foreground sm:min-h-10 sm:text-sm sm:leading-5"
            title={title}
          >
            {title}
          </motion.h2>
          <motion.div
            layout={preserveAspectLayout}
            layoutDependency={view}
            transition={{ layout: HOME_VIEW_CARD_LAYOUT_TRANSITION }}
            className="mt-1.5 flex flex-nowrap items-center gap-x-1.5 overflow-hidden text-[10px] text-muted-foreground sm:mt-2 sm:gap-x-2 sm:text-xs"
          >
            <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap sm:gap-1">
              <Heart className="h-3 w-3" />
              {formatCount(item.subscriptions || item.lifetime_subscriptions)}
            </span>
            <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap sm:gap-1">
              <Star className="h-3 w-3" />
              {formatCount(item.favorited || item.lifetime_favorited)}
            </span>
            <span className="shrink-0 whitespace-nowrap">{item.file_size ? formatBytesText(item.file_size, text) : text.unknown}</span>
          </motion.div>
        </MotionCardContent>
        <div
          className={cn('relative z-10 p-2 pt-0 sm:p-4 sm:pt-0', view === 'list' && 'flex items-center justify-end p-2 pl-0 sm:p-4')}
        >
          <motion.div
            layout={layoutAnimationEnabled ? 'position' : false}
            layoutDependency={view}
            transition={{ layout: HOME_VIEW_CARD_LAYOUT_TRANSITION }}
            className={cn('flex h-8 shrink-0', view === 'list' ? 'w-8 sm:w-auto' : 'w-full')}
          >
            <Button
              ref={actionButtonRef}
              className={cn('h-full w-full', view === 'list' && 'px-0 sm:w-auto sm:px-3')}
              size="sm"
              aria-label={actionLabel}
              onClick={(event) => {
                event.stopPropagation();
                onDefaultAction(item);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
            >
              <span
                ref={actionContentRef}
                className="inline-flex items-center gap-2"
              >
                <ActionIcon className="h-3.5 w-3.5" />
                <span className={cn(view === 'list' && 'sr-only sm:not-sr-only')}>{actionLabel}</span>
              </span>
            </Button>
          </motion.div>
        </div>
    </MotionCard>
  );
}
export const WallpaperCard = React.memo(WallpaperCardComponent);
