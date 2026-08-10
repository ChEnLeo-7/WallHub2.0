import { parseJson } from './request';

export type SteamStatus = {
  loggedIn: boolean;
  username?: string | null;
  isPersistent?: boolean;
  pendingValidation?: boolean;
  pendingUsername?: string;
  backend?: string;
  requestedBackend?: string;
  wallpaperEngineAccess?: 'owned' | 'not-owned' | 'unknown' | 'login-required';
};

export type SteamPasswordLoginSession = {
  id: string;
  status: 'starting' | 'validating' | 'waiting-phone' | 'needs-guard' | 'success' | 'error';
  username?: string;
  message?: string;
  error?: string;
  code?: string;
  needsSteamGuard?: boolean;
  requiresPhoneConfirmation?: boolean;
  updatedAt?: number;
};

export type SteamQrLoginSession = {
  id: string;
  status: 'starting' | 'waiting' | 'validating' | 'success' | 'error' | 'cancelled';
  output: string;
  qrImage?: string;
  qrChallengeUrl?: string;
  username?: string;
  message?: string;
  error?: string;
  updatedAt?: number;
};

export async function waitSteamAccessReady(options: { signal?: AbortSignal } = {}) {
  const res = await fetch('/api/steam/access/ready', { cache: 'no-store', signal: options.signal });
  return parseJson<{ enabled?: boolean; ready?: boolean; ok?: number; total?: number; timeout?: boolean }>(res);
}

export async function getSteamStatus() {
  const res = await fetch('/api/steam/status');
  return parseJson<SteamStatus>(res);
}

export async function loginSteam(payload: {
  username: string;
  password: string;
  steamGuardCode?: string;
  isRetry?: boolean;
}) {
  const res = await fetch('/api/steam/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson<{ success?: boolean; message?: string; needsSteamGuard?: boolean; username?: string }>(res);
}

export async function startSteamPasswordLogin(payload: {
  username: string;
  password: string;
  steamGuardCode?: string;
  isRetry?: boolean;
}) {
  const res = await fetch('/api/steam/login/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson<SteamPasswordLoginSession>(res);
}

export async function getSteamPasswordLoginStatus(id: string) {
  const res = await fetch(`/api/steam/login/status?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  return parseJson<SteamPasswordLoginSession>(res);
}

export async function startSteamQrLogin() {
  const res = await fetch('/api/steam/login/qr/start', { method: 'POST' });
  return parseJson<SteamQrLoginSession>(res);
}

export async function getSteamQrLoginStatus(id: string) {
  const res = await fetch(`/api/steam/login/qr/status?id=${encodeURIComponent(id)}`);
  return parseJson<SteamQrLoginSession>(res);
}

export async function cancelSteamQrLogin(id: string) {
  const res = await fetch('/api/steam/login/qr/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  return parseJson<{ success?: boolean }>(res);
}

export async function logoutSteam() {
  const res = await fetch('/api/steam/logout', { method: 'POST' });
  return parseJson<{ success: boolean; message?: string }>(res);
}

export async function fetchSteamAccessHosts(payload: { url: string; save?: boolean }) {
  const res = await fetch('/api/steam/access/hosts/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson<{
    success: boolean;
    hosts: string;
    validEntries?: number;
    ignoredEntries?: number;
    lastUpdatedAt?: number;
    error?: string;
  }>(res);
}
