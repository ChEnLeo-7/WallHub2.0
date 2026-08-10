'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function createRuntimeResidueCleanup(deps) {
  const {
    getDownloadsDir,
    getSteamKitConfigDir,
    hasFilesRecursive,
    currentTaskQueue,
    deletePathIfInside,
    logger = console,
  } = deps;

  function removeEmptyParents(startDir, stopDir) {
    let current = path.resolve(startDir || '');
    const stop = path.resolve(stopDir || '');
    while (current && current !== stop && current.startsWith(stop + path.sep)) {
      try {
        if (!fs.existsSync(current) || fs.readdirSync(current).length > 0) break;
        fs.rmdirSync(current);
      } catch {
        break;
      }
      current = path.dirname(current);
    }
  }

  function cleanupTaskFiles(task) {
    const targetId = String(task.id);
    const appId = String(task.appId || 431960);
    const downloadsDir = getDownloadsDir();
    const steamKitConfigDir = getSteamKitConfigDir();
    const steamKitWsDir = path.join(steamKitConfigDir, 'steamapps', 'workshop');
    const steamKitDepotDownloadsDir = path.join(steamKitConfigDir, 'depotdownloader', 'downloads');
    const allowedRoots = [downloadsDir, steamKitWsDir, os.tmpdir(), steamKitConfigDir];

    deletePathIfInside(task.outputPath, allowedRoots);
    deletePathIfInside(task.filePath, allowedRoots);
    if (!task.skipFinalDownloadDir) deletePathIfInside(path.join(downloadsDir, targetId), allowedRoots);
    deletePathIfInside(path.join(steamKitDepotDownloadsDir, appId, targetId), allowedRoots);
    deletePathIfInside(path.join(steamKitWsDir, 'downloads', appId, targetId), allowedRoots);
    deletePathIfInside(path.join(steamKitWsDir, 'content', appId, targetId), allowedRoots);
    deletePathIfInside(path.join(steamKitWsDir, 'temp', appId, targetId), allowedRoots);

    const depotAppDir = path.join(steamKitDepotDownloadsDir, appId);
    if (fs.existsSync(depotAppDir) && fs.readdirSync(depotAppDir).length === 0) {
      try { fs.rmdirSync(depotAppDir); } catch {}
    }

    const downloadRoot = path.join(steamKitWsDir, 'downloads');
    if (fs.existsSync(downloadRoot)) {
      for (const fileName of fs.readdirSync(downloadRoot)) {
        if (fileName.endsWith('.patch') && fileName.includes(targetId)) {
          deletePathIfInside(path.join(downloadRoot, fileName), allowedRoots);
        }
      }
    }

    const appWorkshopFile = path.join(steamKitWsDir, `appworkshop_${appId}.acf`);
    const hasOtherActiveSameApp = currentTaskQueue().some(activeTask =>
      String(activeTask.id) !== targetId &&
      String(activeTask.appId || 431960) === appId &&
      ['pending', 'downloading', 'paused'].includes(String(activeTask.status || ''))
    );
    if (!hasOtherActiveSameApp && fs.existsSync(appWorkshopFile)) {
      try {
        const text = fs.readFileSync(appWorkshopFile, 'utf8');
        if (text.includes(targetId)) deletePathIfInside(appWorkshopFile, allowedRoots);
      } catch {}
    }

    const downloadAppDir = path.join(steamKitWsDir, 'downloads', appId);
    if (fs.existsSync(downloadAppDir) && fs.readdirSync(downloadAppDir).length === 0) {
      try { fs.rmdirSync(downloadAppDir); } catch {}
    }
  }

  function cleanupRuntimeDownloadChildren(root, options = {}) {
    const resolvedRoot = path.resolve(root || '');
    if (!resolvedRoot || !fs.existsSync(resolvedRoot)) return 0;
    const keep = new Set(Array.from(options.keepIds || []).map(id => String(id)));
    const allowedRoots = (options.allowedRoots || [resolvedRoot]).map(item => path.resolve(item));
    let removed = 0;
    let entries = [];
    try { entries = fs.readdirSync(resolvedRoot, { withFileTypes: true }); } catch { return 0; }
    for (const entry of entries) {
      if (!entry.isDirectory() || !/^\d+$/.test(entry.name)) continue;
      if (keep.has(entry.name)) continue;
      const full = path.join(resolvedRoot, entry.name);
      const finalDir = path.join(getDownloadsDir(), entry.name);
      const shouldDelete = !!options.deleteAll || fs.existsSync(finalDir) || !hasFilesRecursive(full);
      if (!shouldDelete) continue;
      try {
        deletePathIfInside(full, allowedRoots);
        removed += 1;
      } catch (error) {
        logger.warn(`[Cleanup] Failed to remove runtime residue ${full}:`, error.message);
      }
    }
    removeEmptyParents(resolvedRoot, path.dirname(resolvedRoot));
    return removed;
  }

  function cleanupRuntimeDownloadResidues(appId = 431960, keepIds = []) {
    const app = String(appId || 431960);
    const keep = new Set(Array.from(keepIds || []).map(id => String(id)));
    const steamKitConfigDir = getSteamKitConfigDir();
    const specs = [
      {
        root: path.join(steamKitConfigDir, 'depotdownloader', 'downloads', app),
        deleteAll: true,
      },
      {
        root: path.join(steamKitConfigDir, 'steamapps', 'workshop', 'downloads', app),
        deleteAll: true,
      },
      {
        root: path.join(steamKitConfigDir, 'steamapps', 'workshop', 'content', app),
        deleteAll: false,
      },
    ];
    let removed = 0;
    for (const spec of specs) {
      removed += cleanupRuntimeDownloadChildren(spec.root, {
        keepIds: keep,
        allowedRoots: [steamKitConfigDir],
        deleteAll: spec.deleteAll,
      });
    }
    if (removed > 0) {
      logger.log(`[Cleanup] Removed ${removed} runtime workshop residue director${removed === 1 ? 'y' : 'ies'}`);
    }
    return removed;
  }

  function cleanupOrphanDepotDownloaderDownloads(appId, keepIds) {
    const app = String(appId || 431960);
    const keep = new Set(Array.from(keepIds || []).map(id => String(id)));
    const steamKitConfigDir = getSteamKitConfigDir();
    const root = path.join(steamKitConfigDir, 'depotdownloader', 'downloads', app);
    if (!fs.existsSync(root)) return;
    for (const name of fs.readdirSync(root)) {
      const full = path.join(root, name);
      let stat;
      try { stat = fs.statSync(full); } catch { continue; }
      if (!stat.isDirectory() || keep.has(String(name))) continue;
      deletePathIfInside(full, [steamKitConfigDir]);
    }
    try {
      if (fs.existsSync(root) && fs.readdirSync(root).length === 0) fs.rmdirSync(root);
    } catch {}
  }

  function runtimeResidueKeepIds(excludeId = '') {
    const excluded = String(excludeId || '');
    return currentTaskQueue()
      .filter(task => String(task.id) !== excluded)
      .filter(task => ['pending', 'downloading', 'paused'].includes(String(task.status || '')))
      .map(task => task.id);
  }

  return {
    cleanupTaskFiles,
    cleanupRuntimeDownloadResidues,
    cleanupOrphanDepotDownloaderDownloads,
    runtimeResidueKeepIds,
  };
}

module.exports = { createRuntimeResidueCleanup };
