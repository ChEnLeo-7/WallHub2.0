'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function createResultPublisher(deps, throwIfDownloadCancelled) {
  const {
    STEAMKIT_CONFIG_DIR,
    hasFilesRecursive,
    copyDirContents,
    finalizeWorkshopItem,
    deletePathIfInside,
    cleanupRuntimeDownloadResidues,
    runtimeResidueKeepIds,
    pickVideoFile,
    extFromPath,
    safeName,
  } = deps;

  function normalizeOutput(rawRoot, tempRoot, appId, publishedFileId) {
    const canonical = path.join(tempRoot, 'steamapps', 'workshop', 'content', String(appId), String(publishedFileId));
    if (hasFilesRecursive(canonical)) return canonical;
    const candidates = [
      path.join(rawRoot, 'steamapps', 'workshop', 'content', String(appId), String(publishedFileId)),
      path.join(rawRoot, 'workshop', 'content', String(appId), String(publishedFileId)),
      path.join(rawRoot, 'content', String(appId), String(publishedFileId)),
      path.join(rawRoot, String(publishedFileId)),
    ];
    const source = candidates.find(hasFilesRecursive) || (hasFilesRecursive(rawRoot) ? rawRoot : '');
    if (!source) throw new Error('DepotDownloader completed but no workshop files were found');
    if (path.resolve(source) !== path.resolve(canonical)) {
      if (fs.existsSync(canonical)) fs.rmSync(canonical, { recursive: true, force: true });
      copyDirContents(source, canonical);
    }
    return canonical;
  }

  function publishResult(context) {
    const { rawRoot, tempRoot, appId, publishedFileId, title, options } = context;
    throwIfDownloadCancelled(options, 'finalizing output');
    const itemDir = normalizeOutput(rawRoot, tempRoot, appId, publishedFileId);
    throwIfDownloadCancelled(options, 'finalizing output');
    if (options && options.task) {
      options.task.progressStage = '正在整理文件';
      options.task.progress = 96;
      options.task.progressIndeterminate = false;
    }
    const finalDir = finalizeWorkshopItem(itemDir, publishedFileId);
    throwIfDownloadCancelled(options, 'finalizing output');
    try { deletePathIfInside(rawRoot, [STEAMKIT_CONFIG_DIR, os.tmpdir()]); } catch {}
    cleanupRuntimeDownloadResidues(appId, runtimeResidueKeepIds(publishedFileId));

    if (options && options.videoOnly) {
      const videoPath = pickVideoFile(finalDir);
      if (videoPath) {
        const videoExt = extFromPath(videoPath, '.mp4');
        const videoName = `${safeName(title || `Wallpaper ${publishedFileId}`)}-${publishedFileId}${videoExt}`;
        return { kind: 'file', filePath: videoPath, fileName: videoName, tempRoot, useSharedDir: tempRoot === STEAMKIT_CONFIG_DIR, itemDir: finalDir };
      }
    }
    const folderName = `${safeName(title || `Wallpaper ${publishedFileId}`)}-${publishedFileId}`;
    return { kind: 'file', filePath: finalDir, fileName: folderName, tempRoot, useSharedDir: tempRoot === STEAMKIT_CONFIG_DIR, itemDir: finalDir };
  }

  return { normalizeOutput, publishResult };
}

module.exports = { createResultPublisher };
