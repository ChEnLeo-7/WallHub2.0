import { motion } from 'motion/react';
import { BellPlus, Clock, Download, ExternalLink, Play } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { WorkshopItem } from '@/lib/api';
import { HOME_VIEW_CARD_LAYOUT_TRANSITION } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { useActionButtonScale } from './useActionButtonScale';

export type HomeCardDefaultAction = 'playVideo' | 'backgroundDownload' | 'clientDownload' | 'openSteamPage' | 'remoteSubscribe';

export function WallpaperCardActions({
  item,
  view,
  action,
  actionLabel,
  layoutAnimationEnabled,
  onDefaultAction,
}: {
  item: WorkshopItem;
  view: 'grid' | 'list';
  action: HomeCardDefaultAction;
  actionLabel: string;
  layoutAnimationEnabled: boolean;
  onDefaultAction: (item: WorkshopItem) => void;
}) {
  const { actionButtonRef, actionContentRef } = useActionButtonScale(view, layoutAnimationEnabled);
  const ActionIcon = action === 'playVideo'
    ? Play
    : action === 'backgroundDownload'
      ? Clock
      : action === 'openSteamPage'
        ? ExternalLink
        : action === 'remoteSubscribe'
          ? BellPlus
          : Download;

  return (
    <div className={cn('relative z-10 p-2 pt-0 sm:p-4 sm:pt-0', view === 'list' && 'flex items-center justify-end p-2 pl-0 sm:p-4')}>
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
          <span ref={actionContentRef} className="inline-flex items-center gap-2">
            <ActionIcon className="h-3.5 w-3.5" />
            <span className={cn(view === 'list' && 'sr-only sm:not-sr-only')}>{actionLabel}</span>
          </span>
        </Button>
      </motion.div>
    </div>
  );
}
