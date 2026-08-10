import { motion } from 'motion/react';
import { Heart, Star } from 'lucide-react';

import { CardContent } from '@/components/ui/card';
import type { WorkshopItem } from '@/lib/api';
import { HOME_VIEW_CARD_LAYOUT_TRANSITION } from '@/lib/motion';
import { cn, formatBytesText, formatCount } from '@/lib/utils';
import { useText } from '@/lib/text';

const MotionCardContent = motion.create(CardContent);

export function WallpaperCardMetadata({ item, title, view, preserveAspectLayout }: {
  item: WorkshopItem;
  title: string;
  view: 'grid' | 'list';
  preserveAspectLayout: 'preserve-aspect' | false;
}) {
  const text = useText();
  return (
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
        {item.detailsPending ? (
          <span className="h-3 w-28 animate-pulse rounded bg-muted" aria-hidden="true" />
        ) : (
          <>
            <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap sm:gap-1">
              <Heart className="h-3 w-3" />
              {formatCount(item.subscriptions || item.lifetime_subscriptions)}
            </span>
            <span className="inline-flex shrink-0 items-center gap-0.5 whitespace-nowrap sm:gap-1">
              <Star className="h-3 w-3" />
              {formatCount(item.favorited || item.lifetime_favorited)}
            </span>
            <span className="shrink-0 whitespace-nowrap">{item.file_size ? formatBytesText(item.file_size, text) : text.unknown}</span>
          </>
        )}
      </motion.div>
    </MotionCardContent>
  );
}
