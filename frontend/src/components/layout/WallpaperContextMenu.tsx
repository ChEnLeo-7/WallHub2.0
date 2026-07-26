import * as React from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import { BellMinus, BellPlus, Download, ExternalLink, Play, Star, StarOff } from 'lucide-react';

import type { WorkshopItem } from '@/lib/api';
import { useText } from '@/lib/text';
import { cn } from '@/lib/utils';
import { itemType } from '@/lib/workshop';

type MenuIcon = React.ElementType<{ className?: string }>;
type ContextMenuEntry = { item: WorkshopItem; anchor: { x: number; y: number } };

type ContextActionProps = {
  icon: MenuIcon;
  label: string;
  onSelect: () => void;
  destructive?: boolean;
  disabled?: boolean;
};

function ContextAction({ icon: Icon, label, onSelect, destructive = false, disabled = false }: ContextActionProps) {
  return (
    <button
      type="button"
      role="menuitem"
      className={cn(
        'flex h-9 max-w-full min-w-0 items-center gap-2 rounded-md border border-input/80 bg-input/45 px-2.5 text-left text-sm font-medium text-foreground outline-none transition-[background-color,border-color,color,transform] duration-150 [@media(hover:hover)]:hover:border-ring/60 [@media(hover:hover)]:hover:bg-accent focus-visible:border-ring focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring',
        destructive && 'text-destructive [@media(hover:hover)]:hover:border-destructive/45 [@media(hover:hover)]:hover:bg-destructive/10 focus-visible:border-destructive/45 focus-visible:bg-destructive/10',
        disabled && 'cursor-not-allowed opacity-55',
      )}
      onClick={onSelect}
      disabled={disabled}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="min-w-0 truncate whitespace-nowrap">{label}</span>
    </button>
  );
}

export function WallpaperContextMenu({
  entry,
  onClose,
  personalSubscriptionActive,
  subscriptionPendingStep,
  subscriptionSubmitting,
  personalFavoriteActive,
  favoritePendingStep,
  favoriteSubmitting,
  onPlay,
  onDownload,
  onOpenSteamPage,
  onRemoteSubscribe,
  onRemoteUnsubscribe,
  onRemoteFavorite,
  onRemoteUnfavorite,
}: {
  entry: ContextMenuEntry | null;
  onClose: () => void;
  personalSubscriptionActive: boolean;
  subscriptionPendingStep?: 0 | 1 | 2;
  subscriptionSubmitting: boolean;
  personalFavoriteActive: boolean;
  favoritePendingStep?: 0 | 1 | 2;
  favoriteSubmitting: boolean;
  onPlay: (item: WorkshopItem) => void;
  onDownload: (item: WorkshopItem) => void;
  onOpenSteamPage: (item: WorkshopItem) => void;
  onRemoteSubscribe: (item: WorkshopItem) => void;
  onRemoteUnsubscribe: (item: WorkshopItem) => void;
  onRemoteFavorite: (item: WorkshopItem) => void;
  onRemoteUnfavorite: (item: WorkshopItem) => void;
}) {
  const text = useText();
  const prefersReducedMotion = useReducedMotion();
  const [renderedEntry, setRenderedEntry] = React.useState<ContextMenuEntry | null>(entry);
  const isOpenRef = React.useRef(Boolean(entry));
  const menuRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState({ left: entry?.anchor.x || 0, top: entry?.anchor.y || 0, ready: false });
  const subscriptionLabel = subscriptionPendingStep === undefined
    ? subscriptionSubmitting ? text.remoteSubscriptionActive : personalSubscriptionActive ? text.actionUnsubscribe : text.actionSubscribe
    : text.remoteSubscribePending.replace('{dots}', subscriptionPendingStep === 0 ? '...' : subscriptionPendingStep === 1 ? '..' : '.');
  const favoriteLabel = favoritePendingStep === undefined
    ? favoriteSubmitting ? text.remoteFavoriteActive : personalFavoriteActive ? text.actionUnfavorite : text.actionFavorite
    : text.remoteFavoritePending.replace('{dots}', favoritePendingStep === 0 ? '...' : favoritePendingStep === 1 ? '..' : '.');

  isOpenRef.current = Boolean(entry);

  React.useLayoutEffect(() => {
    if (entry) setRenderedEntry(entry);
  }, [entry]);

  React.useLayoutEffect(() => {
    if (!entry || !renderedEntry || !menuRef.current) return;
    const menu = menuRef.current;
    const padding = 8;
    const rect = menu.getBoundingClientRect();
    const left = Math.max(padding, Math.min(entry.anchor.x, window.innerWidth - rect.width - padding));
    const top = Math.max(padding, Math.min(entry.anchor.y, window.innerHeight - rect.height - padding));
    setPosition({ left, top, ready: true });
  }, [entry, personalFavoriteActive, personalSubscriptionActive, renderedEntry]);

  React.useEffect(() => {
    if (!entry) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', closeOnEscape);
    window.addEventListener('resize', onClose);
    window.addEventListener('scroll', onClose, true);
    return () => {
      window.removeEventListener('keydown', closeOnEscape);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('scroll', onClose, true);
    };
  }, [entry, onClose]);

  if (!renderedEntry || typeof document === 'undefined') return null;
  const isVideo = itemType(renderedEntry.item) === 'Video';
  const select = (action: (item: WorkshopItem) => void) => {
    onClose();
    action(renderedEntry.item);
  };

  return createPortal(
    <AnimatePresence
      onExitComplete={() => {
        if (!isOpenRef.current) {
          setRenderedEntry(null);
          setPosition((current) => ({ ...current, ready: false }));
        }
      }}
    >
      {entry ? (
        <motion.div
          className="fixed inset-0 z-[110]"
          initial={prefersReducedMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.16, ease: 'easeOut' }}
          onPointerDown={onClose}
          onContextMenu={(event) => {
            event.preventDefault();
            onClose();
          }}
        >
          <motion.div
            ref={menuRef}
            role="menu"
            initial={prefersReducedMotion ? false : { y: 4, scale: 0.985 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 2, scale: 0.99 }}
            transition={{ duration: prefersReducedMotion ? 0 : 0.16, ease: 'easeOut' }}
            className="fixed z-[120] grid w-max max-w-[calc(100vw-1rem)] gap-1 rounded-lg border border-border bg-card p-1.5 text-foreground shadow-panel"
            style={{ left: position.left, top: position.top, visibility: position.ready ? 'visible' : 'hidden' }}
            onPointerDown={(event) => event.stopPropagation()}
            onContextMenu={(event) => {
              event.preventDefault();
              event.stopPropagation();
            }}
          >
            {isVideo ? <ContextAction icon={Play} label={text.playVideo} onSelect={() => select(onPlay)} /> : null}
            <ContextAction icon={Download} label={text.download} onSelect={() => select(onDownload)} />
            <ContextAction icon={ExternalLink} label={text.openSteamPage} onSelect={() => select(onOpenSteamPage)} />
            {personalSubscriptionActive
              ? <ContextAction icon={BellMinus} label={subscriptionLabel} destructive disabled={subscriptionSubmitting} onSelect={() => select(onRemoteUnsubscribe)} />
              : <ContextAction icon={BellPlus} label={subscriptionLabel} onSelect={() => select(onRemoteSubscribe)} />}
            {personalFavoriteActive
              ? <ContextAction icon={StarOff} label={favoriteLabel} destructive disabled={favoriteSubmitting} onSelect={() => select(onRemoteUnfavorite)} />
              : <ContextAction icon={Star} label={favoriteLabel} onSelect={() => select(onRemoteFavorite)} />}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>,
    document.body,
  );
}
