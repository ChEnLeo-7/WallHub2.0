import { AnimatePresence, motion } from 'motion/react';
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
  formatBytesText,
  formatSpeedText,
} from '@/lib/utils';
import { type QueueTask } from '@/lib/api';

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
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      fixedHeight={fixedPanelHeight}
      title={text.queue}
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
          ) : (
            queue.map((task) => {
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
