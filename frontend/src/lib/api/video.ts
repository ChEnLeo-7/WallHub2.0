import { parseJson } from './request';

export async function clearDepotStreamCache() {
  const res = await fetch('/api/video/cache/stream/clear', { method: 'POST' });
  return parseJson<{
    success: boolean;
    files?: number;
    bytes?: number;
    removedBytes?: number;
    remainingBytes?: number;
    cacheDir?: string;
  }>(res);
}

export async function playVideo(id: string | number, title: string, signal?: AbortSignal) {
  const res = await fetch(`/api/video/play?id=${encodeURIComponent(String(id))}&title=${encodeURIComponent(title)}`, { signal });
  return parseJson<{ success: boolean; status: 'ready' | 'queued'; streamUrl?: string; cdnHost?: string }>(res);
}

export function releaseDepotVideoStream(streamUrl?: string) {
  const token = depotStreamToken(streamUrl);
  if (!token) return;
  fetch(`/api/video/depot/release?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    keepalive: true,
  }).catch(() => {});
}

export type DepotPlaybackFeedback = {
  sequence: number;
  state: 'playing' | 'paused' | 'seeking' | 'waiting' | 'stalled' | 'buffering' | 'ended';
  currentTime: number;
  duration: number;
  bufferedEnd: number;
  bufferedRanges: Array<{ start: number; end: number }>;
  controllerPaused: boolean;
  playbackRate: number;
  sentAt: number;
  paused: boolean;
  readyState: number;
  networkState: number;
  mediaTimeAdvanced: boolean;
  errorCode: number;
};

export type DepotFullCacheStatus = {
  success: boolean;
  status: 'idle' | 'caching' | 'complete' | 'cancelled' | 'error';
  cachedBytes: number;
  totalBytes: number;
  progress: number;
  error?: string;
  code?: string;
};

function depotStreamToken(streamUrl?: string) {
  const value = String(streamUrl || '').trim();
  if (!value || !value.includes('/api/video/depot')) return '';
  try { return new URL(value, window.location.href).searchParams.get('token') || ''; }
  catch { return ''; }
}

export function reportDepotPlaybackFeedback(streamUrl: string | undefined, feedback: DepotPlaybackFeedback) {
  const token = depotStreamToken(streamUrl);
  if (!token) return Promise.resolve(undefined);
  return fetch(`/api/video/depot/feedback?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(feedback),
    keepalive: feedback.state === 'paused' || feedback.state === 'ended',
  }).then(res => parseJson<{
    success: boolean;
    browserBufferSeconds?: number;
    cachedBufferSeconds?: number;
    safeBufferSeconds?: number;
    resumeBufferSeconds?: number;
    browserLowBufferSeconds?: number;
    targetBufferSeconds?: number;
    playbackDirective?: 'hold' | 'play' | 'pause' | 'none';
    bufferPhase?: 'calibrating' | 'startup' | 'steady' | 'recovering';
    bufferProgress?: number;
    requiredBytesPerSecond?: number;
    safeThroughputBytesPerSecond?: number;
    cacheBudgetBytes?: number;
    anchorConfidence?: 'range-observed' | 'estimated';
    bandwidthLimited?: boolean;
    decodeError?: boolean;
  }>(res)).catch(() => undefined);
}

function depotFullCacheRequest(streamUrl: string | undefined, path: string, method: 'GET' | 'POST') {
  const token = depotStreamToken(streamUrl);
  if (!token) return Promise.resolve(undefined);
  return fetch(`${path}?token=${encodeURIComponent(token)}`, { method })
    .then(res => parseJson<DepotFullCacheStatus>(res));
}

export function startDepotFullCache(streamUrl?: string) {
  return depotFullCacheRequest(streamUrl, '/api/video/depot/cache', 'POST');
}

export function getDepotFullCacheStatus(streamUrl?: string) {
  return depotFullCacheRequest(streamUrl, '/api/video/depot/cache', 'GET');
}

export function cancelDepotFullCache(streamUrl?: string) {
  return depotFullCacheRequest(streamUrl, '/api/video/depot/cache/cancel', 'POST');
}
