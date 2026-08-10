import { parseJson } from './request';

export type UpdateStatus = {
  currentVersion: string;
  latestVersion?: string;
  status: 'idle' | 'checking' | 'up-to-date' | 'available' | 'unsupported' | 'downloading' | 'downloaded' | 'installing' | 'error' | string;
  progress?: number;
  downloadedBytes?: number;
  totalBytes?: number;
  updateAvailable?: boolean;
  checkedAt?: number;
  updatedAt?: number;
  releaseUrl?: string;
  releaseNotes?: string;
  mode?: 'docker' | 'portable' | 'source' | string;
  platform?: string;
  arch?: string;
  canDownload?: boolean;
  canInstall?: boolean;
  autoUpdateEnabled?: boolean;
  dockerAutoUpdate?: boolean;
  assetName?: string;
  error?: string;
  errorCode?: string;
};

export async function checkForUpdates(options: { cached?: boolean } = {}) {
  const suffix = options.cached ? '?cached=1' : '';
  const res = await fetch(`/api/server/update/check${suffix}`, { method: 'POST' });
  return parseJson<UpdateStatus>(res);
}

export async function downloadUpdate() {
  const res = await fetch('/api/server/update/download', { method: 'POST' });
  return parseJson<UpdateStatus>(res);
}

export async function installUpdate() {
  const res = await fetch('/api/server/update/install', { method: 'POST' });
  return parseJson<UpdateStatus>(res);
}
