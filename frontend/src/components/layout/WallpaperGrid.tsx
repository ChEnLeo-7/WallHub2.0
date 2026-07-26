import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';

import type { WorkshopItem } from '@/lib/api';
import { HOME_VIEW_CARD_LAYOUT_TRANSITION } from '@/lib/motion';
import { cn } from '@/lib/utils';
import { WallpaperCard, type WallpaperContextMenuAnchor } from './WallpaperCard';

type HomeCardDefaultAction = 'playVideo' | 'backgroundDownload' | 'clientDownload' | 'openSteamPage' | 'remoteSubscribe';

function WallpaperGridComponent({
  items,
  view,
  columns,
  onOpen,
  defaultAction,
  onDefaultAction,
  onOpenContextMenu,
  suppressLayoutAnimation = false,
}: {
  items: WorkshopItem[];
  view: 'grid' | 'list';
  columns: number;
  onOpen: (item: WorkshopItem) => void;
  defaultAction: HomeCardDefaultAction;
  onDefaultAction: (item: WorkshopItem) => void;
  onOpenContextMenu: (item: WorkshopItem, anchor: WallpaperContextMenuAnchor) => void;
  suppressLayoutAnimation?: boolean;
}) {
  return (
    <motion.div
      layout={suppressLayoutAnimation ? false : 'position'}
      className={cn(view === 'grid' ? 'grid gap-2 sm:gap-4' : 'grid gap-3')}
      style={view === 'grid' ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}
      transition={{ layout: HOME_VIEW_CARD_LAYOUT_TRANSITION }}
    >
      <AnimatePresence initial={!suppressLayoutAnimation} mode="popLayout">
        {items.map((item, index) => (
          <WallpaperCard
            key={item.publishedfileid}
            item={item}
            index={index}
            view={view}
            defaultAction={defaultAction}
            onOpen={onOpen}
            onDefaultAction={onDefaultAction}
            onOpenContextMenu={onOpenContextMenu}
            suppressLayoutAnimation={suppressLayoutAnimation}
          />
        ))}
      </AnimatePresence>
    </motion.div>
  );
}
export const WallpaperGrid = React.memo(WallpaperGridComponent);
