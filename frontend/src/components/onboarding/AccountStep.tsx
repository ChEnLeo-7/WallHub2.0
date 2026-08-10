import { CircleDashed, KeyRound, Loader2, ShieldCheck, UserRound } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { StartupAccountCheck, SteamStatus } from '@/lib/api';
import type { StartupCopy } from './startupCopy';
import type { SteamDecision } from './startupTypes';
import { AccountResult, Choice } from './StartupSteps';

export function AccountStep({ decision, steam, account, checking, copy, onChoose, onLogin, onCheck }: {
  decision: SteamDecision;
  steam: SteamStatus | null;
  account: StartupAccountCheck | null;
  checking: boolean;
  copy: StartupCopy;
  onChoose: (decision: 'login' | 'skip') => void;
  onLogin: () => void;
  onCheck: () => void;
}) {
  return (
    <section className="mt-6">
      <div className="flex items-start gap-3">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary"><UserRound className="h-5 w-5" /></span>
        <div><h2 className="text-lg font-semibold">{copy.accountTitle}</h2><p className="mt-1 max-w-2xl text-sm leading-6 text-muted-foreground">{copy.accountDesc}</p></div>
      </div>
      <div className="mt-5 grid gap-3 md:grid-cols-2">
        <Choice selected={decision === 'login'} icon={<KeyRound className="h-4 w-4" />} title={copy.login} description={copy.loginDesc} onClick={() => onChoose('login')} />
        <Choice selected={decision === 'skip'} icon={<CircleDashed className="h-4 w-4" />} title={copy.skip} description={copy.skipDesc} onClick={() => onChoose('skip')} />
      </div>
      {decision === 'login' ? (
        <div className="mt-4 rounded-xl border border-border bg-card/50 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-input/45 text-muted-foreground"><ShieldCheck className="h-4 w-4" /></span><div><div className="text-xs text-muted-foreground">{steam?.loggedIn && !steam.pendingValidation ? copy.connectedAccount : copy.pendingAccount}</div><div className="mt-0.5 text-sm font-semibold">{steam?.username || 'Steam'}</div></div></div>
            {!steam?.loggedIn || steam.pendingValidation
              ? <Button onClick={onLogin}>{copy.login}</Button>
              : <Button variant="outline" disabled={checking} onClick={onCheck}>{checking ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />}{checking ? copy.checkingAccess : copy.checkAccess}</Button>}
          </div>
          {account && account.status !== 'login-required' ? <div className="mt-4"><AccountResult result={account} copy={copy} /></div> : null}
        </div>
      ) : null}
    </section>
  );
}
