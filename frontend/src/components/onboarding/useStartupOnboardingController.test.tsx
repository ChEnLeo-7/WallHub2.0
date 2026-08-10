import * as React from 'react';
import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import {
  checkStartupNetwork,
  getSettings,
  getStartupOnboardingStatus,
  getSteamStatus,
  type StartupOnboardingStatus,
} from '@/lib/api';
import { STARTUP_COPY } from './startupCopy';
import type { StartupStep } from './startupTypes';
import { useStartupOnboardingController } from './useStartupOnboardingController';

vi.mock('@/lib/api', () => ({
  checkStartupAccount: vi.fn(),
  checkStartupNetwork: vi.fn(),
  completeStartupOnboarding: vi.fn(),
  fetchSteamAccessHosts: vi.fn(),
  getSettings: vi.fn(),
  getSettingsDetails: vi.fn(),
  getStartupOnboardingStatus: vi.fn(),
  getSteamStatus: vi.fn(),
}));

const status: StartupOnboardingStatus = {
  instanceId: 'instance-1',
  required: true,
  completed: false,
  startedAt: 1,
  completedAt: 0,
};

describe('useStartupOnboardingController', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.mocked(getSettings).mockResolvedValue({});
    vi.mocked(getSteamStatus).mockResolvedValue({ loggedIn: false, pendingValidation: false } as never);
    vi.mocked(getStartupOnboardingStatus).mockReturnValue(new Promise(() => {}));
    vi.mocked(checkStartupNetwork).mockImplementation((instanceId, enhanced, settings, signal) => new Promise((resolve, reject) => {
      signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
    }));
  });

  afterEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  test('leaves the loading state after fifteen seconds when the browser request never completes', async () => {
    const { result, unmount } = renderHook(() => {
      const [step, setStep] = React.useState<StartupStep>('network');
      return useStartupOnboardingController({ status, onComplete: vi.fn(), copy: STARTUP_COPY.en, step, setStep });
    });

    await act(async () => { await Promise.resolve(); });
    expect(result.current.state.checkingNetwork).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(15000); });

    expect(result.current.state.checkingNetwork).toBe(false);
    expect(result.current.state.network).toMatchObject({
      status: 'unreachable',
      route: 'direct',
      latencyMs: 15000,
    });
    expect(result.current.state.network?.error).toContain('15 seconds');
    unmount();
  });

  test('accepts a completed snapshot when mounting during an active network check', async () => {
    const activeStatus: StartupOnboardingStatus = {
      ...status,
      networkProgress: {
        checkId: 'check-1', active: true, route: 'direct', phase: 'requesting-workshop', progress: 35,
        startedAt: Date.now(), updatedAt: Date.now(), completedHosts: 0, totalHosts: 0,
        availableRoutes: 0, workshopAttempt: 1, workshopMaxAttempts: 1,
        workshopRetryCount: 0, workshopLastError: '',
      },
    };
    vi.mocked(getStartupOnboardingStatus).mockResolvedValue({
      ...activeStatus,
      network: {
        checkId: 'check-1', status: 'connected', route: 'direct', enhanceEnabled: false, latencyMs: 200,
      },
      networkProgress: { ...activeStatus.networkProgress!, active: false, phase: 'complete', progress: 100 },
    });

    const { result } = renderHook(() => {
      const [step, setStep] = React.useState<StartupStep>('network');
      return useStartupOnboardingController({ status: activeStatus, onComplete: vi.fn(), copy: STARTUP_COPY.en, step, setStep });
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(1); });

    expect(result.current.state.checkingNetwork).toBe(false);
    expect(result.current.state.network).toMatchObject({ status: 'connected', checkId: 'check-1' });
  });

  test('times out a recovered active check based on its original start time', async () => {
    const activeStatus: StartupOnboardingStatus = {
      ...status,
      networkProgress: {
        checkId: 'check-old', active: true, route: 'direct', phase: 'requesting-workshop', progress: 35,
        startedAt: Date.now() - 14000, updatedAt: Date.now(), completedHosts: 0, totalHosts: 0,
        availableRoutes: 0, workshopAttempt: 1, workshopMaxAttempts: 1,
        workshopRetryCount: 0, workshopLastError: '',
      },
    };
    const { result } = renderHook(() => {
      const [step, setStep] = React.useState<StartupStep>('network');
      return useStartupOnboardingController({ status: activeStatus, onComplete: vi.fn(), copy: STARTUP_COPY.en, step, setStep });
    });

    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });

    expect(result.current.state.checkingNetwork).toBe(false);
    expect(result.current.state.network).toMatchObject({ status: 'unreachable', checkId: 'check-old' });
  });
});
