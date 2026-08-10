import { parseJson } from './request';

export type WorkshopItem = {
  publishedfileid: string;
  title?: string;
  preview_url?: string;
  short_description?: string;
  description?: string;
  creator?: string;
  author?: string;
  subscriptions?: string | number;
  lifetime_subscriptions?: string | number;
  favorited?: string | number;
  lifetime_favorited?: string | number;
  views?: string | number;
  file_size?: string | number;
  time_updated?: string | number;
  tags?: Array<string | { tag: string }>;
  workshopType?: string;
  detailsPending?: boolean;
};

export type CommentItem = { author?: string; date?: string; timestamp?: string | number; text?: string };

export type CommentsPage = {
  comments: CommentItem[];
  start?: number;
  count?: number;
  nextStart?: number;
  total?: number;
  hasMore?: boolean;
  ownerId?: string;
};

export type Details = WorkshopItem & {
  comments?: CommentItem[];
  commentsStart?: number;
  commentsCount?: number;
  commentsNextStart?: number;
  commentsTotal?: number;
  commentsHasMore?: boolean;
  commentsOwnerId?: string;
};

export type PersonalSourceResult = {
  filter: string;
  label: string;
  names?: string[];
  steamIds?: string[];
  warningCode?: string;
};

export type SubscriptionStatusResult = {
  success: boolean;
  id: string;
  appid: number;
  subscribed: boolean;
  favorited: boolean;
};

export type QueryParams = Record<string, string | number | boolean | undefined>;

export type WorkshopQueryResult = {
  items: WorkshopItem[];
  total: number;
  totalPages: number;
  source: string;
  fallbackUsed: boolean;
  warningCode: string;
  diagnostics?: Record<string, unknown>;
};

export async function queryWorkshop(params: QueryParams, options: { signal?: AbortSignal } = {}): Promise<WorkshopQueryResult> {
  const res = await fetch('/api/steam/query', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ params }),
    signal: options.signal,
  });
  const data = await parseJson<{ response?: { publishedfiledetails?: WorkshopItem[]; total?: number; totalPages?: number }; totalPages?: number; source?: string; fallbackUsed?: boolean; warningCode?: string; diagnostics?: Record<string, unknown> }>(res);
  const response = data.response || {};
  const total = Number(response.total || response.publishedfiledetails?.length || 0);
  return {
    items: response.publishedfiledetails || [],
    total,
    totalPages: Number(data.totalPages || response.totalPages || (total ? Math.ceil(total / Number(params.numperpage || 30)) : 0)),
    source: data.source || '',
    fallbackUsed: !!data.fallbackUsed,
    warningCode: data.warningCode || '',
    diagnostics: data.diagnostics,
  };
}

export async function getDetails(id: string | number) {
  const res = await fetch(`/api/steam/details?id=${encodeURIComponent(String(id))}`);
  return parseJson<Details>(res);
}

export async function getPersonalSource(id: string | number, filter: string) {
  const qs = new URLSearchParams({ id: String(id), filter: String(filter || '') });
  const res = await fetch(`/api/steam/personal-source?${qs.toString()}`, { cache: 'no-store' });
  return parseJson<PersonalSourceResult>(res);
}

export async function getSubscriptionStatus(id: string | number) {
  const res = await fetch(`/api/steam/subscription-status?id=${encodeURIComponent(String(id))}`, { cache: 'no-store' });
  return parseJson<SubscriptionStatusResult>(res);
}

export async function remoteSubscribe(id: string | number) {
  const res = await fetch('/api/steam/subscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: String(id) }),
  });
  return parseJson<{ success: boolean; id: string; appid: number; message?: string }>(res);
}

export async function remoteUnsubscribe(id: string | number) {
  const res = await fetch('/api/steam/unsubscribe', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: String(id) }),
  });
  return parseJson<{ success: boolean; id: string; appid: number; message?: string }>(res);
}

export async function remoteFavorite(id: string | number) {
  const res = await fetch('/api/steam/favorite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: String(id) }),
  });
  return parseJson<{ success: boolean; id: string; appid: number; message?: string }>(res);
}

export async function remoteUnfavorite(id: string | number) {
  const res = await fetch('/api/steam/unfavorite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: String(id) }),
  });
  return parseJson<{ success: boolean; id: string; appid: number; message?: string }>(res);
}

export async function getDetailsBatch(ids: Array<string | number>) {
  const res = await fetch('/api/steam/details/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const data = await parseJson<{ items?: WorkshopItem[] }>(res);
  return data.items || [];
}

export async function getComments(id: string | number, start = 0, count = 50, ownerId = '') {
  const owner = String(ownerId || '').trim();
  const ownerQuery = owner ? `&owner=${encodeURIComponent(owner)}` : '';
  const res = await fetch(`/api/steam/comments?id=${encodeURIComponent(String(id))}&start=${encodeURIComponent(String(start))}&count=${encodeURIComponent(String(count))}${ownerQuery}`);
  return parseJson<CommentsPage>(res);
}
