import * as React from 'react';
import {
  getSteamStatus,
  getSubscriptionStatus,
  remoteFavorite,
  remoteSubscribe,
  remoteUnfavorite,
  remoteUnsubscribe,
  type SteamStatus,
  type WorkshopItem,
} from '@/lib/api';
import type { AppText } from '@/lib/text';
import { isSteamLoginError, samePayload } from '@/lib/workshop';

type DelayedSteamActionKind = 'subscribe' | 'favorite';
type PendingSteamAction = { kind: DelayedSteamActionKind; step: 0 | 1 | 2 };
type Toast = (message: string, type?: 'info' | 'ok' | 'warn', timeoutMs?: number) => number;

type UseSteamControllerOptions = {
  text: AppText;
  toast: Toast;
  dismissToast: (id: number) => void;
  reportDownloadClick: (item: WorkshopItem, action: string, source?: string) => void;
};

export function delayedSteamActionKey(kind: DelayedSteamActionKind, id: string) {
  return `${kind}:${id}`;
}

export function useSteamController({
  text,
  toast,
  dismissToast,
  reportDownloadClick,
}: UseSteamControllerOptions) {
  const [steam, setSteam] = React.useState<SteamStatus | null>(null);
  const [loginOpen, setLoginOpen] = React.useState(false);
  const [subscriptionStates, setSubscriptionStates] = React.useState<Record<string, boolean>>({});
  const [favoriteStates, setFavoriteStates] = React.useState<Record<string, boolean>>({});
  const [pendingSteamActions, setPendingSteamActions] = React.useState<Record<string, PendingSteamAction>>({});
  const [submittingSteamActions, setSubmittingSteamActions] = React.useState<Record<string, DelayedSteamActionKind>>({});
  const loginPromptRef = React.useRef({ lastAt: 0, lastKey: '' });
  const subscriptionStatusRequestsRef = React.useRef(new Set<string>());
  const pendingSteamActionTimersRef = React.useRef(new Map<string, { interval: number; timeout: number }>());

  React.useEffect(() => () => {
    pendingSteamActionTimersRef.current.forEach(({ interval, timeout }) => {
      window.clearInterval(interval);
      window.clearTimeout(timeout);
    });
    pendingSteamActionTimersRef.current.clear();
  }, []);

  React.useEffect(() => {
    subscriptionStatusRequestsRef.current.clear();
    setSubscriptionStates({});
    setFavoriteStates({});
  }, [steam?.loggedIn, steam?.username]);

  const refreshSteamStatus = React.useCallback(async () => {
    try {
      const data = await getSteamStatus();
      setSteam((current) => (samePayload(current, data) ? current : data));
    } catch (error) {
      console.warn('[steam]', error);
    }
  }, []);

  const requestLogin = React.useCallback(
    (errorLike?: unknown, force = true) => {
      if (errorLike && !isSteamLoginError(errorLike)) return false;
      if (!force && steam?.loggedIn) return true;
      const error = errorLike as { code?: string; id?: string | number; cacheKey?: string | number };
      const key = `${error?.code || 'STEAM_LOGIN_REQUIRED'}:${error?.id || error?.cacheKey || ''}`;
      const now = Date.now();
      const recentlyPrompted = key === loginPromptRef.current.lastKey && now - loginPromptRef.current.lastAt < (force ? 8000 : 10 * 60 * 1000);
      if (loginOpen || recentlyPrompted) return true;
      toast(text.loginRequired, 'warn');
      setLoginOpen(true);
      loginPromptRef.current = { lastAt: now, lastKey: key };
      return true;
    },
    [loginOpen, steam?.loggedIn, text.loginRequired, toast],
  );

  const resetLoginPrompt = React.useCallback(() => {
    loginPromptRef.current = { lastAt: 0, lastKey: '' };
  }, []);

  const refreshSubscriptionStatus = React.useCallback(async (publishedFileId: string | number) => {
    const id = String(publishedFileId || '').replace(/[^\d]/g, '');
    if (!id || !steam?.loggedIn || subscriptionStatusRequestsRef.current.has(id)) return;
    subscriptionStatusRequestsRef.current.add(id);
    try {
      const result = await getSubscriptionStatus(id);
      setSubscriptionStates((current) => current[id] === result.subscribed ? current : { ...current, [id]: result.subscribed });
      setFavoriteStates((current) => current[id] === result.favorited ? current : { ...current, [id]: result.favorited });
    } catch (error) {
      if (!isSteamLoginError(error)) console.warn('[subscription-status]', error);
    } finally {
      subscriptionStatusRequestsRef.current.delete(id);
    }
  }, [steam?.loggedIn]);

  const syncSelectedItem = React.useCallback((id: string, personalFilter: string) => {
    if (!id) return;
    const isPersonalSubscription = personalFilter === 'mysubscriptions';
    const isPersonalFavorite = personalFilter === 'myfavorites';
    if (isPersonalSubscription) {
      setSubscriptionStates((current) => current[id] === true ? current : { ...current, [id]: true });
    }
    if (isPersonalFavorite) {
      setFavoriteStates((current) => current[id] === true ? current : { ...current, [id]: true });
    }
    if (isPersonalSubscription || isPersonalFavorite) return;
    const subscriptionKnown = subscriptionStates[id] !== undefined;
    const favoriteKnown = favoriteStates[id] !== undefined;
    if (subscriptionKnown && favoriteKnown) return;
    void refreshSubscriptionStatus(id);
  }, [favoriteStates, refreshSubscriptionStatus, subscriptionStates]);

  const startDelayedSteamAction = React.useCallback((kind: DelayedSteamActionKind, item: WorkshopItem) => {
    const id = String(item.publishedfileid || '');
    if (!id) return;
    const key = delayedSteamActionKey(kind, id);
    const activeTimer = pendingSteamActionTimersRef.current.get(key);
    if (activeTimer) {
      window.clearInterval(activeTimer.interval);
      window.clearTimeout(activeTimer.timeout);
      pendingSteamActionTimersRef.current.delete(key);
      setPendingSteamActions((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      reportDownloadClick(item, `cancel-scheduled-remote-${kind}`);
      return;
    }

    reportDownloadClick(item, `schedule-remote-${kind}`);
    setPendingSteamActions((current) => ({ ...current, [key]: { kind, step: 0 } }));
    const interval = window.setInterval(() => {
      setPendingSteamActions((current) => {
        const pending = current[key];
        if (!pending || pending.step === 2) return current;
        return { ...current, [key]: { ...pending, step: (pending.step + 1) as PendingSteamAction['step'] } };
      });
    }, 1000);
    const timeout = window.setTimeout(async () => {
      window.clearInterval(interval);
      pendingSteamActionTimersRef.current.delete(key);
      setPendingSteamActions((current) => {
        const next = { ...current };
        delete next[key];
        return next;
      });
      setSubmittingSteamActions((current) => ({ ...current, [key]: kind }));
      reportDownloadClick(item, `remote-${kind}`);
      const preparingToastId = toast(kind === 'subscribe' ? text.remoteSubscribePreparing : text.remoteFavoritePreparing, 'info', 0);
      if (kind === 'subscribe') {
        setSubscriptionStates((current) => current[id] === true ? current : { ...current, [id]: true });
      } else {
        setFavoriteStates((current) => current[id] === true ? current : { ...current, [id]: true });
      }
      try {
        if (kind === 'subscribe') {
          await remoteSubscribe(item.publishedfileid);
          toast(text.remoteSubscribeSuccess, 'ok');
        } else {
          await remoteFavorite(item.publishedfileid);
          toast(text.remoteFavoriteSuccess, 'ok');
        }
      } catch (error) {
        if (kind === 'subscribe') {
          setSubscriptionStates((current) => current[id] === false ? current : { ...current, [id]: false });
        } else {
          setFavoriteStates((current) => current[id] === false ? current : { ...current, [id]: false });
        }
        if (!requestLogin(error)) toast(error instanceof Error ? error.message : String(error), 'warn');
      } finally {
        dismissToast(preparingToastId);
        setSubmittingSteamActions((current) => {
          const next = { ...current };
          delete next[key];
          return next;
        });
      }
    }, 3000);
    pendingSteamActionTimersRef.current.set(key, { interval, timeout });
  }, [dismissToast, reportDownloadClick, requestLogin, text, toast]);

  const doRemoteSubscribe = React.useCallback((item: WorkshopItem) => startDelayedSteamAction('subscribe', item), [startDelayedSteamAction]);
  const doRemoteFavorite = React.useCallback((item: WorkshopItem) => startDelayedSteamAction('favorite', item), [startDelayedSteamAction]);

  const doRemoteUnsubscribe = React.useCallback(async (item: WorkshopItem) => {
    reportDownloadClick(item, 'remote-unsubscribe');
    const preparingToastId = toast(text.remoteUnsubscribePreparing, 'info', 0);
    try {
      await remoteUnsubscribe(item.publishedfileid);
      dismissToast(preparingToastId);
      const id = String(item.publishedfileid || '');
      if (id) setSubscriptionStates((current) => current[id] === false ? current : { ...current, [id]: false });
      toast(text.remoteUnsubscribeSuccess, 'ok');
    } catch (error) {
      dismissToast(preparingToastId);
      if (!requestLogin(error)) toast(error instanceof Error ? error.message : String(error), 'warn');
    }
  }, [dismissToast, reportDownloadClick, requestLogin, text.remoteUnsubscribePreparing, text.remoteUnsubscribeSuccess, toast]);

  const doRemoteUnfavorite = React.useCallback(async (item: WorkshopItem) => {
    reportDownloadClick(item, 'remote-unfavorite');
    const preparingToastId = toast(text.remoteUnfavoritePreparing, 'info', 0);
    try {
      await remoteUnfavorite(item.publishedfileid);
      dismissToast(preparingToastId);
      const id = String(item.publishedfileid || '');
      if (id) setFavoriteStates((current) => current[id] === false ? current : { ...current, [id]: false });
      toast(text.remoteUnfavoriteSuccess, 'ok');
    } catch (error) {
      dismissToast(preparingToastId);
      if (!requestLogin(error)) toast(error instanceof Error ? error.message : String(error), 'warn');
    }
  }, [dismissToast, reportDownloadClick, requestLogin, text.remoteUnfavoritePreparing, text.remoteUnfavoriteSuccess, toast]);

  return {
    steam,
    loginOpen,
    setLoginOpen,
    subscriptionStates,
    favoriteStates,
    pendingSteamActions,
    submittingSteamActions,
    refreshSteamStatus,
    requestLogin,
    resetLoginPrompt,
    refreshSubscriptionStatus,
    syncSelectedItem,
    doRemoteSubscribe,
    doRemoteUnsubscribe,
    doRemoteFavorite,
    doRemoteUnfavorite,
  };
}
