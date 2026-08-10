'use strict';

const {
  clearLivePauseTimer,
  tryLivePauseTask,
  tryLiveResumeTask,
} = require('./livePauseResume');

function createQueueActions(deps = {}) {
  const {
    jsonRes,
    readBody,
    taskQueue,
    listCachedItems,
    handleCachedItemDelete,
    deleteCachedItemFiles,
    cleanupTaskFiles,
    cleanupOrphanDepotDownloaderDownloads,
    getCacheItemsService,
    triggerQueue,
    enforceTopOnlyQueueRunner,
    sleep,
    livePauseControls,
    clearTimeoutFn,
    logger,
  } = deps;

  async function handleQueueAction(req, res) {
    const { action, id } = JSON.parse(await readBody(req));
    const queue = taskQueue();
    if (action === 'clear_completed') {
      for (let i = queue.length - 1; i >= 0; i--) {
        const task = queue[i];
        if (task.status === 'completed' || task.status === 'error') {
          try { cleanupTaskFiles(task); }
          catch (e) { logger.error('[Cleanup] 清理完成/失败任务文件失败:', e); }
          queue.splice(i, 1);
        }
      }
      const queuedIds = new Set(queue.map(task => String(task.id)));
      for (const item of await listCachedItems()) {
        if (!queuedIds.has(String(item.id))) {
          try { deleteCachedItemFiles(item.cacheKey || item.id); }
          catch (e) { logger.error('[Cleanup] 清理缓存项目失败:', e); }
        }
      }
      cleanupOrphanDepotDownloaderDownloads(431960, queuedIds);
      return jsonRes(res, 200, { success: true });
    }

    if (action === 'pause_all') {
      let unsupported = 0;
      for (const task of queue) {
        if (task.status === 'downloading') {
          if (!tryLivePauseTask(task, livePauseControls)) unsupported += 1;
        } else if (task.status === 'pending') {
          task.status = 'paused';
        }
      }
      if (unsupported > 0) return jsonRes(res, 409, { success: false, error: '当前下载器进程不支持保持连接暂停，请稍后重试或取消任务。', code: 'LIVE_PAUSE_UNSUPPORTED' });
      return jsonRes(res, 200, { success: true });
    }

    if (action === 'resume_all') {
      let needsTrigger = false;
      for (const task of queue) {
        if (task.livePaused) {
          if (!tryLiveResumeTask(task, livePauseControls)) {
            task.status = 'pending';
            task.livePaused = false;
            needsTrigger = true;
          }
        } else if (task.status === 'paused' || task.status === 'error') {
          task.status = 'pending';
          needsTrigger = true;
        }
      }
      if (needsTrigger) triggerQueue();
      return jsonRes(res, 200, { success: true });
    }

    if (action === 'delete_cache') {
      const key = String(id || '').replace(/[^\d]/g, '');
      if (!key) return jsonRes(res, 400, { error: 'Invalid key' });
      return handleCachedItemDelete(res, key);
    }

    const idx = queue.findIndex(task => String(task.id) === String(id));
    if (idx === -1) return jsonRes(res, 404, { error: '未找到任务' });
    const task = queue[idx];

    if (action === 'pause' && task.status === 'downloading') {
      if (!tryLivePauseTask(task, livePauseControls)) {
        return jsonRes(res, 409, { success: false, error: '当前下载器进程不支持保持连接暂停，请稍后重试或取消任务。', code: 'LIVE_PAUSE_UNSUPPORTED' });
      }
    } else if (action === 'pause' && task.status === 'pending') {
      task.status = 'paused';
    } else if (action === 'resume' && task.livePaused) {
      if (!tryLiveResumeTask(task, livePauseControls)) {
        return jsonRes(res, 409, { success: false, error: '当前下载器进程无法恢复保持连接暂停，请取消后重新下载。', code: 'LIVE_RESUME_UNSUPPORTED' });
      }
    } else if (action === 'resume' && (task.status === 'paused' || task.status === 'error')) {
      task.status = 'pending';
      triggerQueue();
    } else if (action === 'cancel' || action === 'delete') {
      queue.splice(idx, 1);
      clearLivePauseTimer(task, clearTimeoutFn);
      if (task.status === 'downloading' || task.livePaused || task.processPromise) {
        task.status = 'cancelled';
        task.livePaused = false;
        if (task.processPromise && task.processPromise.kill) task.processPromise.kill();
        if (task.cancelFn) task.cancelFn();
        await sleep(900);
      }
      try {
        cleanupTaskFiles(task);
        getCacheItemsService().cachedItemMeta.delete(String(task.id));
      } catch (e) {
        logger.error('[Cleanup] 删除任务时清理残留文件失败:', e);
      }
      triggerQueue();
    } else if (action === 'up' && idx > 0) {
      [queue[idx - 1], queue[idx]] = [queue[idx], queue[idx - 1]];
      enforceTopOnlyQueueRunner();
    } else if (action === 'down' && idx < queue.length - 1) {
      [queue[idx], queue[idx + 1]] = [queue[idx + 1], queue[idx]];
      enforceTopOnlyQueueRunner();
    }
    return jsonRes(res, 200, { success: true });
  }

  return { handleQueueAction };
}

module.exports = { createQueueActions };
