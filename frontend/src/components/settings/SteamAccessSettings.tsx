import { motion } from 'motion/react';
import { Check, Download, ExternalLink, Images, KeyRound, Link2, Route, ShieldCheck, SlidersHorizontal } from 'lucide-react';
import { HostsSourceHint } from '@/components/HostsSourceHint';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { normalizeSteamAccessHostsUpdateIntervalHours } from '@/lib/normalizers';
import type { RuntimeStatus } from '@/lib/api';
import type { AppText } from '@/lib/text';
import { cn } from '@/lib/utils';
import { STEAM_PROXY_QUICK_LINKS } from './constants';
import { ExperimentalToggle } from './SettingPrimitives';
import type { SettingsStateProps } from './settingsTypes';
import type { SteamAccessSettingsController } from './useSteamAccessSettings';

type SteamAccessSettingsProps = SettingsStateProps & {
  text: AppText;
  settingsHostsLoaded: boolean;
  reduceMotion: boolean | null;
  controller: SteamAccessSettingsController;
};

export function SteamAccessSettings({
  text,
  settings,
  setSettings,
  onSave,
  settingsHostsLoaded,
  reduceMotion,
  controller,
}: SteamAccessSettingsProps) {
  const {
    runtimeSteamAccess,
    resolverProtocol,
    resolverUiMode,
    selectedResolverEndpoints,
    currentResolverEndpoint,
    hostsEntryCount,
    hostsUrlReady,
    hostsDirty,
    hostsFetchBusy,
    customSteamHostsUrl,
    setCustomSteamHostsUrl,
    setHostsEdited,
    steamProxyQuickUrl,
    setSteamProxyQuickUrl,
    setResolverPickerOpen,
    openSteamProxyTarget,
    saveSteamAccessMode,
    saveSteamHosts,
    saveResolverProtocol,
    fetchHostsFromBackend,
  } = controller;
  const showResolverSettings = resolverUiMode === 'resolver' && settings.wallhubSteamAccessEnhance;
  const showHostsSettings = resolverUiMode === 'hosts' && settings.wallhubSteamAccessEnhance;

  return (
    <>
      <ExperimentalToggle
        icon={ShieldCheck}
        title={text.wallhubSteamAccessEnhance}
        description={text.wallhubSteamAccessEnhanceDesc}
        enabled={settings.wallhubSteamAccessEnhance}
        onChange={(enabled) => {
          setSettings((current) => ({ ...current, wallhubSteamAccessEnhance: enabled }));
          onSave({ wallhubSteamAccessEnhance: enabled });
        }}
      />

      {settings.wallhubSteamAccessEnhance ? (
        <>
          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <div className="flex flex-col gap-3">
              <div className="min-w-0">
                <h4 className="flex items-center gap-2 text-sm font-semibold"><SlidersHorizontal className="h-4 w-4" />{text.resolverPickerTitle}</h4>
                <p className="mt-1 text-sm text-muted-foreground">{text.resolverSelectDesc}</p>
              </div>
              <div className="relative isolate grid w-full grid-cols-2 gap-1 overflow-hidden rounded-lg border border-border bg-input/25 p-1 [contain:paint]" role="group" aria-label={text.resolverPickerTitle}>
                {([
                  ['resolver', text.resolverModeResolver],
                  ['hosts', text.resolverModeHosts],
                ] as const).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    aria-pressed={resolverUiMode === mode}
                    onClick={() => saveSteamAccessMode(mode)}
                    className={cn(
                      'relative isolate h-9 rounded-md px-2 text-sm font-medium transition-[color,filter,transform] active:scale-[0.98] active:brightness-110',
                      resolverUiMode === mode ? 'text-primary-foreground' : 'text-muted-foreground hover:bg-input/65 hover:text-foreground',
                    )}
                  >
                    {resolverUiMode === mode ? (
                      <motion.span
                        layoutId="settings-resolver-mode-indicator"
                        className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-primary/90 shadow-sm"
                        transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42, mass: 0.72 }}
                      />
                    ) : null}
                    <span className="relative z-10">{label}</span>
                  </button>
                ))}
              </div>
              {showResolverSettings ? (
                <>
                  <div className="grid grid-cols-2 gap-2">
                    <Button variant={resolverProtocol === 'doh' ? 'default' : 'outline'} onClick={() => saveResolverProtocol('doh')}>{text.resolverProtocolDoh}</Button>
                    <Button variant={resolverProtocol === 'dot' ? 'default' : 'outline'} onClick={() => saveResolverProtocol('dot')}>{text.resolverProtocolDot}</Button>
                  </div>
                  <div className="flex flex-col gap-2 rounded-lg border border-border bg-input/25 p-3 sm:flex-row sm:items-center">
                    <div className="min-w-0 flex-1">
                      <div className="text-xs text-muted-foreground">{text.resolverCurrent}</div>
                      <div className="break-all text-sm font-medium text-foreground">{resolverProtocol.toUpperCase()} · {currentResolverEndpoint}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{text.resolverSelectedCount}: {selectedResolverEndpoints.length}</div>
                    </div>
                    <Button className="w-full sm:w-28" variant="outline" onClick={() => setResolverPickerOpen(true)}><SlidersHorizontal className="h-4 w-4" />{text.resolverSwitch}</Button>
                  </div>
                </>
              ) : null}
            </div>
          </section>

          {showHostsSettings ? (
            <HostsSettings
              text={text}
              settings={settings}
              setSettings={setSettings}
              onSave={onSave}
              settingsHostsLoaded={settingsHostsLoaded}
              runtimeSteamAccess={runtimeSteamAccess}
              hostsEntryCount={hostsEntryCount}
              hostsUrlReady={hostsUrlReady}
              hostsDirty={hostsDirty}
              hostsFetchBusy={hostsFetchBusy}
              customSteamHostsUrl={customSteamHostsUrl}
              setCustomSteamHostsUrl={setCustomSteamHostsUrl}
              setHostsEdited={setHostsEdited}
              saveSteamHosts={saveSteamHosts}
              fetchHostsFromBackend={fetchHostsFromBackend}
            />
          ) : null}

          <section className="space-y-3 rounded-xl border border-border bg-card p-4">
            <h4 className="flex items-center gap-2 text-sm font-semibold"><Link2 className="h-4 w-4" />{text.steamProxyQuickOpen}</h4>
            <p className="text-sm text-muted-foreground">{text.steamProxyQuickOpenDesc}</p>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <Input className="min-w-0 flex-1" value={steamProxyQuickUrl} onChange={(event) => setSteamProxyQuickUrl(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') openSteamProxyTarget(steamProxyQuickUrl); }} placeholder={text.steamProxyQuickOpenPlaceholder} />
              <Button className="w-full sm:w-32" disabled={!steamProxyQuickUrl.trim()} onClick={() => openSteamProxyTarget(steamProxyQuickUrl)}><ExternalLink className="h-4 w-4" />{text.openProxyUrl}</Button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
              {STEAM_PROXY_QUICK_LINKS.map((item) => <Button key={item.key} className="justify-start px-3 text-left text-xs" size="sm" variant="outline" onClick={() => openSteamProxyTarget(item.url)}><ExternalLink className="h-3.5 w-3.5" />{text[item.key]}</Button>)}
            </div>
          </section>
        </>
      ) : null}

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><KeyRound className="h-4 w-4" />{text.wallhubSteamWebApiControl}</h4>
        <p className="text-sm text-muted-foreground">{text.wallhubSteamWebApiControlDesc}</p>
        <div className={cn('grid grid-cols-1 gap-3', settings.wallhubSteamAccessEnhance && 'sm:grid-cols-3')}>
          {settings.wallhubSteamAccessEnhance ? <Select label={text.wallhubSteamWebApiRouteLabel} value={settings.wallhubSteamWebApiRoute} onChange={(value) => { const route = value as 'direct' | 'follow'; const directEnabled = route === 'direct'; setSettings((current) => ({ ...current, wallhubSteamWebApiRoute: route, wallhubSteamAccessDirectWebApi: directEnabled })); onSave({ wallhubSteamWebApiRoute: route, wallhubSteamAccessDirectWebApi: directEnabled }); }} options={[{ value: 'direct', label: text.wallhubSteamWebApiRouteDirect }, { value: 'follow', label: text.wallhubSteamWebApiRouteFollow }]} /> : null}
          <Select label={text.wallhubSteamWebApiProtocolLabel} value={settings.wallhubSteamWebApiProtocol} onChange={(value) => { const protocol = value as 'https' | 'http'; setSettings((current) => ({ ...current, wallhubSteamWebApiProtocol: protocol })); onSave({ wallhubSteamWebApiProtocol: protocol }); }} options={[{ value: 'https', label: 'HTTPS' }, { value: 'http', label: 'HTTP' }]} />
          <Select label={text.wallhubSteamWebApiHostLabel} value={settings.wallhubSteamWebApiHost} onChange={(value) => { const host = value as 'api.steampowered.com' | 'community.steam-api.com'; setSettings((current) => ({ ...current, wallhubSteamWebApiHost: host })); onSave({ wallhubSteamWebApiHost: host }); }} options={[{ value: 'api.steampowered.com', label: 'api.steampowered.com' }, { value: 'community.steam-api.com', label: 'community.steam-api.com' }]} />
        </div>
      </section>
    </>
  );
}

type HostsSettingsProps = SettingsStateProps & {
  text: AppText;
  settingsHostsLoaded: boolean;
  runtimeSteamAccess: RuntimeStatus['steamAccess'] | undefined;
  hostsEntryCount: number;
  hostsUrlReady: boolean;
  hostsDirty: boolean;
  hostsFetchBusy: boolean;
  customSteamHostsUrl: string;
  setCustomSteamHostsUrl: (value: string) => void;
  setHostsEdited: (edited: boolean) => void;
  saveSteamHosts: () => void;
  fetchHostsFromBackend: () => Promise<void>;
};

function HostsSettings({ text, settings, setSettings, onSave, settingsHostsLoaded, runtimeSteamAccess, hostsEntryCount, hostsUrlReady, hostsDirty, hostsFetchBusy, customSteamHostsUrl, setCustomSteamHostsUrl, setHostsEdited, saveSteamHosts, fetchHostsFromBackend }: HostsSettingsProps) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold"><span className="inline-flex items-center gap-2"><Route className="h-4 w-4" />{text.resolverHostsTitle}</span><Badge className="border border-border bg-background/70 px-3 py-1 text-foreground shadow-sm" variant="outline">{hostsEntryCount} hosts</Badge></h4>
      <p className="text-sm text-muted-foreground">{text.resolverHostsDesc}</p>
      <textarea className="scrollbar-overlay min-h-40 w-full resize-y rounded-md border border-input bg-input/45 p-3 text-sm text-foreground outline-none transition-[color,box-shadow,background-color] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" value={settings.wallhubSteamAccessHosts} onChange={(event) => { setHostsEdited(true); setSettings((current) => ({ ...current, wallhubSteamAccessHosts: event.target.value })); }} placeholder={text.resolverHostsPlaceholder} spellCheck={false} disabled={!settingsHostsLoaded} aria-busy={!settingsHostsLoaded} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <Input className="min-w-0 flex-1" value={customSteamHostsUrl} onChange={(event) => { setCustomSteamHostsUrl(event.target.value); setSettings((current) => ({ ...current, wallhubSteamAccessHostsUrl: event.target.value })); }} onKeyDown={(event) => { if (event.key === 'Enter' && hostsUrlReady && !hostsDirty) { event.preventDefault(); void fetchHostsFromBackend(); } }} placeholder="" />
        <Button className="w-full sm:w-36" disabled={hostsFetchBusy || !settingsHostsLoaded} variant="outline" onClick={() => (hostsDirty || !hostsUrlReady ? saveSteamHosts() : void fetchHostsFromBackend())}>{hostsDirty || !hostsUrlReady ? <Check className="h-4 w-4" /> : <Download className="h-4 w-4" />}{hostsDirty || !hostsUrlReady ? '保存' : text.resolverHostsFetch}</Button>
      </div>
      <div className="flex items-end gap-2">
        <Select className="min-w-0 flex-1" label={text.resolverHostsAutoUpdate} value={settings.wallhubSteamAccessHostsAutoUpdateEnabled ? String(settings.wallhubSteamAccessHostsUpdateIntervalHours) : 'off'} onChange={(value) => { const enabled = value !== 'off'; const hours = enabled ? normalizeSteamAccessHostsUpdateIntervalHours(value) : settings.wallhubSteamAccessHostsUpdateIntervalHours; setSettings((current) => ({ ...current, wallhubSteamAccessHostsAutoUpdateEnabled: enabled, wallhubSteamAccessHostsUpdateIntervalHours: hours })); onSave({ wallhubSteamAccessHostsAutoUpdateEnabled: enabled, wallhubSteamAccessHostsUpdateIntervalHours: hours }); }} options={[{ value: 'off', label: text.disabled }, { value: '0.5', label: '30 min' }, { value: '1', label: '1 h' }, { value: '3', label: '3 h' }, { value: '6', label: '6 h' }, { value: '12', label: '12 h' }, { value: '24', label: '24 h' }, { value: '72', label: '72 h' }, { value: '168', label: '168 h' }]} />
        <Badge className="mb-0.5 h-9 border border-border bg-background/70 px-3 text-foreground shadow-sm" variant="outline">{settings.wallhubSteamAccessHostsAutoUpdateEnabled ? settings.wallhubSteamAccessHostsUpdateIntervalHours === 0.5 ? '30 min' : `${settings.wallhubSteamAccessHostsUpdateIntervalHours} h` : text.disabled}</Badge>
      </div>
      <HostsSourceHint exampleLabel={text.resolverHostsUrlExample} forkHint={text.resolverHostsForkHint} />
      <div className="space-y-1 text-xs text-muted-foreground">
        <div>{text.resolverHostsLastUpdated}: {settings.wallhubSteamAccessHostsLastUpdatedAt ? new Date(settings.wallhubSteamAccessHostsLastUpdatedAt).toLocaleString() : '-'}</div>
        <div>{text.resolverHostsLastError}: {settings.wallhubSteamAccessHostsLastError || runtimeSteamAccess?.hosts?.lastError || '-'}</div>
      </div>
    </section>
  );
}

export function StaticCdnSettings({ text, settings, controller }: {
  text: AppText;
  settings: SettingsStateProps['settings'];
  controller: SteamAccessSettingsController;
}) {
  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-4">
      <h4 className="flex items-center gap-2 text-sm font-semibold"><Images className="h-4 w-4" />{text.wallhubSteamAccessStaticCdnControl}</h4>
      <p className="text-sm text-muted-foreground">{text.wallhubSteamAccessStaticCdnControlDesc}</p>
      <div className="grid gap-3">
        {([['imagesSteamusercontent', 'images.steamusercontent.com'], ['sharedAkamaiSteamstatic', 'shared.akamai.steamstatic.com']] as const).map(([key, host]) => {
          const control = settings.wallhubSteamAccessStaticCdnHosts[key] || { enhance: false, reuseConnection: true };
          return (
            <div key={key} className={cn('grid gap-2 rounded-lg border border-border/70 bg-background/40 p-3 sm:items-center', settings.wallhubSteamAccessEnhance && 'sm:grid-cols-[1fr_auto_auto]', !settings.wallhubSteamAccessEnhance && 'sm:grid-cols-[1fr_auto]')}>
              <div className="min-w-0"><div className="break-all text-sm font-medium">{host}</div><div className="text-xs text-muted-foreground">{text.wallhubSteamAccessStaticCdnHostDesc}</div></div>
              {settings.wallhubSteamAccessEnhance ? <Button variant={control.enhance ? 'default' : 'outline'} onClick={() => controller.saveStaticCdnHostControl(key, { enhance: !control.enhance })}>{text.builtinEnhance}: {control.enhance ? text.enabled : text.disabled}</Button> : null}
              <Button variant={control.reuseConnection ? 'default' : 'outline'} onClick={() => controller.saveStaticCdnHostControl(key, { reuseConnection: !control.reuseConnection })}>{text.reuseConnection}: {control.reuseConnection ? text.enabled : text.disabled}</Button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
