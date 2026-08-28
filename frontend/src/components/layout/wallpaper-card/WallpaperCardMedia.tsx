import * as React from 'react';
import { motion } from 'motion/react';

import { HOME_VIEW_MEDIA_LAYOUT_TRANSITION } from '@/lib/motion';
import { cn } from '@/lib/utils';

const COVER_RETRY_DELAYS_MS = [1000, 3000];

function coverRetryUrl(previewUrl: string, attempt: number, nonce: number) {
  if (!attempt) return previewUrl;
  const hashIndex = previewUrl.indexOf('#');
  const base = hashIndex >= 0 ? previewUrl.slice(0, hashIndex) : previewUrl;
  const hash = hashIndex >= 0 ? previewUrl.slice(hashIndex) : '';
  return `${base}${base.includes('?') ? '&' : '?'}wallhub_cover_retry=${attempt}-${nonce}${hash}`;
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

export function WallpaperCardMedia({
  previewUrl,
  previewPending,
  title,
  type,
  typeLabel,
  noCoverLabel,
  coverNetworkErrorLabel,
  view,
  layoutAnimationEnabled,
  preserveAspectLayout,
  reducedMotion,
}: {
  previewUrl?: string;
  previewPending: boolean;
  title: string;
  type: string;
  typeLabel: string;
  noCoverLabel: string;
  coverNetworkErrorLabel: string;
  view: 'grid' | 'list';
  layoutAnimationEnabled: boolean;
  preserveAspectLayout: 'preserve-aspect' | false;
  reducedMotion: boolean;
}) {
  const mediaRef = React.useRef<HTMLDivElement>(null);
  const equalizerActive = useViewportActivity(mediaRef, reducedMotion);
  const [loadedPreviewUrl, setLoadedPreviewUrl] = React.useState('');
  const [retryState, setRetryState] = React.useState({ previewUrl: '', attempt: 0, nonce: 0, failed: false });
  const retryTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const currentRetryState = retryState.previewUrl === previewUrl
    ? retryState
    : { previewUrl: previewUrl || '', attempt: 0, nonce: 0, failed: false };
  const previewReady = !!previewUrl && loadedPreviewUrl === previewUrl;
  const previewFailed = !!previewUrl && currentRetryState.failed;
  const imageUrl = previewUrl
    ? coverRetryUrl(previewUrl, currentRetryState.attempt, currentRetryState.nonce)
    : '';
  const showPlaceholder = previewPending || (!!previewUrl && !previewFailed);
  React.useEffect(() => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    setRetryState({ previewUrl: previewUrl || '', attempt: 0, nonce: 0, failed: false });
    return () => {
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    };
  }, [previewUrl]);

  const handlePreviewError = () => {
    if (!previewUrl || retryTimerRef.current) return;
    const attempt = currentRetryState.attempt;
    if (attempt >= COVER_RETRY_DELAYS_MS.length) {
      setRetryState({ previewUrl, attempt, nonce: currentRetryState.nonce, failed: true });
      return;
    }
    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null;
      setRetryState((current) => current.previewUrl === previewUrl
        ? { previewUrl, attempt: attempt + 1, nonce: Date.now(), failed: false }
        : current);
    }, COVER_RETRY_DELAYS_MS[attempt]);
  };

  const handlePreviewLoad = () => {
    if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
    setLoadedPreviewUrl(previewUrl || '');
  };
  return (
    <>
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
        {previewUrl && !previewFailed ? (
          <img
            className={cn(
              'pointer-events-none absolute inset-0 h-full w-full select-none object-cover ease-[cubic-bezier(0.23,1,0.32,1)]',
              reducedMotion
                ? 'transition-opacity duration-150'
                : 'transition-[opacity,transform] duration-[240ms]',
              previewReady
                ? 'scale-100 opacity-100 group-hover:scale-105'
                : reducedMotion
                  ? 'scale-100 opacity-0'
                  : 'scale-[1.015] opacity-0',
            )}
            src={imageUrl}
            alt={title}
            loading="lazy"
            decoding="async"
            draggable={false}
            onLoad={handlePreviewLoad}
            onError={handlePreviewError}
          />
        ) : null}
        {showPlaceholder ? (
          <div
            className={cn(
              'pointer-events-none absolute inset-0 bg-muted transition-opacity duration-[180ms] ease-[cubic-bezier(0.23,1,0.32,1)]',
              previewReady ? 'opacity-0' : 'opacity-100',
              previewPending && !previewReady && !reducedMotion && 'animate-pulse',
            )}
            aria-hidden="true"
          />
        ) : null}
        {!showPlaceholder && (!previewUrl || previewFailed) ? (
          <div className="grid h-full place-items-center px-4 text-center text-muted-foreground">
            {previewFailed ? coverNetworkErrorLabel : noCoverLabel}
          </div>
        ) : null}
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
          {typeLabel}
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
    </>
  );
}
