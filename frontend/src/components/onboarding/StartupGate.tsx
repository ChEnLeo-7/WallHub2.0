import * as React from 'react';
import { Loader2, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { readPrefs } from '@/hooks/usePreferences';
import { getStartupOnboardingStatus, type StartupOnboardingStatus } from '@/lib/api';
import type { Language } from '@/lib/text';
import { STARTUP_COPY } from './startupCopy';
import { StartupOnboarding } from './StartupOnboarding';

function StartupStatusOverlay({ retry }: { retry: () => void }) {
  const prefs = React.useMemo(readPrefs, []);
  const language = prefs.language as Language;
  const copy = STARTUP_COPY[language];
  return (
    <Dialog open onOpenChange={() => {}} dismissible={false} fitContent title={copy.title}>
      <div role="status" aria-live="polite" className="flex max-w-sm items-center gap-4 py-2"><Loader2 className="h-6 w-6 shrink-0 animate-spin text-primary" /><div><div className="text-sm font-medium">{copy.loading}</div><div className="mt-1 text-xs text-muted-foreground">{copy.loadingHint}</div></div><Button variant="ghost" size="icon-sm" onClick={retry} aria-label={copy.retry} title={copy.retry}><RefreshCw className="h-4 w-4" /></Button></div>
    </Dialog>
  );
}

export function StartupGate({ children }: { children: (ready: boolean) => React.ReactNode }) {
  const [status, setStatus] = React.useState<StartupOnboardingStatus | null>(null);
  const [unavailable, setUnavailable] = React.useState(false);
  const refreshRequestRef = React.useRef(0);

  const refresh = React.useCallback(async () => {
    const requestId = ++refreshRequestRef.current;
    try {
      const value = await getStartupOnboardingStatus();
      if (requestId !== refreshRequestRef.current) return;
      setStatus(value);
      setUnavailable(false);
    } catch {
      if (requestId !== refreshRequestRef.current) return;
      setUnavailable(true);
    }
  }, []);

  const complete = React.useCallback((value: StartupOnboardingStatus) => {
    refreshRequestRef.current += 1;
    setStatus(value);
    setUnavailable(false);
  }, []);

  React.useEffect(() => {
    refresh();
    const timer = window.setInterval(refresh, status?.completed ? 5000 : 15000);
    return () => window.clearInterval(timer);
  }, [refresh, status?.completed]);

  return (
    <>
      {children(!!status?.completed && !unavailable)}
      {!status || unavailable ? <StartupStatusOverlay retry={refresh} /> : null}
      {status?.required && !unavailable ? <StartupOnboarding status={status} onComplete={complete} /> : null}
    </>
  );
}
