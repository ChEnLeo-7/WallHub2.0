import * as React from 'react';
import {
  checkStartupAccount, checkStartupNetwork, completeStartupOnboarding, fetchSteamAccessHosts,
  getSettings, getSettingsDetails, getStartupOnboardingStatus, getSteamStatus,
  type CacheSettings, type StartupNetworkProgress, type StartupOnboardingStatus,
} from '@/lib/api';
import { normalizeSteamAccessHostsUrl } from '@/lib/normalizers';
import type { StartupCopy } from './startupCopy';
import { DEFAULT_STARTUP_NETWORK_SETTINGS, startupNetworkSettings } from './startupNetworkSettings';
import {
  startNetworkCheckDeadline,
  useRecoveredNetworkCheck,
} from './startupNetworkDeadline';
import type { NetworkDecision, StartupOnboardingState, StartupStep } from './startupTypes';

function initialNetworkDecision(status: StartupOnboardingStatus): NetworkDecision {
  if (status.network?.status !== 'connected') return null;
  return status.network.route === 'enhanced' ? 'enhanced' : 'connected';
}
function pendingEnhancedProgress(startedAt: number): StartupNetworkProgress {
  return {
    checkId: 'pending', active: true, route: 'enhanced', phase: 'saving-settings', progress: 5,
    startedAt, updatedAt: startedAt, completedHosts: 0, totalHosts: 0, availableRoutes: 0,
    workshopAttempt: 0, workshopMaxAttempts: 3, workshopRetryCount: 0, workshopLastError: '',
  };
}
export function useStartupOnboardingController({ status, onComplete, copy, step, setStep }: {
  status: StartupOnboardingStatus;
  onComplete: (value: StartupOnboardingStatus) => void;
  copy: StartupCopy;
  step: StartupStep;
  setStep: React.Dispatch<React.SetStateAction<StartupStep>>;
}) {
  const [state, setState] = React.useState<StartupOnboardingState>(() => ({
    steamDecision: null, networkDecision: initialNetworkDecision(status),
    steam: null, account: status.account || null, network: status.network || null,
    loginOpen: false, checkingAccount: false, checkingNetwork: !!status.networkProgress?.active,
    networkProgress: status.networkProgress || null, progressClock: Date.now(),
    completing: false, enhanceSetup: false,
    networkSettings: DEFAULT_STARTUP_NETWORK_SETTINGS,
    networkSettingsReady: false, networkSettingsLoadError: '', customEndpoint: '',
    importingHosts: false, error: '',
  }));
  const patch = React.useCallback((value: Partial<StartupOnboardingState>) => setState(current => ({ ...current, ...value })), []);
  const updateNetworkSettings = React.useCallback<React.Dispatch<React.SetStateAction<StartupOnboardingState['networkSettings']>>>(value => {
    setState(current => ({ ...current, networkSettings: typeof value === 'function' ? value(current.networkSettings) : value }));
  }, []);
  const steamRequestRef = React.useRef(0);
  const accountRequestRef = React.useRef(0);
  const networkRequestRef = React.useRef(status.networkProgress?.active ? 1 : 0);
  const networkTimedOutRef = React.useRef(false);
  const networkCheckIdRef = React.useRef(status.networkProgress?.active ? status.networkProgress.checkId : '');
  const networkAutoStartedRef = React.useRef(!!status.network || !!status.networkProgress?.active);
  const previousNetworkDecisionRef = React.useRef<NetworkDecision>(null);

  const refreshSteam = React.useCallback(async () => {
    const requestId = ++steamRequestRef.current;
    const value = await getSteamStatus();
    if (requestId !== steamRequestRef.current) return value;
    setState(current => ({
      ...current,
      steam: value,
      steamDecision: value.loggedIn && !value.pendingValidation ? current.steamDecision ?? 'login' : current.steamDecision,
    }));
    return value;
  }, []);

  React.useEffect(() => { refreshSteam().catch(() => {}); }, [refreshSteam]);
  const loadNetworkSettings = React.useCallback(async () => {
    patch({ networkSettingsReady: false, networkSettingsLoadError: '' });
    try {
      const base = await getSettings();
      const details: CacheSettings = base.wallhubSteamAccessHostsDeferred ? await getSettingsDetails() : {};
      patch({ networkSettings: startupNetworkSettings({ ...base, ...details }), networkSettingsReady: true });
    } catch (reason) {
      patch({ networkSettingsLoadError: reason instanceof Error ? reason.message : copy.settingsLoadFailed });
    }
  }, [copy.settingsLoadFailed, patch]);

  React.useEffect(() => { loadNetworkSettings(); }, [loadNetworkSettings]);
  React.useEffect(() => {
    if (!state.checkingNetwork) return;
    let cancelled = false;
    const requestId = networkRequestRef.current;
    const refreshProgress = async () => {
      try {
        const value = await getStartupOnboardingStatus();
        if (cancelled || requestId !== networkRequestRef.current || value.instanceId !== status.instanceId) return;
        const expectedCheckId = state.networkProgress?.checkId && state.networkProgress.checkId !== 'pending' ? state.networkProgress.checkId : '';
        if (expectedCheckId && value.networkProgress?.checkId && value.networkProgress.checkId !== expectedCheckId) return;
        setState(current => {
          if (value.networkProgress?.active) {
            networkCheckIdRef.current = value.networkProgress.checkId;
            return networkTimedOutRef.current ? current : { ...current, networkProgress: value.networkProgress };
          }
          const network = value.network || current.network;
          if (network?.checkId) networkCheckIdRef.current = network.checkId;
          return {
            ...current,
            checkingNetwork: false,
            networkProgress: value.networkProgress || null,
            network,
            networkDecision: value.network ? initialNetworkDecision(value) : current.networkDecision,
          };
        });
      } catch {}
    };
    refreshProgress();
    const timer = window.setInterval(refreshProgress, 350);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, [state.checkingNetwork, state.networkProgress?.checkId, status.instanceId]);
  React.useEffect(() => {
    if (!status.network || state.checkingNetwork) return;
    patch({ network: status.network, networkDecision: initialNetworkDecision(status) });
  }, [patch, state.checkingNetwork, status.network?.checkId]);

  useRecoveredNetworkCheck({
    status, network: state.network, checking: state.checkingNetwork, progress: state.networkProgress,
    requestRef: networkRequestRef, timedOutRef: networkTimedOutRef, checkIdRef: networkCheckIdRef,
    message: copy.networkTimeout, patch,
  });

  React.useEffect(() => {
    if (!state.checkingNetwork || state.networkProgress?.route !== 'enhanced') return;
    patch({ progressClock: Date.now() });
    const timer = window.setInterval(() => patch({ progressClock: Date.now() }), 250);
    return () => window.clearInterval(timer);
  }, [patch, state.checkingNetwork, state.networkProgress?.route]);

  const checkAccount = React.useCallback(async () => {
    const requestId = ++accountRequestRef.current;
    patch({ checkingAccount: true, error: '' });
    try {
      const account = await checkStartupAccount(status.instanceId);
      if (requestId !== accountRequestRef.current) return;
      patch({ account });
      await refreshSteam();
    } catch (reason) {
      if (requestId === accountRequestRef.current) patch({ error: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      if (requestId === accountRequestRef.current) patch({ checkingAccount: false });
    }
  }, [patch, refreshSteam, status.instanceId]);

  const checkNetwork = React.useCallback(async (enableEnhance = false) => {
    const requestId = ++networkRequestRef.current;
    networkTimedOutRef.current = false;
    networkCheckIdRef.current = '';
    previousNetworkDecisionRef.current = null;
    const startedAt = Date.now();
    const { controller, timeout } = startNetworkCheckDeadline({
      requestId, enhanced: enableEnhance, requestRef: networkRequestRef,
      timedOutRef: networkTimedOutRef, checkIdRef: networkCheckIdRef,
      message: copy.networkTimeout, patch,
    });
    patch({
      checkingNetwork: true, network: null, networkDecision: null, error: '', progressClock: startedAt,
      networkProgress: enableEnhance ? pendingEnhancedProgress(startedAt) : null,
    });
    try {
      const network = await checkStartupNetwork(status.instanceId, enableEnhance, enableEnhance ? state.networkSettings : undefined, controller.signal);
      if (requestId !== networkRequestRef.current) return;
      if (network.status === 'connected') {
        patch({ network, networkDecision: network.route === 'enhanced' ? 'enhanced' : 'connected', enhanceSetup: network.route !== 'enhanced' && state.enhanceSetup });
      } else {
        patch({ network, error: enableEnhance ? network.error || copy.unreachable : '' });
      }
    } catch (reason) {
      if (requestId === networkRequestRef.current) patch({ error: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      window.clearTimeout(timeout);
      if (requestId === networkRequestRef.current) patch({ checkingNetwork: false, networkProgress: null });
    }
  }, [copy.networkTimeout, copy.unreachable, patch, state.enhanceSetup, state.networkSettings, status.instanceId]);

  React.useEffect(() => {
    if (step !== 'network' || networkAutoStartedRef.current || state.checkingNetwork || state.network) return;
    networkAutoStartedRef.current = true;
    checkNetwork();
  }, [checkNetwork, state.checkingNetwork, state.network, step]);

  const importHosts = React.useCallback(async () => {
    const url = normalizeSteamAccessHostsUrl(state.networkSettings.wallhubSteamAccessHostsUrl);
    if (!url) return;
    patch({ importingHosts: true, error: '' });
    try {
      const result = await fetchSteamAccessHosts({ url, save: false });
      setState(current => normalizeSteamAccessHostsUrl(current.networkSettings.wallhubSteamAccessHostsUrl) === url ? {
        ...current,
        networkSettings: { ...current.networkSettings, wallhubSteamAccessHosts: result.hosts, wallhubSteamAccessHostsUrl: url },
      } : current);
    } catch (reason) {
      patch({ error: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      patch({ importingHosts: false });
    }
  }, [patch, state.networkSettings.wallhubSteamAccessHostsUrl]);

  const chooseSteam = React.useCallback((decision: 'login' | 'skip') => {
    if (decision === 'skip') accountRequestRef.current += 1;
    patch(decision === 'skip'
      ? { steamDecision: decision, account: null, checkingAccount: false, error: '' }
      : { steamDecision: decision, error: '' });
  }, [patch]);

  const continueAccount = React.useCallback(async () => {
    patch({ error: '' });
    if (!state.steamDecision) return patch({ error: copy.choose });
    if (state.steamDecision === 'login' && (!state.steam?.loggedIn || state.steam.pendingValidation)) return patch({ loginOpen: true });
    if (state.steamDecision === 'login' && (!state.account || state.account.status === 'login-required')) return checkAccount();
    setStep('ready');
  }, [checkAccount, copy.choose, patch, setStep, state.account, state.steam, state.steamDecision]);

  const finish = React.useCallback(async () => {
    if (!state.steamDecision || !state.networkDecision) return;
    patch({ completing: true, error: '' });
    try {
      if (!state.network?.checkId) throw new Error(copy.checkingNetworkDesc);
      onComplete(await completeStartupOnboarding({
        instanceId: status.instanceId,
        steamDecision: state.steamDecision,
        networkDecision: state.networkDecision,
        networkCheckId: state.network.checkId,
      }));
    } catch (reason) {
      patch({ error: reason instanceof Error ? reason.message : String(reason), completing: false });
    }
  }, [copy.checkingNetworkDesc, onComplete, patch, state.network, state.networkDecision, state.steamDecision, status.instanceId]);

  const openEnhanceSetup = React.useCallback(() => {
    previousNetworkDecisionRef.current = state.networkDecision;
    patch({ enhanceSetup: true, networkDecision: null, error: '' });
  }, [patch, state.networkDecision]);
  const cancelEnhanceSetup = React.useCallback(() => {
    patch({ enhanceSetup: false, networkDecision: previousNetworkDecisionRef.current, error: '' });
  }, [patch]);
  const loginSuccess = React.useCallback(async () => {
    patch({ loginOpen: false, steamDecision: 'login' });
    await refreshSteam();
    await checkAccount();
  }, [checkAccount, patch, refreshSteam]);

  return { state, actions: {
    patch, setNetworkSettings: updateNetworkSettings, refreshSteam, loadNetworkSettings,
    checkAccount, checkNetwork, importHosts, chooseSteam, continueAccount, finish,
    openEnhanceSetup, cancelEnhanceSetup, loginSuccess,
  } };
}
