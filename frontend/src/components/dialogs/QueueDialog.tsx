import * as React from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import {
  ArrowUp,
  ArrowDown,
  Download,
  Pause,
  Play,
  Trash2,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Progress } from '@/components/ui/progress';
import { AnimatedHeight } from '@/components/layout/AnimatedHeight';
import { useText, type AppText } from '@/lib/text';
import {
  cn,
  formatBytesText,
  formatSpeedText,
} from '@/lib/utils';
import { type QueueTask } from '@/lib/api';

type QueueStatusFilter = 'all' | 'completed' | 'downloading' | 'pending' | 'error';
type QueueWallpaperTypeFilter = 'all' | 'video' | 'scene' | 'web';
type QueueFilterMode = 'status' | 'type';

function statusFilter(status?: string): QueueStatusFilter {
  if (status === 'completed') return 'completed';
  if (status === 'downloading' || status === 'moving') return 'downloading';
  if (status === 'error') return 'error';
  return 'pending';
}

function wallpaperTypeFilter(task: QueueTask): Exclude<QueueWallpaperTypeFilter, 'all'> | 'other' {
  const type = String(task.workshopType || '').trim().toLowerCase();
  if (type === 'video' || (!type && task.isVideo)) return 'video';
  if (type === 'web') return 'web';
  if (type === 'scene' || !type) return 'scene';
  return 'other';
}

function statusText(status: string | undefined, text: AppText) {
  return (
    {
      pending: text.statusPending,
      downloading: text.statusDownloading,
      moving: text.statusMoving,
      paused: text.statusPaused,
      error: text.statusError,
      completed: text.statusCompleted,
    }[status || ''] || status || '-'
  );
}

export function QueueDialog({
  open,
  onOpenChange,
  fixedPanelHeight,
  queue,
  busyIds,
  onAction,
  onOpenItem,
  onDownloadChoice,
  onPlay,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fixedPanelHeight: boolean;
  queue: QueueTask[];
  busyIds: Set<string>;
  onAction: (action: string, id?: string | number) => void;
  onOpenItem: (id: string | number) => void;
  onDownloadChoice: (task: QueueTask) => void;
  onPlay: (task: QueueTask) => void;
}) {
  const text = useText();
  const reduceMotion = useReducedMotion();
  const [filterMode, setFilterMode] = React.useState<QueueFilterMode>('status');
  const [activeStatusFilter, setActiveStatusFilter] = React.useState<QueueStatusFilter>('all');
  const [activeTypeFilter, setActiveTypeFilter] = React.useState<QueueWallpaperTypeFilter>('all');
  const statusFilterOptions = React.useMemo(() => [
    { value: 'all' as const, label: text.queueFilterAll },
    { value: 'completed' as const, label: text.queueFilterCompleted },
    { value: 'downloading' as const, label: text.queueFilterDownloading },
    { value: 'pending' as const, label: text.queueFilterPending },
    { value: 'error' as const, label: text.queueFilterFailed },
  ].map((option) => ({
    ...option,
    count: option.value === 'all' ? queue.length : queue.filter((task) => statusFilter(task.status) === option.value).length,
  })), [queue, text]);
  const typeFilterOptions = React.useMemo(() => [
    { value: 'all' as const, label: text.queueFilterAll },
    { value: 'video' as const, label: text.queueFilterVideo },
    { value: 'scene' as const, label: text.queueFilterScene },
    { value: 'web' as const, label: text.queueFilterWeb },
  ].map((option) => ({
    ...option,
    count: option.value === 'all' ? queue.length : queue.filter((task) => wallpaperTypeFilter(task) === option.value).length,
  })), [queue, text]);
  const filterOptions = filterMode === 'status' ? statusFilterOptions : typeFilterOptions;
  const activeFilter = filterMode === 'status' ? activeStatusFilter : activeTypeFilter;
  const selectFilter = (value: QueueStatusFilter | QueueWallpaperTypeFilter) => {
    if (filterMode === 'status') setActiveStatusFilter(value as QueueStatusFilter);
    else setActiveTypeFilter(value as QueueWallpaperTypeFilter);
  };
  const filteredQueue = React.useMemo(
    () => {
      if (filterMode === 'status') {
        return activeStatusFilter === 'all' ? queue : queue.filter((task) => statusFilter(task.status) === activeStatusFilter);
      }
      return activeTypeFilter === 'all' ? queue : queue.filter((task) => wallpaperTypeFilter(task) === activeTypeFilter);
    },
    [activeStatusFilter, activeTypeFilter, filterMode, queue],
  );
  const toggleFilterMode = () => setFilterMode((current) => current === 'status' ? 'type' : 'status');
  const dialogTitle = (
    <div className="relative flex w-full min-w-0 flex-col items-start gap-1.5 text-left sm:min-h-9 sm:justify-center">
      <button
        type="button"
        className="shrink-0 select-none rounded-sm text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        aria-label={`${text.queue}. ${text.queueFilterModeSwitch}`}
        onDoubleClick={toggleFilterMode}
        onKeyDown={(event) => {
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          toggleFilterMode();
        }}
      >
        {text.queue}
      </button>
      <div className="w-full self-center sm:absolute sm:left-1/2 sm:top-0 sm:w-auto sm:-translate-x-1/2">
        <AnimatePresence initial={false} mode="wait">
          <motion.div
            key={filterMode}
            className="flex w-full max-w-full flex-wrap justify-center gap-0.5 rounded-lg border border-border bg-input/25 p-0.5 font-normal shadow-sm sm:w-auto sm:flex-nowrap sm:gap-1 sm:p-1"
            role="tablist"
            aria-label={filterMode === 'status' ? text.queueStatusFilter : text.queueTypeFilter}
            initial={reduceMotion ? false : { opacity: 0, y: -3 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 3 }}
            transition={{ duration: reduceMotion ? 0 : 0.14, ease: 'easeOut' }}
          >
            {filterOptions.map((option) => {
              const active = activeFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  tabIndex={active ? 0 : -1}
                  aria-label={`${option.label} (${option.count})`}
                  onClick={() => selectFilter(option.value)}
                  className={cn(
                    'relative isolate inline-flex min-h-7 flex-1 items-center justify-center gap-0.5 rounded-md px-1.5 py-1 text-[11px] font-medium transition-colors sm:min-h-8 sm:flex-none sm:gap-1.5 sm:px-2.5 sm:py-1.5 sm:text-sm',
                    active
                      ? 'text-primary-foreground'
                      : 'text-muted-foreground hover:bg-input/65 hover:text-foreground',
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId={`queue-${filterMode}-filter-indicator`}
                      className="pointer-events-none absolute inset-0 -z-10 rounded-md bg-primary shadow-sm"
                      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 520, damping: 42, mass: 0.72 }}
                    />
                  ) : null}
                  <span className="relative z-10">{option.label}</span>
                  <span className={cn('relative z-10 hidden tabular-nums sm:inline', active ? 'text-primary-foreground/75' : 'text-muted-foreground')}>{option.count}</span>
                </button>
              );
            })}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      fixedHeight={fixedPanelHeight}
      title={dialogTitle}
      titleFullWidth
      closeButtonClassName="max-sm:top-3"
      wide
      footer={
        <>
          <Button variant="outline" onClick={() => onAction('resume_all')}>{text.resumeAll}</Button>
          <Button variant="outline" onClick={() => onAction('pause_all')}>{text.pauseAll}</Button>
          <Button className="col-span-2 sm:col-span-1" variant="outline" onClick={() => onAction('clear_completed')}>{text.clearCompletedFailed}</Button>
        </>
      }
    >
      <AnimatedHeight innerClassName="grid gap-3 px-0.5 py-0.5 sm:gap-3.5">
        <AnimatePresence initial={false} mode="popLayout">
          {!queue.length ? (
            <motion.div
              key="queue-empty"
              layout
              className="grid place-items-center rounded-xl border border-border bg-card p-10 text-muted-foreground"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1], layout: { type: 'spring', stiffness: 360, damping: 36, mass: 0.9 } }}
            >
              {text.queueEmpty}
            </motion.div>
          ) : !filteredQueue.length ? (
            <motion.div
              key="queue-filter-empty"
              layout
              className="grid place-items-center rounded-xl border border-border bg-card p-10 text-muted-foreground"
              initial={{ opacity: 0, scale: 0.97 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.97 }}
              transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1], layout: { type: 'spring', stiffness: 360, damping: 36, mass: 0.9 } }}
            >
              {text.queueFilteredEmpty}
            </motion.div>
          ) : (
            filteredQueue.map((task) => {
            const id = String(task.id || task.cacheKey || '');
            const title = task.title || task.name || id;
            const busy = busyIds.has(id);
            const progress = Math.max(0, Math.min(100, Number(task.progress || 0)));
            const indeterminate = !!task.progressIndeterminate && ['downloading', 'moving'].includes(task.status || '');
            const total = Number(task.total || task.size || 0);
            const downloaded = Number(task.downloaded || (task.status === 'completed' ? total : 0));
            const showStageText = !!task.progressStage && (['downloading', 'moving'].includes(task.status || '') && (indeterminate || task.progressStageMode === 'loading') || !!task.livePaused);
            const sizeText = showStageText
              ? task.progressStage
              : total > 0 ? `${formatBytesText(downloaded, text)} / ${formatBytesText(total, text)}` : downloaded > 0 ? formatBytesText(downloaded, text) : text.sizeUnknown;
            const progressText = indeterminate && !showStageText ? text.waitingProgress : `${progress.toFixed(1)}%`;
            return (
              <motion.div
                layout
                key={`${task.source || 'queue'}:${id}`}
                initial={{ opacity: 0, scale: 0.98 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.72 }}
                transition={{
                  opacity: { duration: 0.22, ease: 'easeOut' },
                  scale: { duration: 0.24, ease: [0.22, 1, 0.36, 1] },
                  layout: { type: 'spring', stiffness: 430, damping: 38, mass: 0.8 },
                }}
                className="cursor-pointer rounded-xl border border-border bg-card p-2 shadow-sm transition-[border-color,box-shadow] duration-300 hover:border-primary/20 hover:shadow-md sm:p-3"
                onClick={() => onOpenItem(id)}
              >
                <div className="grid grid-cols-[96px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-3">
                  <div className="aspect-square w-full overflow-hidden rounded-lg bg-muted">
                    {task.coverUrl ? <img src={task.coverUrl} className="h-full w-full object-cover" alt={title} /> : <div className="grid h-full place-items-center text-xs text-muted-foreground">{text.noCover}</div>}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold sm:text-base">{title}</div>
                        {task.status === 'error' ? <div className="mt-1 text-xs text-destructive">{task.errorMsg}</div> : null}
                      </div>
                      <Badge variant={task.status === 'error' ? 'destructive' : 'secondary'}>{statusText(task.status, text)}</Badge>
                    </div>
                    <Progress className="mt-2" value={progress} indeterminate={indeterminate} />
                    <div className="mt-1.5 flex flex-wrap justify-between gap-2 text-[11px] text-muted-foreground sm:text-xs">
                      <span>{sizeText}{!showStageText && !indeterminate && task.status === 'downloading' && task.speed ? ` · ${formatSpeedText(task.speed, text)}` : ''}</span>
                      <span>{progressText}</span>
                    </div>
                    <div className="mt-2 flex flex-wrap justify-end gap-1.5 sm:gap-2" onClick={(event) => event.stopPropagation()}>
                      {task.status === 'completed' && (task.isVideo || task.canPlay) ? (
                        <Button className="h-7 px-2" size="xs" variant="outline" onClick={() => onPlay(task)}>
                          <Play className="h-3 w-3" />
                          {text.play}
                        </Button>
                      ) : null}
                      {task.status === 'completed' ? (
                        <Button className="h-7 px-2" size="xs" variant="outline" onClick={() => onDownloadChoice(task)}>
                          <Download className="h-3 w-3" />
                          {text.download}
                        </Button>
                      ) : null}
                      {['pending', 'downloading'].includes(task.status || '') ? (
                        <Button className="h-7 px-2" size="xs" variant="outline" onClick={() => onAction('pause', id)}>
                          <Pause className="h-3 w-3" />
                          {text.pause}
                        </Button>
                      ) : null}
                      {['paused', 'error'].includes(task.status || '') ? (
                        <Button className="h-7 px-2" size="xs" variant="outline" onClick={() => onAction('resume', id)}>
                          <Play className="h-3 w-3" />
                          {text.resume}
                        </Button>
                      ) : null}
                      {task.source !== 'cache' && task.status !== 'completed' ? (
                        <>
                          <Button className="h-7 w-7" size="icon-xs" variant="outline" disabled={busy} onClick={() => onAction('up', id)} aria-label={text.moveUp}>
                            <ArrowUp className="h-3 w-3" />
                          </Button>
                          <Button className="h-7 w-7" size="icon-xs" variant="outline" disabled={busy} onClick={() => onAction('down', id)} aria-label={text.moveDown}>
                            <ArrowDown className="h-3 w-3" />
                          </Button>
                        </>
                      ) : null}
                      <Button className="h-7 px-2" size="xs" variant="destructive" onClick={() => onAction(task.source === 'cache' ? 'delete_cache' : 'delete', id)}>
                        <Trash2 className="h-3 w-3" />
                        {text.delete}
                      </Button>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })
          )}
        </AnimatePresence>
      </AnimatedHeight>
    </Dialog>
  );
}
