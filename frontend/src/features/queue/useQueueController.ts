import * as React from 'react';
import { getCachedItems, getQueue, queueAction, type QueueTask } from '@/lib/api';
import type { AppText } from '@/lib/text';
import { isSteamLoginError, queueSignature } from '@/lib/workshop';
import { filterQueueTasksAfterDelete, type QueueDeleteTombstone } from '@/lib/queueTombstones.mjs';

type Toast = (message: string, type?: 'info' | 'ok' | 'warn', timeoutMs?: number) => number;

type UseQueueControllerOptions = {
  pageVisible: boolean;
  text: AppText;
  toast: Toast;
  requestLogin: (errorLike?: unknown, force?: boolean) => boolean;
  onLoginTask: (taskId: string) => void;
};

function mergeQueueItems(tasks: QueueTask[], cachedItems: QueueTask[]) {
  const taskIds = new Set(tasks.map((task) => String(task.id || task.cacheKey || '')));
  return tasks.concat(cachedItems.filter((item) => !taskIds.has(String(item.id || item.cacheKey || ''))));
}

export function useQueueController({
  pageVisible,
  text,
  toast,
  requestLogin,
  onLoginTask,
}: UseQueueControllerOptions) {
  const [queue, setQueue] = React.useState<QueueTask[]>([]);
  const [queueOpen, setQueueOpen] = React.useState(false);
  const [queueBusyIds, setQueueBusyIds] = React.useState<Set<string>>(() => new Set());
  const queueOptimisticRef = React.useRef<{ until: number; ids: string[] } | null>(null);
  const queueDeleteTombstonesRef = React.useRef(new Map<string, QueueDeleteTombstone>());
  const queueRefreshRequestRef = React.useRef(0);
  const queueRefreshInFlightRef = React.useRef<Promise<void> | null>(null);
  const queueRefreshPendingRef = React.useRef(false);
  const cachedItemsRefreshRef = React.useRef<Promise<void> | null>(null);
  const cachedItemsRefreshPendingRef = React.useRef(false);
  const cachedQueueItemsRef = React.useRef<QueueTask[]>([]);
  const queueStatusRef = React.useRef(new Map<string, string>());
  const queueCompletionNotificationReadyRef = React.useRef(false);
  const activeTasks = queue.filter((task) => ['pending', 'downloading', 'moving'].includes(task.status || '')).length;

  const refreshCachedItems = React.useCallback(() => {
    if (cachedItemsRefreshRef.current) {
      cachedItemsRefreshPendingRef.current = true;
      return cachedItemsRefreshRef.current;
    }
    const request = getCachedItems()
      .then((data) => {
        const cached = filterQueueTasksAfterDelete(data.items || [], queueDeleteTombstonesRef.current);
        cachedQueueItemsRef.current = cached;
        setQueue((current) => {
          const queueTasks = current.filter((item) => item.source !== 'cache');
          const nextItems = mergeQueueItems(queueTasks, cached);
          return queueSignature(current) === queueSignature(nextItems) ? current : nextItems;
        });
      })
      .catch((error) => {
        console.warn('[cache-items]', error);
      })
      .finally(() => {
        if (cachedItemsRefreshRef.current !== request) return;
        cachedItemsRefreshRef.current = null;
        if (cachedItemsRefreshPendingRef.current) {
          cachedItemsRefreshPendingRef.current = false;
          void refreshCachedItems();
        }
      });
    cachedItemsRefreshRef.current = request;
    return request;
  }, []);

  const refreshQueue = React.useCallback(() => {
    if (queueRefreshInFlightRef.current) {
      queueRefreshPendingRef.current = true;
      return queueRefreshInFlightRef.current;
    }
    const requestId = ++queueRefreshRequestRef.current;
    const request = getQueue()
      .then((data) => {
        if (requestId !== queueRefreshRequestRef.current) return;
        const nextTasks = filterQueueTasksAfterDelete(
          data.tasks || [],
          queueDeleteTombstonesRef.current,
        );
        const previousStatuses = queueStatusRef.current;
        const nextStatuses = new Map(nextTasks.map((task) => [String(task.id || task.cacheKey || ''), String(task.status || '')]));
        queueStatusRef.current = nextStatuses;
        const completedTasks = nextTasks.filter((task) => {
          const id = String(task.id || task.cacheKey || '');
          return task.status === 'completed' && previousStatuses.get(id) !== 'completed';
        });
        if (completedTasks.length) {
          void refreshCachedItems();
          if (queueCompletionNotificationReadyRef.current) {
            completedTasks.forEach((task) => {
              const title = String(task.title || task.name || text.untitledWallpaper);
              toast(text.downloadCompleted.replace('{title}', title), 'ok', 2600);
            });
          }
        }
        queueCompletionNotificationReadyRef.current = true;
        const nextItems = filterQueueTasksAfterDelete(
          mergeQueueItems(nextTasks, cachedQueueItemsRef.current),
          queueDeleteTombstonesRef.current,
        );
        const optimistic = queueOptimisticRef.current;
        const nextIds = nextItems.map((task) => String(task.id || task.cacheKey || ''));
        if (optimistic && Date.now() < optimistic.until && JSON.stringify(nextIds) !== JSON.stringify(optimistic.ids)) {
          setQueue((current) => {
            const nextById = new Map(nextItems.map((task) => [String(task.id || task.cacheKey || ''), task]));
            const merged = current.map((task) => {
              const taskId = String(task.id || task.cacheKey || '');
              return { ...task, ...(nextById.get(taskId) || {}) };
            });
            const currentIds = new Set(current.map((task) => String(task.id || task.cacheKey || '')));
            return merged.concat(nextItems.filter((task) => !currentIds.has(String(task.id || task.cacheKey || ''))));
          });
        } else {
          queueOptimisticRef.current = null;
          setQueue((current) => (queueSignature(current) === queueSignature(nextItems) ? current : nextItems));
        }
        const loginTask = nextTasks.find((task) => task.status === 'error' && isSteamLoginError(task));
        if (loginTask) {
          const loginTaskId = String(loginTask.id || loginTask.cacheKey || '');
          onLoginTask(loginTaskId);
          requestLogin(loginTask, false);
        }
      })
      .catch((error) => {
        console.warn('[queue]', error);
      })
      .finally(() => {
        if (queueRefreshInFlightRef.current !== request) return;
        queueRefreshInFlightRef.current = null;
        if (queueRefreshPendingRef.current) {
          queueRefreshPendingRef.current = false;
          void refreshQueue();
        }
      });
    queueRefreshInFlightRef.current = request;
    return request;
  }, [onLoginTask, refreshCachedItems, requestLogin, text.downloadCompleted, text.untitledWallpaper, toast]);

  React.useEffect(() => {
    if (!pageVisible) return;
    if (!queueOpen && !activeTasks) return;
    refreshQueue();
    const timer = window.setInterval(refreshQueue, activeTasks ? 1000 : 10000);
    return () => window.clearInterval(timer);
  }, [activeTasks, pageVisible, queueOpen, refreshQueue]);

  React.useEffect(() => {
    if (queueOpen) void refreshCachedItems();
  }, [queueOpen, refreshCachedItems]);

  const openQueue = React.useCallback(() => {
    setQueueOpen(true);
    refreshQueue();
    refreshCachedItems();
  }, [refreshCachedItems, refreshQueue]);

  const doQueueAction = React.useCallback(async (action: string, id?: string | number) => {
    const snapshot = queue;
    const idText = id == null ? '' : String(id);
    const applyQueueChange = (current: QueueTask[]) => {
      if (!idText) return current;
      const index = current.findIndex((task) => String(task.id || task.cacheKey || '') === idText);
      if (index < 0) return current;
      if (action === 'delete' || action === 'delete_cache') return current.filter((_, itemIndex) => itemIndex !== index);
      if (action === 'up' && index > 0) {
        const next = current.slice();
        [next[index - 1], next[index]] = [next[index], next[index - 1]];
        return next;
      }
      if (action === 'down' && index < current.length - 1) {
        const next = current.slice();
        [next[index], next[index + 1]] = [next[index + 1], next[index]];
        return next;
      }
      if (action === 'pause') return current.map((task, itemIndex) => (itemIndex === index ? { ...task, status: 'paused' } : task));
      if (action === 'resume') return current.map((task, itemIndex) => (itemIndex === index ? { ...task, status: 'pending' } : task));
      return current;
    };

    if ((action === 'delete' || action === 'delete_cache') && idText) {
      const deletedAt = Date.now();
      queueDeleteTombstonesRef.current.set(idText, { deletedAt, expiresAt: deletedAt + 15000 });
    }

    if (['delete', 'delete_cache', 'up', 'down', 'pause', 'resume'].includes(action)) {
      setQueue((current) => applyQueueChange(current));
      if (idText) {
        setQueueBusyIds((current) => new Set(current).add(idText));
        window.setTimeout(() => {
          setQueueBusyIds((current) => {
            const next = new Set(current);
            next.delete(idText);
            return next;
          });
        }, 380);
      }
    }

    if (['up', 'down'].includes(action)) {
      const optimisticIds = applyQueueChange(queue).map((task) => String(task.id || task.cacheKey || ''));
      queueOptimisticRef.current = { until: Date.now() + 1200, ids: optimisticIds };
    }

    try {
      await queueAction(action, id);
      if (action === 'delete' || action === 'delete_cache') toast(text.deleted, 'ok');
      queueOptimisticRef.current = null;
      if (['delete', 'delete_cache', 'clear_completed'].includes(action)) await refreshCachedItems();
      refreshQueue();
    } catch (error) {
      queueOptimisticRef.current = null;
      if ((action === 'delete' || action === 'delete_cache') && idText) {
        queueDeleteTombstonesRef.current.delete(idText);
      }
      setQueue(snapshot);
      toast(error instanceof Error ? error.message : String(error), 'warn');
      refreshQueue();
    }
  }, [queue, refreshCachedItems, refreshQueue, text.deleted, toast]);

  return {
    queue,
    queueOpen,
    setQueueOpen,
    queueBusyIds,
    activeTasks,
    refreshQueue,
    refreshCachedItems,
    openQueue,
    doQueueAction,
  };
}
