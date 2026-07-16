'use strict';

function clearLivePauseTimer(task, clearTimeoutFn = clearTimeout) {
  if (!task) return;
  if (task._livePauseTimer) {
    try { clearTimeoutFn(task._livePauseTimer); } catch {}
  }
  delete task._livePauseTimer;
  delete task.livePauseExpiresAt;
}

function tryLivePauseTask(task, controls = {}) {
  if (!task || !task.processPromise || typeof task.processPromise.pause !== 'function') return false;
  try {
    if (!task.processPromise.pause()) return false;
    task.status = 'paused';
    task.livePaused = true;
    delete task._livePauseResumedAt;
    task.speed = 0;
    task.progressIndeterminate = false;
    task.progressStage = '已暂停，SteamKit 下载器进程保持挂起';
    task.progressStageMode = 'loading';
    clearLivePauseTimer(task, controls.clearTimeoutFn || clearTimeout);
    const maxMs = Math.max(1000, Number(controls.livePauseMaxMs || 10 * 60 * 1000));
    const setTimer = controls.setTimeoutFn || setTimeout;
    task.livePauseExpiresAt = Date.now() + maxMs;
    const timer = setTimer(() => {
      if (!task.livePaused) return;
      delete task._livePauseTimer;
      delete task.livePauseExpiresAt;
      task.livePaused = false;
      task.status = 'paused';
      task.speed = 0;
      task.progressIndeterminate = true;
      task.progressStage = '挂起已超过 10 分钟，已释放下载器；继续时将校验本地文件后续传';
      task.progressStageMode = 'loading';
      try { if (task.processPromise && task.processPromise.kill) task.processPromise.kill(); } catch {}
      try { if (task.cancelFn) task.cancelFn(); } catch {}
    }, maxMs);
    task._livePauseTimer = timer;
    if (timer && typeof timer.unref === 'function') timer.unref();
    return true;
  } catch {
    return false;
  }
}

function tryLiveResumeTask(task, controls = {}) {
  if (!task || !task.livePaused || !task.processPromise || typeof task.processPromise.resume !== 'function') return false;
  try {
    if (!task.processPromise.resume()) return false;
    clearLivePauseTimer(task, controls.clearTimeoutFn || clearTimeout);
    task.status = 'downloading';
    task.livePaused = false;
    task._livePauseResumedAt = Date.now();
    task.speed = 0;
    task.progressIndeterminate = false;
    task.progressStage = '已继续，SteamKit 下载器连接保持中';
    task.progressStageMode = 'progress';
    return true;
  } catch {
    return false;
  }
}

function createDownloadsController(deps = {}) {
  const {
    jsonRes,
    readBody,
    sendDownloadFile,
    sendPreparedDownload,
    createPreparedDownload,
    prepareMpkgDownloadFile,
    startMpkgPreparation,
    getMpkgPreparation,
    serializeMpkgPreparation,
    prepareClientDownloadFile,
    findDownloadedItemPath,
    findQueueItemById,
    sendPathAsClientDownload,
    getTaskQueue,
    createWorkshopQueueTask,
    getDownloadQueueService,
    listCachedItems,
    isCacheItemTombstoned,
    handleCachedItemDelete,
    deleteCachedItemFiles,
    getCacheItemsService,
    cleanupTaskFiles,
    cleanupOrphanDepotDownloaderDownloads,
    triggerQueue,
    enforceTopOnlyQueueRunner,
    sleep,
    livePauseMaxMs = 10 * 60 * 1000,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    isDebugEnabled = () => false,
    logger = console,
  } = deps;
  const livePauseControls = { livePauseMaxMs, setTimeoutFn, clearTimeoutFn };

  function debugMpkg(message) {
    try {
      if (!isDebugEnabled()) return;
    } catch {
      return;
    }
    logger.log(`[MPKG] Debug ${message}`);
  }

  function normalizeMpkgId(value) {
    return String(value || '').replace(/[^\d]/g, '');
  }

  function normalizeMpkgTextureProfile(value) {
    return String(value || '').trim().toLowerCase() === 'compact' ? 'compact' : 'fast';
  }

  function mpkgDownloadUrl(id, title, textureProfile = 'fast') {
    const params = new URLSearchParams({
      id: normalizeMpkgId(id),
      title: String(title || `Wallpaper ${normalizeMpkgId(id)}`),
      profile: normalizeMpkgTextureProfile(textureProfile),
    });
    return `/api/mpkg/download?${params.toString()}`;
  }

  function publicMpkgPreparation(job, fallbackId, title, textureProfile = 'fast') {
    const snapshot = typeof serializeMpkgPreparation === 'function' ? serializeMpkgPreparation(job) : job;
    if (!snapshot) return null;
    const status = String(snapshot.status || 'error');
    const result = {
      success: status !== 'error',
      id: normalizeMpkgId(snapshot.id || fallbackId),
      status,
    };
    if (status === 'preparing') {
      const elapsedMs = Number(snapshot.elapsedMs);
      if (Number.isFinite(elapsedMs) && elapsedMs >= 0) result.elapsedMs = Math.floor(elapsedMs);
    } else if (status === 'ready') {
      result.fileName = String(snapshot.fileName || job && job.fileName || '');
      const readyFilePath = String(job && job.filePath || '');
      if (readyFilePath && result.fileName && typeof createPreparedDownload === 'function') {
        try {
          const preparedToken = createPreparedDownload(readyFilePath, result.fileName, { deleteAfterSend: false });
          result.downloadUrl = `/api/mpkg/download?token=${encodeURIComponent(preparedToken)}`;
          debugMpkg(`ready handoff prepared item=${result.id || '-'} filename=${result.fileName}`);
        } catch {
          result.downloadUrl = mpkgDownloadUrl(result.id, title, textureProfile);
          debugMpkg(`ready handoff fell back to direct item=${result.id || '-'}`);
        }
      } else {
        result.downloadUrl = mpkgDownloadUrl(result.id, title, textureProfile);
      }
    } else if (status === 'error') {
      result.error = String(snapshot.error || 'MPKG 准备失败');
      result.code = String(snapshot.code || '');
      result.requiresSteamLogin = !!snapshot.requiresSteamLogin;
      result.requiresSteamGuard = !!snapshot.requiresSteamGuard;
    }
    return result;
  }

  function respondMpkgPreparation(res, job, id, title, textureProfile = 'fast') {
    const payload = publicMpkgPreparation(job, id, title, textureProfile);
    if (!payload) return jsonRes(res, 404, { error: '未找到 MPKG 准备任务', code: 'MPKG_PREPARATION_NOT_FOUND' });
    if (payload.status === 'preparing') return jsonRes(res, 202, payload);
    if (payload.status === 'ready') return jsonRes(res, 200, payload);
    const statusCode = Math.max(400, Number(job && job.statusCode) || 500);
    return jsonRes(res, statusCode, payload);
  }

  function handleMpkgPreparationStart(_req, res, id, title, textureProfile = 'fast') {
    const wantId = normalizeMpkgId(id);
    if (!wantId) return jsonRes(res, 400, { error: 'Invalid id' });
    if (typeof startMpkgPreparation !== 'function') {
      return jsonRes(res, 503, { error: 'MPKG preparation is unavailable', code: 'MPKG_PREPARATION_UNAVAILABLE' });
    }
    try {
      const profile = normalizeMpkgTextureProfile(textureProfile);
      const job = startMpkgPreparation(wantId, title, profile);
      debugMpkg(`async preparation started item=${wantId} profile=${profile} status=${job && job.status || 'unknown'}`);
      return respondMpkgPreparation(res, job, wantId, title, profile);
    } catch (error) {
      return jsonRes(res, error.statusCode || 500, {
        error: error.message || 'MPKG 准备失败',
        code: error.code || '',
        requiresSteamLogin: !!error.requiresSteamLogin,
        requiresSteamGuard: !!error.requiresSteamGuard,
      });
    }
  }

  function handleMpkgPreparationStatus(_req, res, id, title, textureProfile = 'fast') {
    const wantId = normalizeMpkgId(id);
    if (!wantId) return jsonRes(res, 400, { error: 'Invalid id' });
    if (typeof getMpkgPreparation !== 'function') {
      return jsonRes(res, 503, { error: 'MPKG preparation is unavailable', code: 'MPKG_PREPARATION_UNAVAILABLE' });
    }
    const profile = normalizeMpkgTextureProfile(textureProfile);
    return respondMpkgPreparation(res, getMpkgPreparation(wantId, profile), wantId, title, profile);
  }

  function taskQueue() {
    return getTaskQueue ? getTaskQueue() : [];
  }

  async function handlePreparedDownload(req, res, prepareFn, id, title, probePath) {
    const q = new URL(req.url, 'http://x').searchParams;
    const token = q.get('token');
    const isMpkg = probePath === '/api/mpkg/download';
    const onDebug = isMpkg ? message => debugMpkg(message) : undefined;
    const requestStartedAt = Date.now();
    if (token) {
      if (isMpkg) debugMpkg('request phase=prepared-token');
      return sendPreparedDownload(req, res, token, { onDebug });
    }
    if (isMpkg) debugMpkg(`request phase=${q.get('probe') === '1' ? 'probe' : 'direct'} id=${String(id || '').replace(/[^\d]/g, '') || '-'}`);
    try {
      const prepared = await prepareFn(id, title);
      if (isMpkg) debugMpkg(`prepared file id=${String(id || '').replace(/[^\d]/g, '') || '-'} filename=${prepared.fileName || '-'} elapsedMs=${Date.now() - requestStartedAt}`);
      if (q.get('probe') === '1') {
        const preparedToken = createPreparedDownload(prepared.filePath, prepared.fileName, { deleteAfterSend: prepared.deleteAfterSend });
        if (isMpkg) debugMpkg(`probe response prepared filename=${prepared.fileName || '-'} elapsedMs=${Date.now() - requestStartedAt}`);
        return jsonRes(res, 200, {
          success: true,
          downloadUrl: `${probePath}?token=${encodeURIComponent(preparedToken)}`,
          filename: prepared.fileName
        });
      }
      if (isMpkg) debugMpkg(`stream handoff filename=${prepared.fileName || '-'} elapsedMs=${Date.now() - requestStartedAt}`);
      return sendDownloadFile(req, res, prepared.filePath, prepared.fileName, { deleteAfterSend: prepared.deleteAfterSend, onDebug });
    } catch (e) {
      if (isMpkg) debugMpkg(`request failed phase=${q.get('probe') === '1' ? 'probe' : 'direct'} elapsedMs=${Date.now() - requestStartedAt} error=${String(e && e.message || e || 'unknown')}`);
      return jsonRes(res, e.statusCode || 500, {
        error: e.message || 'Download failed',
        code: e.code || '',
        requiresSteamLogin: !!e.requiresSteamLogin,
        requiresSteamGuard: !!e.requiresSteamGuard
      });
    }
  }

  async function handleMpkgDownload(req, res, id, title) {
    const textureProfile = normalizeMpkgTextureProfile(new URL(req.url, 'http://x').searchParams.get('profile'));
    return handlePreparedDownload(
      req,
      res,
      (itemId, itemTitle) => prepareMpkgDownloadFile(itemId, itemTitle, textureProfile),
      id,
      title,
      '/api/mpkg/download',
    );
  }

  async function handleClientDownload(req, res, id, title) {
    return handlePreparedDownload(req, res, prepareClientDownloadFile, id, title, '/api/download');
  }

  async function handleQueueItemDownload(req, res, id) {
    const wantId = parseInt(id);
    if (!wantId) return jsonRes(res, 400, { error: 'Invalid id' });
    const sourcePath = findDownloadedItemPath(wantId);
    const task = findQueueItemById(wantId);
    return sendPathAsClientDownload(req, res, sourcePath, task && task.title, wantId);
  }

  async function handleDownload(res, id, title) {
    const wantId = parseInt(id);
    if (!wantId) return jsonRes(res, 400, { error: 'Invalid id' });

    if (taskQueue().some(t => t.id === wantId)) {
      return jsonRes(res, 200, { success: true, message: '已在下载队列中' });
    }

    try {
      await createWorkshopQueueTask(wantId, title);
    } catch (e) {
      return jsonRes(res, e.statusCode || 500, {
        error: e.message,
        code: e.code || '',
        requiresSteamLogin: !!e.requiresSteamLogin,
        requiresSteamGuard: !!e.requiresSteamGuard
      });
    }

    return jsonRes(res, 200, { success: true, message: '已加入下载队列，请在队列面板查看进度' });
  }

  async function listQueueItems() {
    const queue = taskQueue();
    // Keep high-frequency queue polling independent from filesystem-backed
    // library enumeration. The client refreshes cached items separately when
    // the queue opens or a download/cache action changes the library.
    return queue.map(task => getDownloadQueueService().sanitizeTaskForList(task));
  }

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
          if (!tryLivePauseTask(task, livePauseControls)) {
            unsupported += 1;
          }
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

  return {
    handlePreparedDownload,
    handleMpkgDownload,
    handleMpkgPreparationStart,
    handleMpkgPreparationStatus,
    handleClientDownload,
    handleQueueItemDownload,
    handleDownload,
    listQueueItems,
    handleQueueAction,
  };
}

module.exports = {
  createDownloadsController,
};
