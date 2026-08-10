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

module.exports = {
  clearLivePauseTimer,
  tryLivePauseTask,
  tryLiveResumeTask,
};
