import { createDownloadError } from './errors';
import { parseJson } from './request';

export type MpkgPreparationResponse = {
  success?: boolean;
  id?: string;
  status?: 'preparing' | 'ready' | 'error' | string;
  stage?: 'downloading' | 'converting' | string;
  elapsedMs?: number;
  fileName?: string;
  downloadUrl?: string;
  error?: string;
  code?: string;
  requiresSteamLogin?: boolean;
  requiresSteamGuard?: boolean;
};

type MpkgPreparationOptions = {
  textureProfile?: 'fast' | 'compact';
  onPreparing?: (preparation: MpkgPreparationResponse) => void;
};

function downloadByNavigation(url: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = '';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export async function clientDownload(id: string | number, title: string) {
  const url = `/api/download?id=${encodeURIComponent(String(id))}&title=${encodeURIComponent(title)}`;
  const probe = await fetch(`${url}&probe=1`, { cache: 'no-store' });
  const data = await probe.json().catch(() => ({})) as { downloadUrl?: string } & Record<string, unknown>;
  if (!probe.ok) throw createDownloadError(data, probe.status);
  downloadByNavigation(data.downloadUrl || url);
  return { streamed: true };
}

async function prepareMpkg(
  id: string | number,
  title: string,
  options: MpkgPreparationOptions = {},
) {
  const profile = options.textureProfile === 'compact' ? 'compact' : 'fast';
  const params = new URLSearchParams({ id: String(id), title: String(title || ''), profile });
  const startedAt = Date.now();
  const notifyPreparing = (value: MpkgPreparationResponse) => {
    if (String(value.status || '') !== 'preparing' || !options.onPreparing) return;
    const elapsedMs = Number(value.elapsedMs);
    try {
      options.onPreparing({
        ...value,
        elapsedMs: Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : Date.now() - startedAt,
      });
    } catch {}
  };
  const startRes = await fetch(`/api/mpkg/prepare?${params.toString()}`, { cache: 'no-store' });
  let preparation = await parseJson<MpkgPreparationResponse>(startRes);
  notifyPreparing(preparation);
  const deadline = Date.now() + 50 * 60 * 1000;
  let nextPollDelayMs = 0;

  while (preparation.status === 'preparing') {
    if (Date.now() >= deadline) {
      throw new Error('等待 MPKG 转换准备超时，请稍后重试');
    }
    if (nextPollDelayMs > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, nextPollDelayMs));
    }
    const statusRes = await fetch(`/api/mpkg/prepare/status?${params.toString()}`, { cache: 'no-store' });
    preparation = await parseJson<MpkgPreparationResponse>(statusRes);
    notifyPreparing(preparation);
    nextPollDelayMs = 1000;
  }

  if (preparation.status !== 'ready') {
    const error = new Error(preparation.error || 'MPKG 准备失败') as Error & { code?: string };
    error.code = preparation.code || '';
    throw error;
  }
  return { preparation, params };
}

export async function mpkgDownload(
  id: string | number,
  title: string,
  options: MpkgPreparationOptions = {},
) {
  const { preparation, params } = await prepareMpkg(id, title, options);
  downloadByNavigation(preparation.downloadUrl || `/api/mpkg/download?${params.toString()}`);
  return { streamed: true, fileName: preparation.fileName || '' };
}

export async function mpkgConvertOnly(
  id: string | number,
  title: string,
  options: MpkgPreparationOptions = {},
) {
  const { preparation } = await prepareMpkg(id, title, options);
  return { converted: true, fileName: preparation.fileName || '' };
}

export async function backgroundDownload(id: string | number, title: string) {
  const res = await fetch(`/api/download/background?id=${encodeURIComponent(String(id))}&title=${encodeURIComponent(title)}`);
  return parseJson<{ success?: boolean; message?: string }>(res);
}
