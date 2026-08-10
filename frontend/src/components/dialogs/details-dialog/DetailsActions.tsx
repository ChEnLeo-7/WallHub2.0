import { BellMinus, BellPlus, Download, Play, Star, StarOff } from 'lucide-react';

import { Button } from '@/components/ui/button';
import type { WorkshopItem } from '@/lib/api';
import { useText } from '@/lib/text';
import type { DetailsDialogProps } from './types';

export function DetailsActions({
  item,
  type,
  onPlay,
  onClientDownload,
  personalSubscriptionActive,
  subscriptionPendingStep,
  subscriptionSubmitting,
  onRemoteSubscribe,
  onRemoteUnsubscribe,
  personalFavoriteActive,
  favoritePendingStep,
  favoriteSubmitting,
  onRemoteFavorite,
  onRemoteUnfavorite,
}: Pick<DetailsDialogProps,
  | 'onPlay' | 'onClientDownload'
  | 'personalSubscriptionActive' | 'subscriptionPendingStep' | 'subscriptionSubmitting'
  | 'onRemoteSubscribe' | 'onRemoteUnsubscribe'
  | 'personalFavoriteActive' | 'favoritePendingStep' | 'favoriteSubmitting'
  | 'onRemoteFavorite' | 'onRemoteUnfavorite'
> & { item: WorkshopItem; type: string }) {
  const text = useText();
  const subscriptionLabel = subscriptionPendingStep === undefined
    ? subscriptionSubmitting ? text.remoteSubscriptionActive : personalSubscriptionActive ? text.actionUnsubscribe : text.actionSubscribe
    : text.remoteSubscribePending.replace('{dots}', subscriptionPendingStep === 0 ? '...' : subscriptionPendingStep === 1 ? '..' : '.');
  const favoriteLabel = favoritePendingStep === undefined
    ? favoriteSubmitting ? text.remoteFavoriteActive : personalFavoriteActive ? text.actionUnfavorite : text.actionFavorite
    : text.remoteFavoritePending.replace('{dots}', favoritePendingStep === 0 ? '...' : favoritePendingStep === 1 ? '..' : '.');

  return (
    <>
      {type === 'Video' ? (
        <Button className="col-span-2 sm:col-span-1" variant="secondary" onClick={() => onPlay(item)}>
          <Play className="h-4 w-4" />{text.playVideo}
        </Button>
      ) : null}
      <div className="col-span-2 grid grid-cols-2 gap-2 sm:contents">
        {personalSubscriptionActive ? (
          <Button className="min-w-0" variant="destructive" disabled={subscriptionSubmitting} onClick={() => onRemoteUnsubscribe(item)}>
            <BellMinus className="h-4 w-4" />{subscriptionLabel}
          </Button>
        ) : (
          <Button className="min-w-0" variant="secondary" onClick={() => onRemoteSubscribe(item)}>
            <BellPlus className="h-4 w-4" />{subscriptionLabel}
          </Button>
        )}
        {personalFavoriteActive ? (
          <Button className="min-w-0" variant="destructive" disabled={favoriteSubmitting} onClick={() => onRemoteUnfavorite(item)}>
            <StarOff className="h-4 w-4" />{favoriteLabel}
          </Button>
        ) : (
          <Button className="min-w-0" variant="secondary" onClick={() => onRemoteFavorite(item)}>
            <Star className="h-4 w-4" />{favoriteLabel}
          </Button>
        )}
      </div>
      <Button className="col-span-2 sm:col-span-1" variant="default" onClick={() => onClientDownload(item)}>
        <Download className="h-4 w-4" />{text.download}
      </Button>
    </>
  );
}
