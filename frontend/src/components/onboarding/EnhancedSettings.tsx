import * as React from 'react';
import { Check, Database, Globe2, Loader2, RefreshCw, Sparkles, X } from 'lucide-react';
import { HostsSourceHint } from '@/components/HostsSourceHint';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DEFAULT_STEAM_ACCESS_DOH_ENDPOINT,
  DEFAULT_STEAM_ACCESS_DOT_ENDPOINT,
  STEAM_ACCESS_DOH_ENDPOINTS,
  STEAM_ACCESS_DOT_ENDPOINTS,
} from '@/components/settings/constants';
import type { StartupNetworkSettings } from '@/lib/api';
import { normalizeSteamAccessHostsUrl, validateSteamAccessEndpoint } from '@/lib/normalizers';
import { cn } from '@/lib/utils';
import type { StartupCopy } from './startupCopy';
import { hasValidHostsMapping } from './startupNetworkSettings';
import { Choice } from './StartupSteps';

type Props = {
  settings: StartupNetworkSettings;
  setSettings: React.Dispatch<React.SetStateAction<StartupNetworkSettings>>;
  customEndpoint: string;
  setCustomEndpoint: (value: string) => void;
  importingHosts: boolean;
  settingsReady: boolean;
  settingsLoadError: string;
  error: string;
  onImportHosts: () => void;
  onReloadSettings: () => void;
  onTest: () => void;
  onCancel: () => void;
  copy: StartupCopy;
};

export function EnhancedSettings({ settings, setSettings, customEndpoint, setCustomEndpoint, importingHosts, settingsReady, settingsLoadError, error, onImportHosts, onReloadSettings, onTest, onCancel, copy }: Props) {
  const protocol = settings.wallhubSteamAccessResolverProtocol;
  const custom = protocol === 'dot' ? settings.wallhubSteamAccessCustomDotEndpoints : settings.wallhubSteamAccessCustomDohEndpoints;
  const selected = protocol === 'dot' ? settings.wallhubSteamAccessSelectedDotEndpoints : settings.wallhubSteamAccessSelectedDohEndpoints;
  const builtin = protocol === 'dot' ? STEAM_ACCESS_DOT_ENDPOINTS : STEAM_ACCESS_DOH_ENDPOINTS;
  const endpoints = Array.from(new Set<string>([...builtin, ...custom]));
  const hostsUrl = normalizeSteamAccessHostsUrl(settings.wallhubSteamAccessHostsUrl);
  const hostsText = settings.wallhubSteamAccessHosts.trim();
  const canTest = settings.wallhubSteamAccessMode === 'resolver'
    ? selected.length > 0
    : (hasValidHostsMapping(hostsText) || (!hostsText && !!hostsUrl)) && (!settings.wallhubSteamAccessHostsAutoUpdateEnabled || !!hostsUrl);

  if (!settingsReady) {
    return (
      <div>
        <SettingsHeading copy={copy} onCancel={onCancel} />
        <div role={settingsLoadError ? 'alert' : 'status'} aria-live={settingsLoadError ? 'assertive' : 'polite'} className={cn('mt-5 flex min-h-32 items-center justify-center rounded-xl border p-5 text-center', settingsLoadError ? 'border-destructive/25 bg-destructive/[0.06] text-destructive' : 'border-border bg-input/20 text-muted-foreground')}>
          <div>
            {!settingsLoadError ? <Loader2 className="mx-auto mb-3 h-5 w-5 animate-spin" /> : null}
            <div className="text-sm">{settingsLoadError || copy.loadingSettings}</div>
            {settingsLoadError ? <Button variant="outline" size="sm" className="mt-3" onClick={onReloadSettings}><RefreshCw className="h-4 w-4" />{copy.retry}</Button> : null}
          </div>
        </div>
      </div>
    );
  }

  const toggleEndpoint = (endpoint: string) => {
    const next = selected.includes(endpoint) ? selected.filter(item => item !== endpoint) : [...selected, endpoint];
    if (!next.length) return;
    setSettings(current => protocol === 'dot'
      ? { ...current, wallhubSteamAccessSelectedDotEndpoints: next, wallhubSteamAccessDotEndpoint: next[0] }
      : { ...current, wallhubSteamAccessSelectedDohEndpoints: next, wallhubSteamAccessDohEndpoint: next[0] });
  };

  const addCustomEndpoint = () => {
    const endpoint = validateSteamAccessEndpoint(customEndpoint, protocol);
    if (!endpoint) return;
    setSettings(current => protocol === 'dot'
      ? {
        ...current,
        wallhubSteamAccessCustomDotEndpoints: Array.from(new Set([...current.wallhubSteamAccessCustomDotEndpoints, endpoint])),
        wallhubSteamAccessSelectedDotEndpoints: Array.from(new Set([...current.wallhubSteamAccessSelectedDotEndpoints, endpoint])),
        wallhubSteamAccessDotEndpoint: endpoint,
      }
      : {
        ...current,
        wallhubSteamAccessCustomDohEndpoints: Array.from(new Set([...current.wallhubSteamAccessCustomDohEndpoints, endpoint])),
        wallhubSteamAccessSelectedDohEndpoints: Array.from(new Set([...current.wallhubSteamAccessSelectedDohEndpoints, endpoint])),
        wallhubSteamAccessDohEndpoint: endpoint,
      });
    setCustomEndpoint('');
  };

  const removeCustomEndpoint = (endpoint: string) => {
    setSettings(current => {
      if (protocol === 'dot') {
        const selectedDot = current.wallhubSteamAccessSelectedDotEndpoints.filter(item => item !== endpoint);
        const next = selectedDot.length ? selectedDot : [DEFAULT_STEAM_ACCESS_DOT_ENDPOINT];
        return { ...current, wallhubSteamAccessCustomDotEndpoints: current.wallhubSteamAccessCustomDotEndpoints.filter(item => item !== endpoint), wallhubSteamAccessSelectedDotEndpoints: next, wallhubSteamAccessDotEndpoint: next[0] };
      }
      const selectedDoh = current.wallhubSteamAccessSelectedDohEndpoints.filter(item => item !== endpoint);
      const next = selectedDoh.length ? selectedDoh : [DEFAULT_STEAM_ACCESS_DOH_ENDPOINT];
      return { ...current, wallhubSteamAccessCustomDohEndpoints: current.wallhubSteamAccessCustomDohEndpoints.filter(item => item !== endpoint), wallhubSteamAccessSelectedDohEndpoints: next, wallhubSteamAccessDohEndpoint: next[0] };
    });
  };

  return (
    <div aria-busy={importingHosts}>
      <SettingsHeading copy={copy} onCancel={onCancel} disabled={importingHosts} />
      <fieldset disabled={importingHosts}>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Choice selected={settings.wallhubSteamAccessMode === 'resolver'} icon={<Globe2 className="h-4 w-4" />} title={copy.smartResolver} description={copy.smartResolverDesc} onClick={() => setSettings(current => ({ ...current, wallhubSteamAccessMode: 'resolver' }))} />
          <Choice selected={settings.wallhubSteamAccessMode === 'hosts'} icon={<Database className="h-4 w-4" />} title={copy.hostsMode} description={copy.hostsModeDesc} onClick={() => setSettings(current => ({ ...current, wallhubSteamAccessMode: 'hosts' }))} />
        </div>
        {settings.wallhubSteamAccessMode === 'resolver' ? (
          <div className="mt-4 space-y-4 rounded-xl border border-border/80 bg-input/15 p-4">
            <div><div className="text-xs font-medium text-muted-foreground">{copy.resolverProtocol}</div><div className="mt-2 grid grid-cols-2 gap-2">{(['doh', 'dot'] as const).map(item => <Button key={item} aria-pressed={protocol === item} variant={protocol === item ? 'default' : 'outline'} onClick={() => { setSettings(current => ({ ...current, wallhubSteamAccessResolverProtocol: item })); setCustomEndpoint(''); }}>{item.toUpperCase()}</Button>)}</div></div>
            <div>
              <div className="flex items-end justify-between gap-3"><div><div className="text-xs font-medium text-muted-foreground">{copy.resolverEndpoints}</div><div className="mt-1 text-[11px] text-muted-foreground">{copy.endpointHint}</div></div><span className="text-xs tabular-nums text-muted-foreground">{selected.length}</span></div>
              <div className="mt-2 grid max-h-36 gap-2 overflow-y-auto pr-1 sm:grid-cols-2">
                {endpoints.map(endpoint => {
                  const checked = selected.includes(endpoint);
                  return <div key={endpoint} className={cn('flex min-w-0 items-center gap-2 rounded-lg border px-3 py-2 text-xs', checked ? 'border-primary/35 bg-primary/[0.07]' : 'border-border bg-card/45')}><button type="button" aria-pressed={checked} onClick={() => toggleEndpoint(endpoint)} className="flex min-w-0 flex-1 items-center gap-2 text-left"><span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded border', checked && 'border-primary bg-primary text-primary-foreground')}>{checked ? <Check className="h-3 w-3" /> : null}</span><span className="truncate" title={endpoint}>{endpoint}</span></button>{custom.includes(endpoint) ? <button type="button" onClick={() => removeCustomEndpoint(endpoint)} className="text-muted-foreground hover:text-destructive" aria-label={`${copy.removeEndpoint}: ${endpoint}`}><X className="h-3.5 w-3.5" /></button> : null}</div>;
                })}
              </div>
            </div>
            <div><label htmlFor="startup-custom-endpoint" className="text-xs font-medium text-muted-foreground">{copy.customEndpoint}</label><div className="mt-2 flex gap-2"><Input id="startup-custom-endpoint" value={customEndpoint} onChange={event => setCustomEndpoint(event.target.value)} placeholder={protocol === 'dot' ? 'dns.example.com:853' : 'https://dns.example.com/dns-query'} /><Button variant="outline" disabled={!validateSteamAccessEndpoint(customEndpoint, protocol)} onClick={addCustomEndpoint}>{copy.addEndpoint}</Button></div></div>
          </div>
        ) : (
          <HostsSettings settings={settings} setSettings={setSettings} hostsUrl={hostsUrl} importingHosts={importingHosts} onImportHosts={onImportHosts} copy={copy} />
        )}
      </fieldset>
      {!canTest && settings.wallhubSteamAccessMode === 'hosts' ? <div className="mt-3 text-xs text-muted-foreground">{copy.invalidHosts}</div> : null}
      <Button className="mt-4 w-full" disabled={importingHosts || !canTest} onClick={onTest}><Sparkles className="h-4 w-4" />{copy.testConfiguration}</Button>
      {error ? <div role="alert" aria-live="assertive" className="mt-3 text-sm text-destructive">{error}</div> : null}
    </div>
  );
}

function SettingsHeading({ copy, onCancel, disabled = false }: { copy: StartupCopy; onCancel: () => void; disabled?: boolean }) {
  return <div className="flex items-start justify-between gap-4"><div><div className="text-base font-semibold">{copy.enhanceSetupTitle}</div><div className="mt-1 text-xs leading-5 text-muted-foreground">{copy.enhanceSetupDesc}</div></div><Button variant="ghost" size="sm" disabled={disabled} onClick={onCancel}>{copy.cancelEnhance}</Button></div>;
}

function HostsSettings({ settings, setSettings, hostsUrl, importingHosts, onImportHosts, copy }: {
  settings: StartupNetworkSettings;
  setSettings: React.Dispatch<React.SetStateAction<StartupNetworkSettings>>;
  hostsUrl: string;
  importingHosts: boolean;
  onImportHosts: () => void;
  copy: StartupCopy;
}) {
  return (
    <div className="mt-4 space-y-4 rounded-xl border border-border/80 bg-input/15 p-4">
      <div><label htmlFor="startup-hosts-text" className="text-xs font-medium text-muted-foreground">{copy.hostsText}</label><textarea id="startup-hosts-text" value={settings.wallhubSteamAccessHosts} onChange={event => setSettings(current => ({ ...current, wallhubSteamAccessHosts: event.target.value }))} placeholder={copy.hostsPlaceholder} className="scrollbar-overlay mt-2 min-h-28 w-full resize-y rounded-lg border border-input bg-input/35 px-3 py-2 font-mono text-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50" /></div>
      <div><label htmlFor="startup-hosts-url" className="text-xs font-medium text-muted-foreground">{copy.hostsUrl}</label><div className="mt-2 flex gap-2"><Input id="startup-hosts-url" value={settings.wallhubSteamAccessHostsUrl} onChange={event => setSettings(current => ({ ...current, wallhubSteamAccessHostsUrl: event.target.value }))} placeholder="https://example.com/hosts" /><Button variant="outline" disabled={!hostsUrl} onClick={onImportHosts}>{importingHosts ? copy.importingHosts : copy.importHosts}</Button></div></div>
      <button type="button" role="checkbox" aria-checked={settings.wallhubSteamAccessHostsAutoUpdateEnabled} onClick={() => setSettings(current => ({ ...current, wallhubSteamAccessHostsAutoUpdateEnabled: !current.wallhubSteamAccessHostsAutoUpdateEnabled }))} className="flex w-full items-center gap-2.5 rounded-lg px-1 py-1 text-left text-xs outline-none transition-colors hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"><span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-md border transition-colors', settings.wallhubSteamAccessHostsAutoUpdateEnabled ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-input/35 text-transparent')}><Check className="h-3.5 w-3.5" /></span><span>{copy.autoUpdateHosts}</span></button>
      {settings.wallhubSteamAccessHostsAutoUpdateEnabled ? <label className="flex items-center gap-2 text-xs text-muted-foreground"><span>{copy.updateInterval}</span><Input type="number" min={0.5} max={168} step={0.5} value={settings.wallhubSteamAccessHostsUpdateIntervalHours} onChange={event => setSettings(current => ({ ...current, wallhubSteamAccessHostsUpdateIntervalHours: Number(event.target.value || 24) }))} className="w-24" /><span>{copy.hours}</span></label> : null}
      <HostsSourceHint exampleLabel={copy.hostsUrlExample} forkHint={copy.hostsForkHint} />
    </div>
  );
}
