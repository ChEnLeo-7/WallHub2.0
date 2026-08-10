import { parseJson } from './request';

export type StartupOnboardingStatus = {
  instanceId: string;
  required: boolean;
  completed: boolean;
  startedAt: number;
  completedAt: number;
  network?: StartupNetworkCheck | null;
  account?: StartupAccountCheck | null;
  networkProgress?: StartupNetworkProgress | null;
};

export type StartupNetworkProgress = {
  checkId: string;
  active: boolean;
  route: 'direct' | 'enhanced';
  phase: 'saving-settings' | 'resolving-routes' | 'validating-routes' | 'requesting-workshop' | 'retrying-workshop' | 'validating-response' | 'complete' | 'failed';
  progress: number;
  startedAt: number;
  updatedAt: number;
  completedHosts: number;
  totalHosts: number;
  availableRoutes: number;
  workshopAttempt: number;
  workshopMaxAttempts: number;
  workshopRetryCount: number;
  workshopLastError: string;
};

export type StartupNetworkCheck = {
  checkId: string;
  status: 'connected' | 'unreachable';
  route: 'direct' | 'enhanced';
  enhanceEnabled: boolean;
  latencyMs: number;
  accessMode?: 'resolver' | 'hosts';
  resolverProtocol?: 'doh' | 'dot';
  error?: string;
};

export type StartupNetworkSettings = {
  wallhubSteamAccessMode: 'resolver' | 'hosts';
  wallhubSteamAccessHosts: string;
  wallhubSteamAccessHostsUrl: string;
  wallhubSteamAccessHostsAutoUpdateEnabled: boolean;
  wallhubSteamAccessHostsUpdateIntervalHours: number;
  wallhubSteamAccessResolverProtocol: 'doh' | 'dot';
  wallhubSteamAccessSelectedDohEndpoints: string[];
  wallhubSteamAccessCustomDohEndpoints: string[];
  wallhubSteamAccessSelectedDotEndpoints: string[];
  wallhubSteamAccessCustomDotEndpoints: string[];
  wallhubSteamAccessDohEndpoint: string;
  wallhubSteamAccessDohMode: 'fastest' | 'fixed';
  wallhubSteamAccessDotEndpoint: string;
  wallhubSteamAccessDotMode: 'fastest' | 'fixed';
};

export type StartupAccountCheck = {
  status: 'owned' | 'not-owned' | 'unknown' | 'login-required';
  username?: string;
  appId?: number;
  error?: string;
  code?: string;
};

export async function getStartupOnboardingStatus() {
  const res = await fetch('/api/server/onboarding', { cache: 'no-store' });
  return parseJson<StartupOnboardingStatus>(res);
}

export async function checkStartupNetwork(instanceId: string, enableEnhance = false, networkSettings?: StartupNetworkSettings, signal?: AbortSignal) {
  const res = await fetch('/api/server/onboarding/network-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId, enableEnhance, networkSettings }),
    signal,
  });
  return parseJson<StartupNetworkCheck>(res);
}

export async function checkStartupAccount(instanceId: string) {
  const res = await fetch('/api/server/onboarding/account-check', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instanceId }),
  });
  return parseJson<StartupAccountCheck>(res);
}

export async function completeStartupOnboarding(payload: {
  instanceId: string;
  steamDecision: 'login' | 'skip';
  networkDecision: 'connected' | 'enhanced' | 'continue';
  networkCheckId: string;
}) {
  const res = await fetch('/api/server/onboarding/complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson<StartupOnboardingStatus>(res);
}
