import { CheckCircle2 } from 'lucide-react';
import type { StartupAccountCheck, StartupNetworkCheck, SteamStatus } from '@/lib/api';
import type { StartupCopy } from './startupCopy';
import type { NetworkDecision, SteamDecision } from './startupTypes';

export function ReadyStep({ steamDecision, networkDecision, steam, account, network, copy }: {
  steamDecision: SteamDecision;
  networkDecision: NetworkDecision;
  steam: SteamStatus | null;
  account: StartupAccountCheck | null;
  network: StartupNetworkCheck | null;
  copy: StartupCopy;
}) {
  return (
    <section className="mt-6">
      <div className="flex items-start gap-3"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-emerald-500/10 text-emerald-500"><CheckCircle2 className="h-5 w-5" /></span><div><h2 className="text-lg font-semibold">{copy.readyTitle}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{copy.readyDesc}</p></div></div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <div className="rounded-xl border border-border bg-card/50 p-4"><div className="text-xs text-muted-foreground">{copy.accountSummary}</div><div className="mt-2 text-sm font-semibold">{steamDecision === 'login' ? steam?.username || account?.username || 'Steam' : copy.browsingOnly}</div>{account ? <div className="mt-1 text-xs text-muted-foreground">{account.status === 'owned' ? copy.owned : account.status === 'not-owned' ? copy.notOwned : copy.unknown}</div> : null}</div>
        <div className="rounded-xl border border-border bg-card/50 p-4"><div className="text-xs text-muted-foreground">{copy.networkSummary}</div><div className="mt-2 text-sm font-semibold">{networkDecision === 'enhanced' ? copy.enhanced : networkDecision === 'continue' ? copy.continueWithout : copy.direct}</div>{network ? <div className="mt-1 text-xs text-muted-foreground">steamcommunity.com · {network.latencyMs} ms</div> : null}</div>
      </div>
    </section>
  );
}
