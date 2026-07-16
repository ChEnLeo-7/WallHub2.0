'use strict';

const fs = require('fs');
const path = require('path');

function createDownloadQueueService(deps = {}) {
  const tasks = [];
  const creatingTasks = new Map();
  const getMaxConcurrentDownloads = deps.getMaxConcurrentDownloads;
  const getFileDetails = deps.getFileDetails;
  const safeName = deps.safeName;
  const detectVideoTag = deps.detectVideoTag;
  const workshopTypeFromDetails = deps.workshopTypeFromDetails;
  const downloadWorkshopItem = deps.downloadWorkshopItem;
  const dirSizeRecursive = deps.dirSizeRecursive;
  const findCachedItemDir = deps.findCachedItemDir;
  const isVideoExt = deps.isVideoExt;
  const findFirstVideoInDir = deps.findFirstVideoInDir;
  const cleanupTaskFiles = deps.cleanupTaskFiles || (() => {});
  const onTaskCompleted = deps.onTaskCompleted || (() => {});
  const logger = deps.logger || console;

  function findById(id) {
    return tasks.find(task => String(task.id) === String(id));
  }

  async function createTask(id, title, options = {}) {
    const wantId = parseInt(id);
    if (!wantId) {
      const error = new Error('Invalid id');
      error.statusCode = 400;
      throw error;
    }

    const existing = findById(wantId);
    if (existing) return existing;
    const creating = creatingTasks.get(String(wantId));
    if (creating) return creating;

    const promise = createTaskInternal(wantId, title, options)
      .finally(() => { creatingTasks.delete(String(wantId)); });
    creatingTasks.set(String(wantId), promise);
    return promise;
  }

  async function createTaskInternal(wantId, title, options = {}) {
    const existing = findById(wantId);
    if (existing) return existing;

    let detail = null;
    try {
      const list = await getFileDetails([String(wantId)]);
      detail = list[0] && list[0].result === 1 ? list[0] : null;
    } catch (error) {
      const wrapped = new Error(`Steam detail error: ${error.message}`);
      wrapped.statusCode = 502;
      throw wrapped;
    }
    const createdWhileLoading = findById(wantId);
    if (createdWhileLoading) return createdWhileLoading;
    if (!detail) {
      const error = new Error('壁纸不存在或不可见');
      error.statusCode = 404;
      throw error;
    }

    const appId = parseInt(detail.consumer_appid || detail.consumer_app_id || detail.appid || 431960) || 431960;
    const itemTitle = safeName(title || detail.title || `Wallpaper ${wantId}`) || `Wallpaper ${wantId}`;
    const task = {
      id: wantId,
      appId,
      title: itemTitle,
      isVideo: Object.prototype.hasOwnProperty.call(options, 'isVideo') ? !!options.isVideo : detectVideoTag(detail),
      workshopType: workshopTypeFromDetails(detail),
      videoOnly: !!options.videoOnly,
      sourceUrl: '',
      status: 'pending',
      progress: 0,
      speed: 0,
      downloaded: 0,
      total: parseInt(detail.file_size) || 0,
      errorMsg: '',
      errorCode: '',
      requiresSteamLogin: false,
      requiresSteamGuard: false,
      addTime: Date.now(),
      coverUrl: String(detail.preview_url || '')
    };
    tasks.push(task);
    trigger();
    return task;
  }

  function sanitizeTaskForList(task) {
    const item = Object.assign({ source: 'queue', canPlay: !!task.isVideo && task.status === 'completed' }, task);
    delete item._stdoutProgressLastAt;
    delete item._stdoutProgressLastBytes;
    delete item._speedProgressLastBytes;
    delete item._speedSamples;
    delete item._smoothedSpeed;
    delete item._processOutput;
    delete item._runnerActive;
    delete item._depotIdleTimeout;
    delete item._resumeSeedSource;
    delete item._livePauseTimer;
    delete item.processPromise;
    delete item.cancelFn;
    return item;
  }

  function activeDownloadCount() {
    return tasks.filter(task => task.status === 'downloading' || task.livePaused).length;
  }

  async function runTask(task) {
    if (!task || task._runnerActive || task.processPromise || task.status === 'downloading') return;
    task._runnerActive = true;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    task.cancelFn = () => {
      if (controller && !controller.signal.aborted) controller.abort();
    };
    task.status = 'downloading';
    task.errorMsg = '';
    task.errorCode = '';
    task.requiresSteamLogin = false;
    task.requiresSteamGuard = false;
    task.progressIndeterminate = false;
    task.progressStage = '';
    task.progressStageMode = '';
    task._stdoutProgressLastAt = 0;
    task._stdoutProgressLastBytes = 0;

    try {
      task.progressIndeterminate = true;
      task.progressStage = '等待下载器返回真实进度';
      task.progressStageMode = 'loading';
      const downloaded = await downloadWorkshopItem(task.id, task.appId, task.title, {
        videoOnly: !!task.videoOnly,
        task,
        forceSharedDir: true,
        signal: controller ? controller.signal : undefined
      });
      task.outputPath = downloaded && (downloaded.itemDir || downloaded.filePath || task.outputPath || '');
      if (task.status === 'paused') {
        return;
      }
      if (task.status === 'cancelled' || (controller && controller.signal.aborted)) {
        try { cleanupTaskFiles(task); } catch {}
        return;
      }
      task.progress = 100;
      if (task.total > 0) task.downloaded = task.total;
      task.status = 'moving';

      if (downloaded.kind === 'file') {
        task.outputPath = task.videoOnly ? downloaded.filePath : (downloaded.itemDir || downloaded.filePath);
        const finalSizeRoot = downloaded.itemDir || downloaded.filePath;
        try {
          const finalSize = fs.existsSync(finalSizeRoot) && fs.statSync(finalSizeRoot).isDirectory()
            ? dirSizeRecursive(finalSizeRoot)
            : (fs.existsSync(finalSizeRoot) ? fs.statSync(finalSizeRoot).size : 0);
          if (finalSize > 0) {
            task.total = finalSize;
            task.downloaded = finalSize;
          }
        } catch {}
        if (!downloaded.useSharedDir && downloaded.tempRoot) {
          try { await fs.promises.rm(downloaded.tempRoot, { recursive: true, force: true }); } catch {}
        }
      }

      if (task.status === 'moving' || task.status === 'transferring' || task.status === 'downloading') {
        if (controller && controller.signal.aborted) {
          try { cleanupTaskFiles(task); } catch {}
          return;
        }
        task.status = 'completed';
        task.progress = 100;
        task.progressIndeterminate = false;
        task.progressStage = '';
        task.progressStageMode = '';
        if (task.total > 0) task.downloaded = task.total;
        try { onTaskCompleted(task); } catch (error) { logger.warn('[Queue] Failed to refresh cached-item index:', error.message); }
      }
    } catch (error) {
      const controlledCancellation = (
        (task.status === 'paused' || task.status === 'cancelled' || task.status === 'pending') &&
        ((controller && controller.signal.aborted) || error.code === 'CANCELLED')
      );
      if (controlledCancellation) {
        task.speed = 0;
        if (task.status !== 'pending' && task.status !== 'paused') task.progressIndeterminate = false;
      } else {
        task.status = 'error';
        task.errorMsg = error.message;
        task.errorCode = error.code || '';
        task.requiresSteamLogin = !!error.requiresSteamLogin;
        task.requiresSteamGuard = !!error.requiresSteamGuard;
        task.speed = 0;
        task.progressIndeterminate = false;
        task.progressStageMode = '';
      }
    } finally {
      task._runnerActive = false;
      task.processPromise = null;
      task.cancelFn = null;
      trigger();
    }
  }

  function trigger() {
    const slots = Math.max(0, getMaxConcurrentDownloads() - activeDownloadCount());
    if (slots <= 0) return;
    const nextTasks = tasks.filter(task => task.status === 'pending').slice(0, slots);
    for (const task of nextTasks) runTask(task);
  }

  function enforceTopOnlyRunner() {
    const maxRunning = getMaxConcurrentDownloads();
    let runnableSeen = 0;
    let changed = false;
    for (const task of tasks) {
      if (task.status === 'completed' || task.status === 'cancelled') continue;
      runnableSeen += 1;
      if (runnableSeen <= maxRunning) {
        if (task.status === 'paused' || task.status === 'error') {
          task.status = 'pending';
          task.speed = 0;
          changed = true;
        }
        continue;
      }
      if (task.status === 'downloading' && runnableSeen > maxRunning) {
        task.status = 'paused';
        task.speed = 0;
        if (task.processPromise && task.processPromise.kill) task.processPromise.kill();
        if (task.cancelFn) task.cancelFn();
        changed = true;
      }
    }
    if (changed) trigger();
  }

  function findDownloadedPath(id) {
    const sid = String(id || '').replace(/[^\d]/g, '');
    if (!sid) return null;
    const task = findById(sid);
    if (task && task.outputPath && fs.existsSync(task.outputPath)) return task.outputPath;
    const cached = findCachedItemDir(sid);
    if (cached) return cached;
    return null;
  }

  function findCachedVideoById(id, videoTaskMap, workshopCacheDir) {
    const sid = String(id);
    const fromMap = videoTaskMap && videoTaskMap.get(sid);
    if (fromMap && fs.existsSync(fromMap)) return fromMap;
    const task = tasks.find(item => String(item.id) === sid && item.status === 'completed' && item.outputPath);
    if (task && fs.existsSync(task.outputPath)) {
      const st = fs.statSync(task.outputPath);
      if (st.isFile() && isVideoExt(path.extname(task.outputPath))) return task.outputPath;
      if (st.isDirectory()) {
        const video = findFirstVideoInDir(task.outputPath);
        if (video) return video;
      }
    }
    const itemDir = path.join(workshopCacheDir, sid);
    const video = findFirstVideoInDir(itemDir);
    if (video) return video;
    return null;
  }

  function removeByPredicate(predicate) {
    let removed = 0;
    for (let index = tasks.length - 1; index >= 0; index--) {
      if (!predicate(tasks[index], index)) continue;
      tasks.splice(index, 1);
      removed++;
    }
    return removed;
  }

  return {
    tasks,
    findById,
    createTask,
    sanitizeTaskForList,
    runTask,
    trigger,
    enforceTopOnlyRunner,
    findDownloadedPath,
    findCachedVideoById,
    removeByPredicate,
  };
}

module.exports = {
  createDownloadQueueService,
};
