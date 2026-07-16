'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

function createClientDownloadService(options = {}) {
  const ensureDir = options.ensureDir;
  const safeName = options.safeName;
  const zipDir = options.zipDir;
  const findDownloadedItemPath = options.findDownloadedItemPath;
  const createWorkshopQueueTask = options.createWorkshopQueueTask;
  const sleep = options.sleep;

  async function preparePathAsDownload(sourcePath, title, id) {
    if (!sourcePath || !fs.existsSync(sourcePath)) {
      const error = new Error('Downloaded item not found');
      error.statusCode = 404;
      throw error;
    }
    const stat = fs.statSync(sourcePath);
    const packageRoot = stat.isFile() ? path.dirname(sourcePath) : sourcePath;
    const tmpRoot = path.join(os.tmpdir(), 'wallhub-client-downloads');
    ensureDir(tmpRoot);
    const zipName = `${safeName(title || `Wallpaper ${id}`)}-${id}.zip`;
    const zipPath = path.join(tmpRoot, `${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${zipName}`);
    await zipDir(packageRoot, zipPath);
    return { filePath: zipPath, fileName: zipName, deleteAfterSend: true };
  }

  async function prepareDownloadFile(id, title) {
    const wantId = parseInt(id);
    if (!wantId) {
      const error = new Error('Invalid id');
      error.statusCode = 400;
      throw error;
    }
    const existing = findDownloadedItemPath(wantId);
    if (existing) return preparePathAsDownload(existing, title, wantId);

    const task = await createWorkshopQueueTask(wantId, title);
    const startedAt = Date.now();
    while (true) {
      const sourcePath = findDownloadedItemPath(wantId);
      if (sourcePath) return preparePathAsDownload(sourcePath, task.title, wantId);
      if (task.status === 'error') {
        const error = new Error(task.errorMsg || 'Download failed');
        error.statusCode = task.requiresSteamLogin || task.requiresSteamGuard ? 401 : 500;
        error.code = task.errorCode || '';
        error.requiresSteamLogin = !!task.requiresSteamLogin;
        error.requiresSteamGuard = !!task.requiresSteamGuard;
        throw error;
      }
      if (task.status === 'paused' || task.status === 'cancelled') {
        const error = new Error('Download was paused or cancelled');
        error.statusCode = 409;
        error.code = 'DOWNLOAD_NOT_RUNNING';
        throw error;
      }
      if (Date.now() - startedAt > 30 * 60 * 1000) {
        const error = new Error('Download timed out');
        error.statusCode = 504;
        error.code = 'DOWNLOAD_TIMEOUT';
        throw error;
      }
      await sleep(1000);
    }
  }

  return {
    preparePathAsDownload,
    prepareDownloadFile,
  };
}

module.exports = {
  createClientDownloadService,
};
