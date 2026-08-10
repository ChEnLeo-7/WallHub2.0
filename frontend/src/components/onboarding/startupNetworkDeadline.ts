import * as React from 'react';
import type { StartupNetworkCheck, StartupNetworkProgress, StartupOnboardingStatus } from '@/lib/api';
import type { StartupOnboardingState } from './startupTypes';

export const STARTUP_NETWORK_CHECK_TIMEOUT_MS = 15000;

export function applyNetworkCheckTimeout(options: {
  requestId: number;
  enhanced: boolean;
  requestRef: React.MutableRefObject<number>;
  timedOutRef: React.MutableRefObject<boolean>;
  checkIdRef: React.MutableRefObject<string>;
  message: string;
  patch: (value: Partial<StartupOnboardingState>) => void;
}) {
  if (options.requestId !== options.requestRef.current) return false;
  options.timedOutRef.current = true;
  options.requestRef.current += 1;
  options.patch({
    checkingNetwork: false,
    networkProgress: null,
    networkDecision: null,
    error: '',
    network: {
      checkId: options.checkIdRef.current || `client-timeout:${options.requestId}`,
      status: 'unreachable',
      route: options.enhanced ? 'enhanced' : 'direct',
      enhanceEnabled: options.enhanced,
      latencyMs: STARTUP_NETWORK_CHECK_TIMEOUT_MS,
      error: options.message,
    },
  });
  return true;
}

export function startNetworkCheckDeadline(options: {
  requestId: number;
  enhanced: boolean;
  requestRef: React.MutableRefObject<number>;
  timedOutRef: React.MutableRefObject<boolean>;
  checkIdRef: React.MutableRefObject<string>;
  message: string;
  patch: (value: Partial<StartupOnboardingState>) => void;
}) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => {
    if (applyNetworkCheckTimeout(options)) controller.abort();
  }, STARTUP_NETWORK_CHECK_TIMEOUT_MS);
  return { controller, timeout };
}

export function useRecoveredNetworkCheck(options: {
  status: StartupOnboardingStatus;
  network: StartupNetworkCheck | null;
  checking: boolean;
  progress: StartupNetworkProgress | null;
  requestRef: React.MutableRefObject<number>;
  timedOutRef: React.MutableRefObject<boolean>;
  checkIdRef: React.MutableRefObject<string>;
  message: string;
  patch: (value: Partial<StartupOnboardingState>) => void;
}) {
  React.useEffect(() => {
    const progress = options.status.networkProgress;
    if (!progress?.active || progress.checkId === options.network?.checkId || options.timedOutRef.current) return;
    if (options.checkIdRef.current && options.checkIdRef.current !== progress.checkId) options.requestRef.current += 1;
    options.checkIdRef.current = progress.checkId;
    options.patch({ network: null, networkDecision: null, networkProgress: progress, checkingNetwork: true });
  }, [options.network?.checkId, options.patch, options.status.networkProgress?.active, options.status.networkProgress?.checkId]);

  React.useEffect(() => {
    const progress = options.progress;
    if (!options.checking || !progress?.active || !progress.startedAt) return;
    const requestId = options.requestRef.current;
    const remaining = Math.max(0, STARTUP_NETWORK_CHECK_TIMEOUT_MS - (Date.now() - progress.startedAt));
    const timer = window.setTimeout(() => applyNetworkCheckTimeout({
      requestId,
      enhanced: progress.route === 'enhanced',
      requestRef: options.requestRef,
      timedOutRef: options.timedOutRef,
      checkIdRef: options.checkIdRef,
      message: options.message,
      patch: options.patch,
    }), remaining);
    return () => window.clearTimeout(timer);
  }, [options.checking, options.message, options.patch, options.progress?.active, options.progress?.checkId, options.progress?.startedAt]);
}
