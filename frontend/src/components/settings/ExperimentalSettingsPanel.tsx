import { motion, useReducedMotion } from 'motion/react';
import { ChevronsRight, Film, Gauge, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { VideoPlayerMode } from '@/hooks/usePreferences';
import type { AppText } from '@/lib/text';
import { cn } from '@/lib/utils';
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
  videoPlayerMode: VideoPlayerMode;
  setVideoPlayerMode: (mode: VideoPlayerMode) => void;
  steamAccess: SteamAccessSettingsController;
};

export function ExperimentalSettingsPanel({
  text,
  settings,
  setSettings,
  onSave,
  settingsHostsLoaded,
  prefetchNextPage,
  setPrefetchNextPage,
  videoPlayerMode,
  setVideoPlayerMode,
  steamAccess,
}: ExperimentalSettingsPanelProps) {
  const reduceMotion = useReducedMotion();

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

      <section className="space-y-3 rounded-xl border border-border bg-card p-4">
        <div className="min-w-0">
          <h4 className="flex items-center gap-2 text-sm font-semibold"><Play className="h-4 w-4" />{text.videoPlayerControls}</h4>
          <p className="mt-1 text-sm text-muted-foreground">{text.videoPlayerControlsDesc}</p>
        </div>
        <div className="grid w-full grid-cols-2 gap-1 rounded-lg border border-border bg-input/25 p-1" role="group" aria-label={text.videoPlayerControls}>
          {([['native', text.videoPlayerModeDefault], ['compatibility', text.videoPlayerModeCompatibility]] as const).map(([mode, label]) => (
            <button
              key={mode}
              type="button"
              aria-pressed={videoPlayerMode === mode}
              onClick={() => setVideoPlayerMode(mode)}
              className={cn('relative isolate min-h-9 rounded-md px-3 py-2 text-sm font-medium transition-colors', videoPlayerMode === mode ? 'text-primary-foreground' : 'text-muted-foreground hover:bg-input/65 hover:text-foreground')}
            >
              {videoPlayerMode === mode ? <motion.span layoutId="settings-video-player-mode-indicator" className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-primary shadow-sm" transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42, mass: 0.72 }} /> : null}
              <span className="relative z-10">{label}</span>
            </button>
          ))}
        </div>
      </section>

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
    </motion.div>
  );
}
