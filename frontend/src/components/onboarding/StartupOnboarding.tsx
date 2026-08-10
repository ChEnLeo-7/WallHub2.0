import * as React from 'react';
import { ArrowLeft, ArrowRight, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { readPrefs } from '@/hooks/usePreferences';
import type { StartupOnboardingStatus } from '@/lib/api';
import { LanguageContext, TEXT, type Language } from '@/lib/text';
import { AccountStep } from './AccountStep';
import { NetworkStep } from './NetworkStep';
import { ReadyStep } from './ReadyStep';
import { STARTUP_COPY } from './startupCopy';
import type { StartupStep } from './startupTypes';
import { StepTabs } from './StartupSteps';
import { useStartupOnboardingController } from './useStartupOnboardingController';

const LoginDialog = React.lazy(() => import('@/components/dialogs/LoginDialog').then(module => ({ default: module.LoginDialogV2 })));

export function StartupOnboarding({ status, onComplete }: {
  status: StartupOnboardingStatus;
  onComplete: (value: StartupOnboardingStatus) => void;
}) {
  const prefs = React.useMemo(readPrefs, []);
  const language = prefs.language as Language;
  const copy = STARTUP_COPY[language];
  const [step, setStep] = React.useState<StartupStep>('network');
  const { state, actions } = useStartupOnboardingController({ status, onComplete, copy, step, setStep });
  const accountDone = !!state.steamDecision && (state.steamDecision === 'skip' || (!!state.account && state.account.status !== 'login-required'));

  return (
    <LanguageContext.Provider value={{ language, text: TEXT[language] }}>
      <Dialog
        open
        onOpenChange={() => {}}
        dismissible={false}
        title={copy.title}
        wide
        className="max-w-4xl"
        bodyClassName="p-4 sm:p-5"
        footerClassName="grid-cols-[auto_1fr_auto]"
        footer={
          <>
            <Button variant="ghost" disabled={step === 'network' || state.completing} onClick={() => setStep(step === 'ready' ? 'account' : 'network')}>
              <ArrowLeft className="h-4 w-4" />{copy.back}
            </Button>
            <div role={state.error ? 'alert' : undefined} aria-live="assertive" className="hidden self-center text-center text-xs text-destructive sm:block">{state.enhanceSetup ? '' : state.error}</div>
            {step === 'network' ? (
              <Button disabled={!state.networkDecision || state.checkingNetwork || state.enhanceSetup || state.importingHosts} onClick={() => setStep('account')}>{copy.continue}<ArrowRight className="h-4 w-4" /></Button>
            ) : step === 'account' ? (
              <Button onClick={actions.continueAccount} disabled={state.checkingAccount}>{state.checkingAccount ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{copy.continue}<ArrowRight className="h-4 w-4" /></Button>
            ) : (
              <Button onClick={actions.finish} disabled={state.completing}>{state.completing ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{state.completing ? copy.completing : copy.enter}</Button>
            )}
          </>
        }
      >
        <StepTabs step={step} accountDone={accountDone} networkDone={!!state.networkDecision} copy={copy} />
        {state.error && !state.enhanceSetup ? <div role="alert" aria-live="assertive" className="mt-3 text-sm text-destructive sm:hidden">{state.error}</div> : null}
        {step === 'account' ? (
          <AccountStep
            decision={state.steamDecision}
            steam={state.steam}
            account={state.account}
            checking={state.checkingAccount}
            copy={copy}
            onChoose={actions.chooseSteam}
            onLogin={() => actions.patch({ loginOpen: true })}
            onCheck={actions.checkAccount}
          />
        ) : null}
        {step === 'network' ? (
          <NetworkStep
            network={state.network}
            decision={state.networkDecision}
            checking={state.checkingNetwork}
            progress={state.networkProgress}
            progressClock={state.progressClock}
            enhanceSetup={state.enhanceSetup}
            settings={state.networkSettings}
            setSettings={actions.setNetworkSettings}
            customEndpoint={state.customEndpoint}
            importingHosts={state.importingHosts}
            settingsReady={state.networkSettingsReady}
            settingsLoadError={state.networkSettingsLoadError}
            error={state.error}
            copy={copy}
            onPatch={actions.patch}
            onCheck={actions.checkNetwork}
            onOpenEnhance={actions.openEnhanceSetup}
            onCancelEnhance={actions.cancelEnhanceSetup}
            onImportHosts={actions.importHosts}
            onReloadSettings={actions.loadNetworkSettings}
          />
        ) : null}
        {step === 'ready' ? <ReadyStep steamDecision={state.steamDecision} networkDecision={state.networkDecision} steam={state.steam} account={state.account} network={state.network} copy={copy} /> : null}
      </Dialog>
      {state.loginOpen ? <React.Suspense fallback={null}><LoginDialog open onOpenChange={loginOpen => actions.patch({ loginOpen })} fixedPanelHeight={false} onSuccess={actions.loginSuccess} /></React.Suspense> : null}
    </LanguageContext.Provider>
  );
}
