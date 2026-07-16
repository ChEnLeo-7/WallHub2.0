import * as React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Check, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useText, type Language } from '@/lib/text';
import { cn } from '@/lib/utils';

export type ToastItem = { id: number; message: string; type: 'info' | 'ok' | 'warn' };

export function LoadingState({ warmingSteamIp = false }: { warmingSteamIp?: boolean }) {
  const text = useText();
  return <div className="grid place-items-center rounded-xl border border-border bg-card p-16 text-muted-foreground"><Loader2 className="mb-3 h-8 w-8 animate-spin text-muted-foreground" />{warmingSteamIp ? text.warmingSteamIp : text.loadingWorkshop}</div>;
}

export function EmptyState() {
  const text = useText();
  return <div className="grid place-items-center rounded-xl border border-border bg-card p-16 text-muted-foreground">{text.emptyWorkshop}</div>;
}

export function sourceLabel(source: string, fallback: boolean, language: Language) {
  const labels: Record<string, { zh: string; en: string }> = {
    'community-sequence': { zh: '社区序列', en: 'Community sequence' },
    'community-sequence-dom-fallback': { zh: '社区序列 DOM 降级', en: 'Community sequence DOM fallback' },
    'community-ssr': { zh: 'Steam 社区 SSR', en: 'Steam Community SSR' },
    'community-dom-fallback': { zh: '社区 DOM 降级', en: 'Community DOM fallback' },
    'webapi-fallback': { zh: 'Web API 降级', en: 'Web API fallback' },
  };
  const label = labels[source]?.[language] || source;
  return fallback ? (language === 'en' ? `${label}, order may differ` : `${label}，排序可能不同`) : label;
}

export function ErrorState({ message, onRetry, proxyDomains }: { message: string; onRetry: () => void; proxyDomains: readonly string[] }) {
  const text = useText();
  return <div className="grid place-items-center gap-3 rounded-xl border border-border bg-card p-12 text-center"><div className="text-destructive">{message}</div><div className="max-w-lg text-sm text-muted-foreground">{text.networkHint}</div><Button onClick={onRetry}>{text.retry}</Button><Button variant="outline" onClick={() => navigator.clipboard?.writeText(proxyDomains.join('\n'))}>{text.copyProxyDomains}</Button></div>;
}

export function ToastStack({ items }: { items: ToastItem[] }) {
  return <div className="pointer-events-none fixed left-1/2 top-4 z-[120] grid -translate-x-1/2 gap-2"><AnimatePresence>{items.map((toast) => <motion.div key={toast.id} initial={{ opacity: 0, y: -12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.98 }} transition={{ type: 'spring', stiffness: 420, damping: 38, mass: 0.9 }} className={cn('pointer-events-auto flex min-w-[260px] items-center gap-2 rounded-xl border border-border bg-popover/95 px-4 py-3 text-sm shadow-panel backdrop-blur', toast.type === 'ok' && 'border-primary/20', toast.type === 'warn' && 'border-destructive/50')}>{toast.type === 'ok' ? <Check className="h-4 w-4 text-primary" /> : toast.type === 'warn' ? <X className="h-4 w-4 text-destructive" /> : <Loader2 className="h-4 w-4 text-muted-foreground" />}{toast.message}</motion.div>)}</AnimatePresence></div>;
}
