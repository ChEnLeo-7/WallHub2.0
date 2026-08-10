'use strict';

const fs = require('fs');
const path = require('path');

function notifyPreparationStage(options, stage) {
  try {
    if (typeof options?.onStageChange === 'function') options.onStageChange(stage);
  } catch {}
}

function createMpkgSourcePreparation(options = {}) {
  const findDownloadedItemPath = options.findDownloadedItemPath;
  const createWorkshopQueueTask = options.createWorkshopQueueTask;
  const sleep = options.sleep;

  async function ensureDownloadedItem(id, title, options = {}) {
    const existing = findDownloadedItemPath(id);
    if (existing && fs.existsSync(existing)) {
      const dir = fs.statSync(existing).isDirectory() ? existing : path.dirname(existing);
      notifyPreparationStage(options, 'converting');
      return { itemDir: dir, title: title || `Wallpaper ${id}` };
    }
    const task = await createWorkshopQueueTask(id, title, { isVideo: false, videoOnly: false });
    notifyPreparationStage(options, 'downloading');
    const startedAt = Date.now();
    while (true) {
      const sourcePath = findDownloadedItemPath(id);
      if (sourcePath && fs.existsSync(sourcePath)) {
        const dir = fs.statSync(sourcePath).isDirectory() ? sourcePath : path.dirname(sourcePath);
        notifyPreparationStage(options, 'converting');
        return { itemDir: dir, title: task.title || title || `Wallpaper ${id}` };
      }
      if (task.status === 'error') {
        const error = new Error(task.errorMsg || 'Download failed before MPKG conversion');
        error.statusCode = task.requiresSteamLogin || task.requiresSteamGuard ? 401 : 500;
        error.code = task.errorCode || '';
        error.requiresSteamLogin = !!task.requiresSteamLogin;
        error.requiresSteamGuard = !!task.requiresSteamGuard;
        throw error;
      }
      if (task.status === 'paused' || task.status === 'cancelled') {
        throw Object.assign(new Error('下载已暂停或取消，无法转换 MPKG'), { statusCode: 409, code: 'DOWNLOAD_NOT_RUNNING' });
      }
      if (Date.now() - startedAt > 30 * 60 * 1000) {
        throw Object.assign(new Error('等待下载完成超时，无法转换 MPKG'), { statusCode: 504, code: 'DOWNLOAD_TIMEOUT' });
      }
      await sleep(1000);
    }
  }

  return { ensureDownloadedItem };
}

module.exports = {
  createMpkgSourcePreparation,
};
