import { parseJson } from './request';

export async function clearDepotStreamCache() {
  const res = await fetch('/api/video/cache/stream/clear', { method: 'POST' });
  return parseJson<{ success: boolean; files?: number; bytes?: number; cacheDir?: string }>(res);
}

export async function playVideo(id: string | number, title: string, signal?: AbortSignal) {
  const res = await fetch(`/api/video/play?id=${encodeURIComponent(String(id))}&title=${encodeURIComponent(title)}`, { signal });
  return parseJson<{ success: boolean; status: 'ready' | 'queued'; streamUrl?: string; cdnHost?: string }>(res);
}

export function releaseDepotVideoStream(streamUrl?: string) {
  const value = String(streamUrl || '').trim();
  if (!value || !value.includes('/api/video/depot')) return;
  let token = '';
  try {
    token = new URL(value, window.location.href).searchParams.get('token') || '';
  } catch {}
  if (!token) return;
  fetch(`/api/video/depot/release?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    keepalive: true,
  }).catch(() => {});
}
