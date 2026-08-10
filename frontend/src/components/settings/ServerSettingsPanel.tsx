import { motion } from 'motion/react';
import { ChevronsRight, Download, ExternalLink, Power, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import type { RuntimeStatus } from '@/lib/api';
import type { AppText } from '@/lib/text';
import { cn } from '@/lib/utils';
import { ExperimentalToggle, InfoRow, RuntimeStatusValue } from './SettingPrimitives';
import { panelLayoutMotion } from './panelMotion';
import type { SettingsStateProps } from './settingsTypes';

type ServerSettingsPanelProps = SettingsStateProps & {
  text: AppText;
  runtime: RuntimeStatus | null;
  runtimeSteamAccess: RuntimeStatus['steamAccess'] | undefined;
  steamAccessResolverValue: string;
  webapiConnectionValue: string;
  onCheckUpdate: () => void;
  onDownloadUpdate: () => void;
  onInstallUpdate: () => void;
  onRestart: () => void;
  onShutdown: () => void;
};

export function ServerSettingsPanel({
  text,
  runtime,
  runtimeSteamAccess,
  steamAccessResolverValue,
  webapiConnectionValue,
  settings,
  setSettings,
  onSave,
  onCheckUpdate,
  onDownloadUpdate,
  onInstallUpdate,
  onRestart,
  onShutdown,
}: ServerSettingsPanelProps) {
  const setup = runtime?.runtimeSetup;
  const update = runtime?.update;
  const updateBusy = ['checking', 'downloading', 'installing'].includes(String(update?.status || ''));
  const updateStatusLabel = (() => {
    switch (update?.status) {
      case 'checking': return text.updateStatusChecking;
      case 'up-to-date': return text.updateStatusCurrent;
      case 'available': return text.updateStatusAvailable;
      case 'unsupported': return text.updateStatusUnsupported;
      case 'downloading': return text.updateStatusDownloading;
      case 'downloaded': return text.updateStatusDownloaded;
      case 'installing': return text.updateStatusInstalling;
      case 'error': return text.updateStatusError;
      default: return text.updateStatusIdle;
    }
  })();

  return (
    <motion.div key="settings-server" layout className="space-y-6 p-5" {...panelLayoutMotion}>
      <section>
        <h3 className="text-base font-semibold">{text.navServer}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{text.serverIntro}</p>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <InfoRow label={text.runMode} value={(runtime?.effectiveDownloader || '-').toUpperCase()} stackOnMobile />
        <InfoRow label={text.runStatus} value={<RuntimeStatusValue value={setup?.message || setup?.status || '-'} />} stackOnMobile />
        <InfoRow label={text.contentMode} value={runtime?.nsfwEnabled ? 'NSFW' : text.safeMode} stackOnMobile />
        <InfoRow label={text.currentCdnNode} value={runtime?.steamCdn?.currentHost || text.cdnWaiting} stackOnMobile />
        {runtimeSteamAccess?.enabled ? (
          <>
            <InfoRow label={text.currentResolverServer} value={steamAccessResolverValue} stackOnMobile />
            {runtimeSteamAccess.webapiPool ? <InfoRow label={text.webapiConnectionStatus} value={webapiConnectionValue} stackOnMobile /> : null}
            {runtimeSteamAccess.webapiPool ? (
              <InfoRow
                label="WebAPI IP"
                value={`active ${runtimeSteamAccess.webapiPool.active || 0} · cooling ${runtimeSteamAccess.webapiPool.cooling || 0} · fastest ${runtimeSteamAccess.webapiPool.fastest || '-'} · ${runtimeSteamAccess.webapiPool.rttMs || 0} ms`}
                stackOnMobile
              />
            ) : null}
          </>
        ) : null}
        {setup?.status && setup.status !== 'ready' ? <Progress value={Number(setup?.progress || 0)} /> : null}
        <div className="break-all text-xs text-muted-foreground">{text.runnerDir}: {runtime?.runnerDir || setup?.runnerDir || '-'}</div>
        <div className="break-all text-xs text-muted-foreground">{text.downloadsDir}: {runtime?.downloadsDir || setup?.downloadsDir || '-'}</div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><Download className="h-4 w-4" />{text.appUpdate}</h4>
        <InfoRow label={text.currentVersion} value={`v${update?.currentVersion || runtime?.version || '-'}`} />
        <InfoRow label={text.latestVersion} value={update?.latestVersion ? `v${update.latestVersion}` : '-'} />
        <InfoRow label={text.updateStatus} value={updateStatusLabel} />
        {updateBusy ? <Progress value={Number(update?.progress || 0)} indeterminate={update?.status === 'checking'} /> : null}
        {update?.status === 'downloading' && Number(update.totalBytes || 0) > 0 ? <p className="text-xs text-muted-foreground">{Math.min(100, Math.max(0, Number(update.progress || 0)))}% · {update.assetName || ''}</p> : null}
        {update?.error ? <p className="text-sm text-destructive" role="status">{text.updateStatusError}{update.errorCode ? ` (${update.errorCode})` : ''}</p> : null}
        {runtime?.docker ? <p className="text-sm text-muted-foreground">{update?.dockerAutoUpdate ? text.dockerUpdateManaged : text.dockerUpdateManual}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          {update?.releaseUrl ? <Button variant="outline" onClick={() => window.open(update.releaseUrl, '_blank', 'noopener,noreferrer')}><ExternalLink className="h-4 w-4" />{text.viewRelease}</Button> : null}
          <Button variant="outline" disabled={updateBusy} onClick={onCheckUpdate}><RefreshCw className={cn('h-4 w-4', update?.status === 'checking' && 'animate-spin')} />{text.checkUpdate}</Button>
          {runtime && !runtime.docker && update?.updateAvailable && update?.canDownload ? <Button disabled={updateBusy} onClick={onDownloadUpdate}><Download className="h-4 w-4" />{text.downloadUpdate}</Button> : null}
          {runtime && !runtime.docker && update?.canInstall ? <Button disabled={updateBusy} onClick={onInstallUpdate}><ChevronsRight className="h-4 w-4" />{text.installUpdate}</Button> : null}
        </div>
      </section>

      {runtime && !runtime.docker ? (
        <ExperimentalToggle
          icon={RefreshCw}
          title={text.autoUpdate}
          description={text.autoUpdateDesc}
          enabled={settings.wallhubAutoUpdateEnabled}
          onChange={(enabled) => {
            setSettings((current) => ({ ...current, wallhubAutoUpdateEnabled: enabled }));
            onSave({ wallhubAutoUpdateEnabled: enabled });
          }}
        />
      ) : null}

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="text-sm font-semibold">{text.serverControl}</h4>
        <div className="flex flex-wrap justify-end gap-2">
          <Button className="w-full sm:w-36" variant="outline" onClick={onRestart}><RefreshCw className="h-4 w-4" />{text.restartServer}</Button>
          {runtime?.canShutdown !== false ? <Button className="w-full sm:w-36" variant="destructive" onClick={onShutdown}><Power className="h-4 w-4" />{text.shutdownServer}</Button> : null}
        </div>
      </section>
    </motion.div>
  );
}
