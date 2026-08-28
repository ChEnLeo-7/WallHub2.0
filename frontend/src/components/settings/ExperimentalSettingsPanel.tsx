import { motion, useReducedMotion } from 'motion/react';
import { ChevronsRight, Database, Film, Gauge, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { normalizeDepotStreamCacheMaxMb } from '@/lib/normalizers';
import type { AppText } from '@/lib/text';
import { ExperimentalToggle } from './SettingPrimitives';
import { panelLayoutMotion } from './panelMotion';
import { StaticCdnSettings, SteamAccessSettings } from './SteamAccessSettings';
import type { SettingsStateProps } from './settingsTypes';
import type { SteamAccessSettingsController } from './useSteamAccessSettings';

type ExperimentalSettingsPanelProps = SettingsStateProps & {
  text: AppText;
  settingsHostsLoaded: boolean;
  prefetchNextPage: boolean;
  setPrefetchNextPage: (enabled: boolean) => void;
  steamAccess: SteamAccessSettingsController;
  depotStreamCacheSelectValue: string;
  depotStreamCacheCustomInput: string;
  setDepotStreamCacheCustomMode: (enabled: boolean) => void;
  setDepotStreamCacheCustomInput: (value: string) => void;
  onClearDepotStreamCache: () => void;
};

export function ExperimentalSettingsPanel({
  text,
  settings,
  setSettings,
  onSave,
  settingsHostsLoaded,
  prefetchNextPage,
  setPrefetchNextPage,
  steamAccess,
  depotStreamCacheSelectValue,
  depotStreamCacheCustomInput,
  setDepotStreamCacheCustomMode,
  setDepotStreamCacheCustomInput,
  onClearDepotStreamCache,
}: ExperimentalSettingsPanelProps) {
  const reduceMotion = useReducedMotion();
  const commitCustomCacheMax = () => {
    const next = normalizeDepotStreamCacheMaxMb(depotStreamCacheCustomInput);
    setDepotStreamCacheCustomInput(String(next));
    setSettings((current) => ({ ...current, depotStreamCacheMaxMb: next }));
    if (next !== settings.depotStreamCacheMaxMb) onSave({ depotStreamCacheMaxMb: next });
  };

  return (
    <motion.div key="settings-experimental" layout className="space-y-6 p-5" {...panelLayoutMotion}>
      <section>
        <h3 className="text-base font-semibold">{text.navExperimental}</h3>
        <p className="mt-1 text-sm text-muted-foreground">{text.experimentalIntro}</p>
      </section>

      <SteamAccessSettings
        text={text}
        settings={settings}
        setSettings={setSettings}
        onSave={onSave}
        settingsHostsLoaded={settingsHostsLoaded}
        reduceMotion={reduceMotion}
        controller={steamAccess}
      />

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <h4 className="flex items-center gap-2 text-sm font-semibold"><Gauge className="h-4 w-4" />{text.wallhubLogLevel}</h4>
        <p className="text-sm text-muted-foreground">{text.wallhubLogLevelDesc}</p>
        <div className="grid grid-cols-2 gap-2 sm:max-w-xs">
          {(['info', 'debug'] as const).map((level) => (
            <Button
              key={level}
              variant={settings.wallhubLogLevel === level ? 'default' : 'outline'}
              onClick={() => {
                const experimental = { ...settings.wallhubSteamAccessExperimental, verboseNetworkLogs: level === 'debug' };
                setSettings((current) => ({ ...current, wallhubLogLevel: level, wallhubSteamAccessExperimental: experimental }));
                onSave({ wallhubLogLevel: level, wallhubSteamAccessExperimental: experimental });
              }}
            >
              {level.toUpperCase()}
            </Button>
          ))}
        </div>
      </section>

      <StaticCdnSettings text={text} settings={settings} controller={steamAccess} />

      <ExperimentalToggle icon={ChevronsRight} title={text.prefetchNextPage} description={text.prefetchNextPageDesc} enabled={prefetchNextPage} onChange={setPrefetchNextPage} />

      <ExperimentalToggle
        icon={Film}
        title={text.steamKitDepotStreaming}
        description={text.steamKitDepotStreamingDesc}
        enabled={settings.steamKitDepotStreaming}
        onChange={(enabled) => {
          setSettings((current) => ({ ...current, steamKitDepotStreaming: enabled }));
          onSave({ steamKitDepotStreaming: enabled });
        }}
      />

      {settings.steamKitDepotStreaming ? (
        <section className="space-y-3 rounded-xl border border-border bg-card p-4">
          <h4 className="flex flex-wrap items-center justify-between gap-2 text-sm font-semibold"><span className="inline-flex items-center gap-2"><Database className="h-4 w-4" />{text.depotStreamCacheMax}</span><Badge className="border border-border bg-background px-3 py-1 text-foreground shadow-sm" variant="outline">{text.current} {settings.depotStreamCacheMaxMb} MB</Badge></h4>
          <p className="text-sm text-muted-foreground">{text.depotStreamCacheMaxDesc}</p>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <Select className="min-w-0 flex-1" value={depotStreamCacheSelectValue} onChange={(value) => { if (value === 'custom') { setDepotStreamCacheCustomMode(true); setDepotStreamCacheCustomInput(String(settings.depotStreamCacheMaxMb || 512)); return; } const next = normalizeDepotStreamCacheMaxMb(value); setDepotStreamCacheCustomMode(false); setSettings((current) => ({ ...current, depotStreamCacheMaxMb: next })); onSave({ depotStreamCacheMaxMb: next }); }} options={[{ value: '512', label: `512 MB（${text.defaultMark}）` }, { value: '1024', label: '1 GB' }, { value: '2048', label: '2 GB' }, { value: '3072', label: '3 GB' }, { value: '4096', label: '4 GB' }, { value: '5120', label: '5 GB' }, { value: '6144', label: '6 GB' }, { value: '7168', label: '7 GB' }, { value: '8192', label: '8 GB' }, { value: 'custom', label: text.depotStreamCacheCustom }]} />
            {depotStreamCacheSelectValue === 'custom' ? <div className="flex min-w-0 flex-1 items-center gap-2"><Input className="min-w-0 flex-1" inputMode="numeric" pattern="[0-9]*" value={depotStreamCacheCustomInput} onChange={(event) => setDepotStreamCacheCustomInput(event.target.value.replace(/[^\d]/g, ''))} onBlur={commitCustomCacheMax} onKeyDown={(event) => { if (event.key === 'Enter') event.currentTarget.blur(); }} placeholder={text.depotStreamCacheCustomPlaceholder} /><span className="shrink-0 text-sm font-medium text-muted-foreground">MB</span></div> : null}
            <Button className="w-full sm:w-36" variant="outline" onClick={onClearDepotStreamCache}><Trash2 className="h-4 w-4" />{text.clearDepotStreamCache}</Button>
          </div>
        </section>
      ) : null}
    </motion.div>
  );
}
