import * as React from 'react';
import { Check, CheckCircle2, CircleDashed, Loader2, TriangleAlert } from 'lucide-react';
import { Progress } from '@/components/ui/progress';
import type { StartupAccountCheck, StartupNetworkProgress } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { StartupCopy } from './startupCopy';
import type { StartupStep } from './startupTypes';

export function StepTabs({ step, accountDone, networkDone, copy }: {
  step: StartupStep;
  accountDone: boolean;
  networkDone: boolean;
  copy: StartupCopy;
}) {
  const activeIndex = step === 'network' ? 0 : step === 'account' ? 1 : 2;
  const items = [
    { label: copy.network, note: copy.required, done: networkDone },
    { label: copy.account, note: copy.optional, done: accountDone },
    { label: copy.ready, note: 'WallHub', done: false },
  ];
  return (
    <div role="list" className="grid grid-cols-3 gap-2 rounded-xl bg-input/35 p-1.5">
      {items.map((item, index) => (
        <div role="listitem" aria-current={index === activeIndex ? 'step' : undefined} key={item.label} className={cn('flex min-w-0 items-center gap-2 rounded-lg px-2.5 py-2 transition-colors', index === activeIndex && 'bg-card shadow-sm')}>
          <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full border text-[10px] font-bold', item.done ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-500' : index === activeIndex ? 'border-primary/35 bg-primary/10 text-primary' : 'border-border text-muted-foreground')}>
            {item.done ? <Check className="h-3.5 w-3.5" /> : index + 1}
          </span>
          <span className="min-w-0"><span className="block truncate text-xs font-semibold text-foreground">{item.label}</span><span className="block truncate text-[10px] text-muted-foreground">{item.note}</span></span>
        </div>
      ))}
    </div>
  );
}

export function Choice({ selected, icon, title, description, onClick }: {
  selected: boolean;
  icon: React.ReactNode;
  title: string;
  description: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onClick}
      className={cn(
        'flex min-h-28 w-full items-start gap-3 rounded-xl border p-4 text-left outline-none transition-[background-color,border-color,box-shadow,transform] active:scale-[0.985] focus-visible:ring-[3px] focus-visible:ring-ring/50',
        selected ? 'border-primary/45 bg-primary/10 shadow-sm' : 'border-border bg-card/50 hover:bg-accent/35',
      )}
    >
      <span className={cn('grid h-9 w-9 shrink-0 place-items-center rounded-lg border', selected ? 'border-primary/30 bg-primary/10 text-primary' : 'border-border bg-input/35 text-muted-foreground')}>{icon}</span>
      <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-foreground">{title}</span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{description}</span></span>
      <span className={cn('mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border', selected ? 'border-primary bg-primary text-primary-foreground' : 'border-border')}>{selected ? <Check className="h-3 w-3" /> : null}</span>
    </button>
  );
}

export function AccountResult({ result, copy }: { result: StartupAccountCheck; copy: StartupCopy }) {
  const owned = result.status === 'owned';
  const missing = result.status === 'not-owned';
  return (
    <div className={cn('flex items-start gap-3 rounded-xl border p-3.5', owned ? 'border-emerald-500/25 bg-emerald-500/[0.07]' : missing ? 'border-amber-500/25 bg-amber-500/[0.07]' : 'border-border bg-muted/30')}>
      {owned ? <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" /> : missing ? <TriangleAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" /> : <CircleDashed className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" />}
      <div><div className="text-sm font-semibold">{owned ? copy.owned : missing ? copy.notOwned : copy.unknown}</div><div className="mt-1 text-xs leading-5 text-muted-foreground">{owned ? copy.ownedDesc : missing ? copy.notOwnedDesc : result.error || copy.unknownDesc}</div></div>
    </div>
  );
}

function formatElapsed(ms: number) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} s`;
  return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
}

export function EnhancedNetworkProgress({ progress, now, copy }: {
  progress: StartupNetworkProgress;
  now: number;
  copy: StartupCopy;
}) {
  const phaseLabels = {
    'saving-settings': copy.savingSettings,
    'resolving-routes': copy.resolvingRoutes,
    'validating-routes': copy.validatingRoutes,
    'requesting-workshop': copy.requestingWorkshop,
    'retrying-workshop': copy.retryingWorkshop,
    'validating-response': copy.validatingResponse,
    complete: copy.requestingWorkshop,
    failed: copy.requestingWorkshop,
  };
  const phaseStage = {
    'saving-settings': 0, 'resolving-routes': 1, 'validating-routes': 2,
    'requesting-workshop': 3, 'retrying-workshop': 3, 'validating-response': 3,
    complete: 4, failed: 3,
  };
  const stages = [copy.savingSettings, copy.resolvingRoutes, copy.validatingRoutes, copy.requestingWorkshop];
  const currentStage = phaseStage[progress.phase];
  const hosts = progress.totalHosts
    ? copy.hostsChecked.replace('{completed}', String(progress.completedHosts)).replace('{total}', String(progress.totalHosts))
    : copy.waitingForHosts;
  const workshopAttempt = progress.workshopAttempt > 0
    ? copy.workshopAttempt.replace('{attempt}', String(progress.workshopAttempt)).replace('{max}', String(progress.workshopMaxAttempts || 3))
    : '';
  const workshopRetries = progress.workshopRetryCount > 0 ? copy.workshopRetries.replace('{count}', String(progress.workshopRetryCount)) : '';

  return (
    <div role="status" aria-live="polite" className="mx-auto w-full max-w-2xl py-1">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><Loader2 className="h-5 w-5 animate-spin" /></span>
        <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{copy.enhancePreparing}</div><div className="mt-1 text-xs text-muted-foreground">{phaseLabels[progress.phase]}</div>{workshopAttempt ? <div className="mt-1 text-[11px] font-medium text-primary">{workshopAttempt}{workshopRetries ? ` · ${workshopRetries}` : ''}</div> : null}{progress.phase === 'retrying-workshop' && progress.workshopLastError ? <div className="mt-1 truncate text-[10px] text-amber-600 dark:text-amber-300" title={progress.workshopLastError}>{progress.workshopLastError}</div> : null}</div>
        <span className="text-sm font-semibold tabular-nums text-primary">{Math.round(progress.progress)}%</span>
      </div>
      <Progress value={progress.progress} className="mt-4 h-2.5" />
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        {stages.map((label, index) => {
          const complete = index < currentStage;
          const active = index === currentStage;
          return <div key={label} className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-xs', active ? 'border-primary/30 bg-primary/[0.07] text-foreground' : 'border-border/70 bg-input/20 text-muted-foreground')}><span className={cn('grid h-5 w-5 shrink-0 place-items-center rounded-full border', complete && 'border-emerald-500/35 bg-emerald-500/10 text-emerald-500', active && 'border-primary/35 text-primary')}>{complete ? <Check className="h-3 w-3" /> : active ? <Loader2 className="h-3 w-3 animate-spin" /> : <span className="h-1.5 w-1.5 rounded-full bg-current opacity-40" />}</span><span className={cn(active && 'font-medium')}>{label}</span></div>;
        })}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <div className="rounded-lg bg-input/30 px-3 py-2.5"><div className="text-[11px] text-muted-foreground">{copy.elapsed}</div><div className="mt-0.5 text-sm font-semibold tabular-nums">{formatElapsed(now - progress.startedAt)}</div></div>
        <div className="rounded-lg bg-input/30 px-3 py-2.5"><div className="text-[11px] text-muted-foreground">{copy.routesReady}</div><div className="mt-0.5 text-sm font-semibold tabular-nums">{progress.availableRoutes}</div><div className="mt-0.5 truncate text-[10px] text-muted-foreground">{hosts}</div></div>
      </div>
    </div>
  );
}
