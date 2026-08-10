import * as React from 'react';
import { CheckCircle2, Loader2, RefreshCw, Sparkles, Wifi, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { StartupNetworkCheck, StartupNetworkProgress, StartupNetworkSettings } from '@/lib/api';
import { cn } from '@/lib/utils';
import { EnhancedSettings } from './EnhancedSettings';
import type { StartupCopy } from './startupCopy';
import type { NetworkDecision } from './startupTypes';
import { EnhancedNetworkProgress } from './StartupSteps';

type Props = {
  network: StartupNetworkCheck | null;
  decision: NetworkDecision;
  checking: boolean;
  progress: StartupNetworkProgress | null;
  progressClock: number;
  enhanceSetup: boolean;
  settings: StartupNetworkSettings;
  setSettings: React.Dispatch<React.SetStateAction<StartupNetworkSettings>>;
  customEndpoint: string;
  importingHosts: boolean;
  settingsReady: boolean;
  settingsLoadError: string;
  error: string;
  copy: StartupCopy;
  onPatch: (value: { customEndpoint?: string; networkDecision?: NetworkDecision }) => void;
  onCheck: (enhanced?: boolean) => void;
  onOpenEnhance: () => void;
  onCancelEnhance: () => void;
  onImportHosts: () => void;
  onReloadSettings: () => void;
};

export function NetworkStep(props: Props) {
  const { network, decision, checking, progress, progressClock, enhanceSetup, error, copy, onCheck, onOpenEnhance } = props;
  return (
    <section className="mt-6">
      <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Wifi className="h-5 w-5" /></span><div><h2 className="text-lg font-semibold">{copy.networkTitle}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{copy.networkDesc}</p></div></div>
      <div className="mt-5 rounded-xl border border-border bg-card/50 p-5">
        {checking ? (
          progress?.route === 'enhanced' ? <EnhancedNetworkProgress progress={progress} now={progressClock} copy={copy} /> : <NetworkLoading copy={copy} />
        ) : enhanceSetup ? (
          <EnhancedSettings
            settings={props.settings}
            setSettings={props.setSettings}
            customEndpoint={props.customEndpoint}
            setCustomEndpoint={value => props.onPatch({ customEndpoint: value })}
            importingHosts={props.importingHosts}
            settingsReady={props.settingsReady}
            settingsLoadError={props.settingsLoadError}
            error={error}
            onImportHosts={props.onImportHosts}
            onReloadSettings={props.onReloadSettings}
            onTest={() => onCheck(true)}
            onCancel={props.onCancelEnhance}
            copy={copy}
          />
        ) : network?.status === 'connected' ? (
          <ConnectedNetwork network={network} checking={checking} copy={copy} onCheck={onCheck} onOpenEnhance={onOpenEnhance} />
        ) : network ? (
          <div>
            <div className="flex items-center gap-2 text-base font-semibold text-destructive"><WifiOff className="h-5 w-5" />{copy.unreachable}</div>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">{copy.unreachableDesc}</p>
            <div className="mt-5 flex flex-col gap-2 sm:flex-row"><Button onClick={onOpenEnhance}><Sparkles className="h-4 w-4" />{copy.enableEnhance}</Button><Button variant="outline" onClick={() => props.onPatch({ networkDecision: 'continue' })}>{copy.continueWithout}</Button></div>
            {decision === 'continue' ? <div className="mt-4 rounded-lg border border-amber-500/20 bg-amber-500/[0.07] p-3 text-xs leading-5 text-amber-600 dark:text-amber-300">{copy.warning}</div> : null}
          </div>
        ) : (
          <div className="grid min-h-52 place-items-center text-center"><div><WifiOff className="mx-auto h-6 w-6 text-muted-foreground" /><div className="mt-3 text-sm text-muted-foreground">{error || copy.unreachable}</div><Button variant="outline" className="mt-4" onClick={() => onCheck()}><RefreshCw className="h-4 w-4" />{copy.retry}</Button></div></div>
        )}
      </div>
    </section>
  );
}

function NetworkLoading({ copy }: { copy: StartupCopy }) {
  return <div className="grid min-h-52 place-items-center text-center"><div><Loader2 className="mx-auto h-7 w-7 animate-spin text-primary" /><div className="mt-4 text-sm font-semibold">{copy.checkingNetwork}</div><div className="mt-1 text-xs text-muted-foreground">{copy.checkingNetworkDesc}</div></div></div>;
}

function ConnectedNetwork({ network, checking, copy, onCheck, onOpenEnhance }: {
  network: StartupNetworkCheck;
  checking: boolean;
  copy: StartupCopy;
  onCheck: (enhanced?: boolean) => void;
  onOpenEnhance: () => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-2 text-base font-semibold text-emerald-500"><CheckCircle2 className="h-5 w-5" />{copy.connected}</div>
      <p className="mt-2 text-sm text-muted-foreground">{network.route === 'enhanced' ? copy.enhancedDesc : copy.directDesc}</p>
      <div className="mt-5 grid gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-input/30 p-3"><div className="text-xs text-muted-foreground">{copy.route}</div><div className="mt-1 text-sm font-semibold">{network.route === 'enhanced' ? copy.enhanced : copy.direct}</div></div>
        <div className="flex items-center justify-between gap-3 rounded-lg bg-input/30 p-3"><div><div className="text-xs text-muted-foreground">{copy.latency}</div><div className="mt-1 text-sm font-semibold">{network.latencyMs} ms</div></div><Button variant="ghost" size="icon-sm" disabled={checking} onClick={() => onCheck(network.route === 'enhanced')} aria-label={copy.retry} title={copy.retry}><RefreshCw className={cn('h-4 w-4', checking && 'animate-spin')} /></Button></div>
      </div>
      {network.route === 'direct' ? <Button variant="outline" className="mt-4" onClick={onOpenEnhance}><Sparkles className="h-4 w-4" />{copy.enableEnhance}</Button> : null}
    </div>
  );
}
