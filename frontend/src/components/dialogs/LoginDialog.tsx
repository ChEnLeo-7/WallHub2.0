import * as React from 'react';
import { Loader2, QrCode, ShieldCheck } from 'lucide-react';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useText } from '@/lib/text';
import {
  cancelSteamQrLogin,
  getSteamPasswordLoginStatus,
  getSteamQrLoginStatus,
  startSteamPasswordLogin,
  startSteamQrLogin,
  type SteamPasswordLoginSession,
  type SteamQrLoginSession,
} from '@/lib/api';

export function LoginDialogV2({
  open,
  onOpenChange,
  fixedPanelHeight,
  onSuccess,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fixedPanelHeight: boolean;
  onSuccess: () => void;
}) {
  const text = useText();
  const [mode, setMode] = React.useState<'password' | 'qr'>('password');
  const [username, setUsername] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [guard, setGuard] = React.useState('');
  const [useSteamToken, setUseSteamToken] = React.useState(false);
  const [needsGuard, setNeedsGuard] = React.useState(false);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState('');
  const [passwordSession, setPasswordSession] = React.useState<SteamPasswordLoginSession | null>(null);
  const [qrSession, setQrSession] = React.useState<SteamQrLoginSession | null>(null);
  const [qrLoading, setQrLoading] = React.useState(false);
  const qrSuccessHandledRef = React.useRef(false);
  const passwordSuccessHandledRef = React.useRef(false);

  React.useEffect(() => {
    if (!open) {
      setUsername('');
      setPassword('');
      setGuard('');
      setUseSteamToken(false);
      setNeedsGuard(false);
      setLoading(false);
      setError('');
      setPasswordSession(null);
      setMode('password');
      setQrLoading(false);
      setQrSession(null);
      qrSuccessHandledRef.current = false;
      passwordSuccessHandledRef.current = false;
    }
  }, [open]);

  React.useEffect(() => {
    if (!open || mode !== 'password' || !passwordSession?.id || ['success', 'error', 'needs-guard'].includes(passwordSession.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const data = await getSteamPasswordLoginStatus(passwordSession.id);
        setPasswordSession(data);
        if (data.status === 'success' && !passwordSuccessHandledRef.current) {
          passwordSuccessHandledRef.current = true;
          onSuccess();
        } else if (data.status === 'needs-guard' || data.needsSteamGuard) {
          setUseSteamToken(true);
          setNeedsGuard(true);
          setError(data.error || text.guardRequired);
        } else if (data.status === 'error') {
          setError(data.error || data.message || text.loginFailed);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [mode, onSuccess, open, passwordSession?.id, passwordSession?.status, text.guardRequired, text.loginFailed]);

  React.useEffect(() => {
    if (!open || mode !== 'qr' || !qrSession?.id || ['success', 'error', 'cancelled'].includes(qrSession.status)) return;
    const timer = window.setInterval(async () => {
      try {
        const data = await getSteamQrLoginStatus(qrSession.id);
        setQrSession(data);
        if (data.status === 'success' && !qrSuccessHandledRef.current) {
          qrSuccessHandledRef.current = true;
          onSuccess();
        } else if (data.status === 'error') {
          setError(data.error || data.message || text.qrFailed);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [mode, onSuccess, open, qrSession?.id, qrSession?.status]);

  const submit = async () => {
    if (!username || !password) {
      setError(text.enterCredentials);
      return;
    }
    if (useSteamToken && !guard.trim()) {
      setError(text.enterSteamToken);
      return;
    }
    setLoading(true);
    setError('');
    setPasswordSession(null);
    try {
      const data = await startSteamPasswordLogin({
        username,
        password,
        steamGuardCode: useSteamToken ? guard.trim() : '',
        isRetry: needsGuard,
      });
      setPasswordSession(data);
      if (data.status === 'success') {
        passwordSuccessHandledRef.current = true;
        onSuccess();
        return;
      }
      if (data.status === 'needs-guard' || data.needsSteamGuard) {
        setUseSteamToken(true);
        setNeedsGuard(true);
        setError(data.error || text.guardRequired);
        return;
      }
    } catch (e) {
      const err = e as Error & { requiresSteamGuard?: boolean; code?: string; message?: string };
      if (err.code === 'STEAM_NETWORK_UNREACHABLE' || err.code === 'STEAM_LOGIN_TIMEOUT') {
        setError(err.message || text.networkHint);
      } else if (err.requiresSteamGuard || err.code === 'STEAM_GUARD_REQUIRED') {
        setUseSteamToken(true);
        setNeedsGuard(true);
        setError(text.guardRequired);
      } else {
        setError(err.message || text.loginFailed);
      }
    } finally {
      setLoading(false);
    }
  };

  const startQr = async () => {
    setQrLoading(true);
    setError('');
    try {
      const data = await startSteamQrLogin();
      qrSuccessHandledRef.current = false;
      setQrSession(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setQrLoading(false);
    }
  };

  const cancelQr = async () => {
    if (qrSession?.id && !['success', 'error', 'cancelled'].includes(qrSession.status)) {
      try { await cancelSteamQrLogin(qrSession.id); } catch {}
    }
    setQrSession(null);
    setQrLoading(false);
  };

  const closeDialog = () => {
    cancelQr();
    onOpenChange(false);
  };

  const showQrSpinner = qrLoading || !!(qrSession && !['success', 'error', 'cancelled'].includes(qrSession.status));
  const passwordLoginActive = loading || !!(passwordSession && !['success', 'error', 'needs-guard'].includes(passwordSession.status));
  const passwordStatusMessage = passwordSession?.requiresPhoneConfirmation
    ? text.phoneConfirmationRequired
    : (passwordSession?.message || text.loginStarting);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) closeDialog();
        else onOpenChange(next);
      }}
      fixedHeight={fixedPanelHeight}
      title={text.steamLoginTitle}
      footer={
        <>
          <Button variant="outline" onClick={closeDialog}>{text.cancel}</Button>
          {mode === 'qr' ? (
            qrSession && !['success', 'error', 'cancelled'].includes(qrSession.status) ? (
              <Button variant="outline" onClick={cancelQr}>{text.cancelQr}</Button>
            ) : (
              <Button onClick={startQr} disabled={qrLoading}>
                {qrLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <QrCode className="h-4 w-4" />}
                {text.generateQr}
              </Button>
            )
          ) : (
            <Button onClick={submit} disabled={passwordLoginActive}>
              {passwordLoginActive ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {useSteamToken ? text.submitSteamToken : text.login}
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-2 rounded-lg bg-input/40 p-1">
          <Button type="button" variant={mode === 'password' ? 'default' : 'ghost'} size="sm" onClick={() => setMode('password')}>
            {text.passwordLogin}
          </Button>
          <Button
            type="button"
            variant={mode === 'qr' ? 'default' : 'ghost'}
            size="sm"
            onClick={() => {
              setMode('qr');
              setError('');
              if (!qrSession && !qrLoading) startQr();
            }}
          >
            <QrCode className="h-4 w-4" />
            {text.qrLogin}
          </Button>
        </div>
        <div className="rounded-xl border border-border bg-card p-3 text-sm text-muted-foreground">
          {mode === 'qr'
            ? text.qrHelp
            : text.passwordHelp}
        </div>
        {mode === 'password' ? (
          <>
            <Input placeholder={text.steamUsername} autoComplete="username" value={username} onChange={(event) => setUsername(event.target.value)} />
            <Input placeholder={text.steamPassword} type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} />
            {useSteamToken ? (
              <div className="space-y-2">
                <Input
                  placeholder={text.steamTokenCode}
                  autoComplete="one-time-code"
                  inputMode="text"
                  value={guard}
                  onChange={(event) => setGuard(event.target.value)}
                />
                <p className="text-xs text-muted-foreground">{text.steamTokenHelp}</p>
              </div>
            ) : (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                disabled={passwordLoginActive}
                onClick={() => {
                  setUseSteamToken(true);
                  setError('');
                }}
              >
                <ShieldCheck className="h-4 w-4" />
                {text.useSteamToken}
              </Button>
            )}
            {passwordSession ? <p className="text-xs text-muted-foreground" aria-live="polite">{text.loginStatus}: {passwordStatusMessage}</p> : null}
          </>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3 rounded-xl border border-border bg-input/30 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{qrSession?.message || (qrLoading ? text.qrGenerating : text.qrStart)}</span>
              {showQrSpinner ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /> : null}
            </div>
            {qrSession?.qrImage ? (
              <div className="grid place-items-center rounded-xl border border-border bg-white p-5">
                <img className="aspect-square w-full max-w-[180px] object-contain [image-rendering:pixelated]" src={qrSession.qrImage} alt={text.qrLogin} />
              </div>
            ) : qrSession?.output ? (
              <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-border bg-input/20 px-4 text-center text-sm text-muted-foreground">
                {text.qrWaitImage}
              </div>
            ) : (
              <div className="grid min-h-40 place-items-center rounded-xl border border-dashed border-border bg-input/20 text-sm text-muted-foreground">
                {qrLoading ? text.qrWaitingOutput : text.qrWillShow}
              </div>
            )}
            {qrSession?.username ? <div className="text-sm text-primary">{text.qrConfirmed}: {qrSession.username}</div> : null}
          </div>
        )}
        {error ? <div className="text-sm text-destructive">{error}</div> : null}
      </div>
    </Dialog>
  );
}
