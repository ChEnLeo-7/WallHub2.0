import * as React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { getStartupOnboardingStatus, type StartupOnboardingStatus } from '@/lib/api';
import { StartupGate } from './StartupGate';

vi.mock('@/hooks/usePreferences', () => ({
  readPrefs: () => ({ language: 'en' }),
}));

vi.mock('@/lib/api', () => ({
  getStartupOnboardingStatus: vi.fn(),
}));

vi.mock('./StartupOnboarding', () => ({
  StartupOnboarding: ({ status, onComplete }: {
    status: StartupOnboardingStatus;
    onComplete: (value: StartupOnboardingStatus) => void;
  }) => (
    <section aria-label="Startup onboarding">
      <button type="button" onClick={() => onComplete({ ...status, required: false, completed: true })}>
        Finish setup
      </button>
    </section>
  ),
}));

const getStatus = vi.mocked(getStartupOnboardingStatus);

function status(overrides: Partial<StartupOnboardingStatus> = {}): StartupOnboardingStatus {
  return {
    instanceId: 'instance-1',
    required: false,
    completed: true,
    startedAt: 1,
    completedAt: 2,
    ...overrides,
  };
}

function renderGate() {
  return render(
    <StartupGate>
      {ready => <main>{ready ? 'Application ready' : 'Application blocked'}</main>}
    </StartupGate>,
  );
}

describe('StartupGate', () => {
  beforeEach(() => {
    getStatus.mockReset();
  });

  test('blocks the application while loading, then renders it ready', async () => {
    let resolveStatus: (value: StartupOnboardingStatus) => void = () => {};
    const completedStatus = status();
    getStatus
      .mockReturnValueOnce(new Promise(resolve => {
        resolveStatus = resolve;
      }))
      .mockResolvedValue(completedStatus);

    renderGate();

    expect(screen.getByText('Application blocked')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading startup setup...');

    resolveStatus(completedStatus);

    expect(await screen.findByText('Application ready')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('status')).not.toBeInTheDocument());
  });

  test('keeps the loading overlay after a failure and retries successfully', async () => {
    const user = userEvent.setup();
    getStatus
      .mockRejectedValueOnce(new Error('service unavailable'))
      .mockResolvedValue(status());

    renderGate();

    await waitFor(() => expect(getStatus).toHaveBeenCalledTimes(1));
    expect(screen.getByText('Application blocked')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Check again' }));

    expect(await screen.findByText('Application ready')).toBeInTheDocument();
    expect(getStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  test('renders onboarding when required and unblocks after completion', async () => {
    const user = userEvent.setup();
    const pendingRefresh = new Promise<StartupOnboardingStatus>(() => {});
    getStatus
      .mockResolvedValueOnce(status({ required: true, completed: false, completedAt: 0 }))
      .mockReturnValueOnce(pendingRefresh)
      .mockResolvedValue(status());

    renderGate();

    expect(await screen.findByRole('region', { name: 'Startup onboarding' })).toBeInTheDocument();
    expect(screen.getByText('Application blocked')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Finish setup' }));

    expect(await screen.findByText('Application ready')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Startup onboarding' })).not.toBeInTheDocument());
  });
});
