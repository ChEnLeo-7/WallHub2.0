import type { Details, WorkshopItem } from '@/lib/api';

export type DetailsPresentation = 'classic' | 'redesigned';

export type DetailsDialogProps = {
  item: WorkshopItem | null;
  details: Details | null;
  loading: boolean;
  personalSourceLabel?: string;
  fixedPanelHeight: boolean;
  presentation: DetailsPresentation;
  onOpenChange: (open: boolean) => void;
  onClientDownload: (item: WorkshopItem) => void;
  personalSubscriptionActive: boolean;
  subscriptionPendingStep?: 0 | 1 | 2;
  subscriptionSubmitting: boolean;
  personalFavoriteActive: boolean;
  favoritePendingStep?: 0 | 1 | 2;
  favoriteSubmitting: boolean;
  onRemoteSubscribe: (item: WorkshopItem) => void;
  onRemoteUnsubscribe: (item: WorkshopItem) => void;
  onRemoteFavorite: (item: WorkshopItem) => void;
  onRemoteUnfavorite: (item: WorkshopItem) => void;
  onLoadMoreComments: (id: string) => void;
  onCopyId: (id: string) => void;
  onCopyTitle: (title: string) => void;
  onPlay: (item: WorkshopItem) => void;
  onAuthor: (creator?: string) => void;
  onSearchTags?: (tags: string[]) => void;
};
