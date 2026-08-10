import { parseJson } from './request';

export type QueueTask = {
  id?: string | number;
  cacheKey?: string;
  source?: 'cache' | 'queue';
  title?: string;
  name?: string;
  status?: string;
  progress?: number;
  progressIndeterminate?: boolean;
  progressStage?: string;
  progressStageMode?: 'loading' | 'progress' | string;
  livePaused?: boolean;
  downloaded?: number;
  total?: number;
  size?: number;
  speed?: number;
  coverUrl?: string;
  isVideo?: boolean;
  workshopType?: string;
  canPlay?: boolean;
  errorMsg?: string;
  errorCode?: string;
  requiresSteamLogin?: boolean;
  requiresSteamGuard?: boolean;
};

export type QueueResponse = {
  tasks: QueueTask[];
};

export type CachedItemsResponse = {
  items: QueueTask[];
};

export async function getQueue() {
  const res = await fetch('/api/queue', { cache: 'no-store' });
  return parseJson<QueueResponse>(res);
}

export async function getCachedItems() {
  const res = await fetch('/api/cache/list', { cache: 'no-store' });
  return parseJson<CachedItemsResponse>(res);
}

export async function queueAction(action: string, id?: string | number) {
  const res = await fetch('/api/queue/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, id }),
  });
  return parseJson<{ success: boolean }>(res);
}
