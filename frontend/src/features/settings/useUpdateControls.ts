import * as React from 'react';
import {
  checkForUpdates,
  downloadUpdate,
  installUpdate,
  type RuntimeStatus,
} from '@/lib/api';
import type { AppText } from '@/lib/text';

type Toast = (message: string, type?: 'info' | 'ok' | 'warn', timeoutMs?: number) => number;

type UseUpdateControlsOptions = {
  runtime: RuntimeStatus | null;
  text: AppText;
  toast: Toast;
  refreshRuntime: (fresh?: boolean) => Promise<void>;
};

export function useUpdateControls({ runtime, text, toast, refreshRuntime }: UseUpdateControlsOptions) {
  const updateNotificationRef = React.useRef('');

  React.useEffect(() => {
    checkForUpdates({ cached: true })
      .then(() => refreshRuntime(true))
      .catch((error) => {
        console.warn('[update-check]', error);
        return refreshRuntime(true);
      });
  }, [refreshRuntime]);

  React.useEffect(() => {
    const latestVersion = runtime?.update?.updateAvailable ? String(runtime.update.latestVersion || '') : '';
    if (!latestVersion || updateNotificationRef.current === latestVersion) return;
    updateNotificationRef.current = latestVersion;
    toast(text.updateAvailableToast.replace('{version}', latestVersion), 'info', 6000);
  }, [runtime?.update?.latestVersion, runtime?.update?.updateAvailable, text.updateAvailableToast, toast]);

  const checkUpdate = React.useCallback(async () => {
    try {
      const result = await checkForUpdates();
      updateNotificationRef.current = result.updateAvailable ? String(result.latestVersion || '') : '';
      toast(result.updateAvailable
        ? text.updateAvailableToast.replace('{version}', String(result.latestVersion || ''))
        : text.updateStatusCurrent, result.updateAvailable ? 'info' : 'ok');
      await refreshRuntime(true);
    } catch (error) {
      toast(text.updateCheckFailed, 'warn');
      await refreshRuntime(true);
    }
  }, [refreshRuntime, text, toast]);

  const downloadAvailableUpdate = React.useCallback(async () => {
    try {
      await downloadUpdate();
      toast(text.updateDownloadStarted, 'info');
      await refreshRuntime(true);
    } catch (error) {
      toast(text.updateDownloadFailed, 'warn');
      await refreshRuntime(true);
    }
  }, [refreshRuntime, text.updateDownloadFailed, text.updateDownloadStarted, toast]);

  const installAvailableUpdate = React.useCallback(async () => {
    if (!window.confirm(text.updateInstallConfirm)) return;
    try {
      await installUpdate();
      toast(text.updateStatusInstalling, 'ok', 8000);
      await refreshRuntime(true);
    } catch (error) {
      toast(text.updateInstallFailed, 'warn');
      await refreshRuntime(true);
    }
  }, [refreshRuntime, text.updateInstallConfirm, text.updateInstallFailed, text.updateStatusInstalling, toast]);

  return {
    checkUpdate,
    downloadAvailableUpdate,
    installAvailableUpdate,
  };
}
