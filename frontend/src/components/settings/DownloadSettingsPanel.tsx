import { motion } from 'motion/react';
import { Database, Download, FolderDown, Gauge, Image as ImageIcon, Route, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import {
  normalizeConcurrentDownloads,
  normalizeDepotStreamCacheMaxMb,
  normalizeSteamKitMaxDownloads,
} from '@/lib/normalizers';
import type { AppText } from '@/lib/text';
import { panelLayoutMotion } from './panelMotion';
import type { SettingsStateProps } from './settingsTypes';

type DownloadSettingsPanelProps = SettingsStateProps & {
  text: AppText;
  mpkgCompactAvailable: boolean;
  mpkgCompactUnavailableReason: string;
  depotStreamCacheSelectValue: string;
  depotStreamCacheCustomInput: string;
  setDepotStreamCacheCustomMode: (enabled: boolean) => void;
  setDepotStreamCacheCustomInput: (value: string) => void;
  onClearDepotStreamCache: () => void;
};

export function DownloadSettingsPanel({
  text,
  settings,
  setSettings,
  mpkgCompactAvailable,
  mpkgCompactUnavailableReason,
  depotStreamCacheSelectValue,
  depotStreamCacheCustomInput,
  setDepotStreamCacheCustomMode,
  setDepotStreamCacheCustomInput,
  onSave,
  onClearDepotStreamCache,
}: DownloadSettingsPanelProps) {
  return (
    <motion.div key="settings-download" layout className="space-y-6 p-5" {...panelLayoutMotion}>
      <section><h3 className="text-base font-semibold">{text.navDownload}</h3><p className="mt-1 text-sm text-muted-foreground">{text.downloadIntro}</p></section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><FolderDown className="h-4 w-4" />{text.downloadDir}</h4>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><Input className="min-w-0 flex-1" value={settings.downloadDir} onChange={(event) => setSettings((current) => ({ ...current, downloadDir: event.target.value }))} placeholder="Downloads" /><Button className="w-full sm:w-32" onClick={() => onSave()}>{text.saveDir}</Button></div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><ImageIcon className="h-4 w-4" />{text.mpkgTextureProfile}</h4>
        <p className="text-sm text-muted-foreground">{text.mpkgTextureProfileDesc}</p>
        {!mpkgCompactAvailable ? <p className="text-sm text-destructive" role="status">{mpkgCompactUnavailableReason || text.mpkgTextureProfileCompactUnavailable}</p> : null}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {(['fast', 'compact'] as const).map((profile) => {
            const compactUnavailable = profile === 'compact' && !mpkgCompactAvailable;
            return <Button key={profile} variant={settings.mpkgTextureProfile === profile ? 'default' : 'outline'} disabled={compactUnavailable} title={compactUnavailable ? (mpkgCompactUnavailableReason || text.mpkgTextureProfileCompactUnavailable) : undefined} onClick={() => { setSettings((current) => ({ ...current, mpkgTextureProfile: profile })); onSave({ mpkgTextureProfile: profile }); }}>{profile === 'fast' ? text.mpkgTextureProfileFast : text.mpkgTextureProfileCompact}</Button>;
          })}
        </div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold"><span className="inline-flex items-center gap-2"><Gauge className="h-4 w-4" />{text.maxConcurrentDownloads}</span><Badge className="border border-border bg-background px-3 py-1 text-foreground shadow-sm" variant="outline">{text.current} {settings.maxConcurrentDownloads} {text.itemUnit}</Badge></h4>
        <Select className="min-w-0 flex-1" value={String(settings.maxConcurrentDownloads)} onChange={(value) => { const next = normalizeConcurrentDownloads(value); setSettings((current) => ({ ...current, maxConcurrentDownloads: next })); onSave({ maxConcurrentDownloads: next }); }} options={[{ value: '1', label: `1 ${text.itemUnit}（${text.defaultMark}）` }, { value: '2', label: `2 ${text.itemUnit}` }, { value: '3', label: `3 ${text.itemUnit}` }, { value: '4', label: `4 ${text.itemUnit}` }]} />
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold"><span className="inline-flex items-center gap-2"><Route className="h-4 w-4" />{text.steamCdnRoute}</span><Badge className="border border-border bg-background px-3 py-1 text-foreground shadow-sm" variant="outline">{settings.steamHttpProxyUrl ? text.steamCdnProxyShort : text.steamCdnDefaultShort}</Badge></h4>
        <p className="text-sm text-muted-foreground">{text.steamCdnRouteDesc}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center"><Input className="min-w-0 flex-1" value={settings.steamHttpProxyUrl} onChange={(event) => { const nextUrl = event.target.value; setSettings((current) => ({ ...current, steamHttpProxyUrl: nextUrl, steamCdnRouteStrategy: nextUrl.trim() ? 'proxy' : 'nearest' })); }} placeholder={text.steamHttpProxyPlaceholder} /><Button className="w-full sm:w-32" onClick={() => onSave({ steamHttpProxyUrl: settings.steamHttpProxyUrl, steamCdnRouteStrategy: settings.steamHttpProxyUrl.trim() ? 'proxy' : 'nearest' })}>{text.saveCdnRoute}</Button></div>
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold"><span className="inline-flex items-center gap-2"><Download className="h-4 w-4" />{text.steamKitMaxDownloads}</span><Badge className="border border-border bg-background px-3 py-1 text-foreground shadow-sm" variant="outline">{text.effectiveValue} {settings.effectiveSteamKitMaxDownloads || settings.steamKitMaxDownloads || 'Auto'}</Badge></h4>
        <p className="text-sm text-muted-foreground">{text.steamKitMaxDownloadsDesc}</p>
        <Select value={String(settings.steamKitMaxDownloads || 0)} onChange={(value) => { const next = normalizeSteamKitMaxDownloads(value); setSettings((current) => ({ ...current, steamKitMaxDownloads: next })); onSave({ steamKitMaxDownloads: next }); }} options={[{ value: '0', label: `Auto（${text.defaultMark}）` }, { value: '8', label: '8' }, { value: '12', label: '12' }, { value: '16', label: '16' }, { value: '24', label: '24' }, { value: '32', label: '32' }]} />
      </section>

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold"><span className="inline-flex items-center gap-2"><Database className="h-4 w-4" />{text.depotStreamCacheMax}</span><Badge className="border border-border bg-background px-3 py-1 text-foreground shadow-sm" variant="outline">{text.current} {settings.depotStreamCacheMaxMb} MB</Badge></h4>
        <p className="text-sm text-muted-foreground">{text.depotStreamCacheMaxDesc}</p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select className="min-w-0 flex-1" value={depotStreamCacheSelectValue} onChange={(value) => { if (value === 'custom') { setDepotStreamCacheCustomMode(true); setDepotStreamCacheCustomInput(String(settings.depotStreamCacheMaxMb || 512)); return; } const next = normalizeDepotStreamCacheMaxMb(value); setDepotStreamCacheCustomMode(false); setSettings((current) => ({ ...current, depotStreamCacheMaxMb: next })); onSave({ depotStreamCacheMaxMb: next }); }} options={[{ value: '512', label: `512 MB（${text.defaultMark}）` }, { value: '1024', label: '1 GB' }, { value: '2048', label: '2 GB' }, { value: '3072', label: '3 GB' }, { value: '4096', label: '4 GB' }, { value: '5120', label: '5 GB' }, { value: '6144', label: '6 GB' }, { value: '7168', label: '7 GB' }, { value: '8192', label: '8 GB' }, { value: 'custom', label: text.depotStreamCacheCustom }]} />
          {depotStreamCacheSelectValue === 'custom' ? <div className="flex min-w-0 flex-1 items-center gap-2"><Input className="min-w-0 flex-1" inputMode="numeric" pattern="[0-9]*" value={depotStreamCacheCustomInput} onChange={(event) => { const raw = event.target.value.replace(/[^\d]/g, ''); setDepotStreamCacheCustomInput(raw); const next = normalizeDepotStreamCacheMaxMb(raw); setSettings((current) => ({ ...current, depotStreamCacheMaxMb: next })); onSave({ depotStreamCacheMaxMb: next }); }} placeholder={text.depotStreamCacheCustomPlaceholder} /><span className="shrink-0 text-sm font-medium text-muted-foreground">MB</span></div> : null}
          <Button className="w-full sm:w-36" variant="outline" onClick={onClearDepotStreamCache}><Trash2 className="h-4 w-4" />{text.clearDepotStreamCache}</Button>
        </div>
      </section>
    </motion.div>
  );
}
