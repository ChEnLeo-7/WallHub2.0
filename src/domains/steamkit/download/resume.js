'use strict';

const fs = require('fs');
const path = require('path');

function createResumeProgress({ ensureDir }) {
  function checkpointPath(rawRoot) {
    return path.join(rawRoot, '.wallhub-resume.json');
  }

  function readTrustedResumeCheckpoint(rawRoot, appId, publishedFileId) {
    try {
      const file = checkpointPath(rawRoot);
      if (!fs.existsSync(file)) return null;
      const checkpoint = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (String(checkpoint.appId || '') !== String(appId || '')) return null;
      if (String(checkpoint.publishedFileId || '') !== String(publishedFileId || '')) return null;
      const downloaded = Math.max(0, Math.floor(Number(checkpoint.downloaded || 0)));
      const total = Math.max(0, Math.floor(Number(checkpoint.total || 0)));
      if (downloaded <= 0 || total <= 0 || downloaded >= total) return null;
      return { downloaded, total, updatedAt: Number(checkpoint.updatedAt || 0) || 0 };
    } catch {
      return null;
    }
  }

  function writeTrustedResumeCheckpoint(rawRoot, appId, publishedFileId, progress) {
    try {
      let downloaded = Math.max(0, Math.floor(Number(progress && progress.downloaded || 0)));
      let total = Math.max(0, Math.floor(Number(progress && progress.total || 0)));
      if (downloaded <= 0 || total <= 0 || downloaded >= total) return;
      const checkpoint = readTrustedResumeCheckpoint(rawRoot, appId, publishedFileId);
      if (checkpoint) {
        if (checkpoint.total > total) {
          total = checkpoint.total;
          downloaded = Math.max(downloaded, checkpoint.downloaded);
        } else if (checkpoint.total === total) {
          downloaded = Math.max(downloaded, checkpoint.downloaded);
        }
      }
      ensureDir(rawRoot);
      fs.writeFileSync(checkpointPath(rawRoot), JSON.stringify({
        version: 1,
        appId: String(appId || ''),
        publishedFileId: String(publishedFileId || ''),
        downloaded,
        total,
        updatedAt: Date.now(),
      }));
    } catch {}
  }

  function hasPartialResumeFiles(rawRoot) {
    try {
      if (!rawRoot || !fs.existsSync(rawRoot)) return false;
      const stack = [rawRoot];
      while (stack.length) {
        const current = stack.pop();
        let entries = [];
        try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
          const name = entry.name || '';
          if (!name || name === '.wallhub-resume.json' || name === 'Mpkg') continue;
          const full = path.join(current, name);
          if (entry.isDirectory()) {
            stack.push(full);
            continue;
          }
          if (entry.isFile()) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  function seedTaskProgress(task, rawRoot, appId, publishedFileId) {
    if (!task) return { source: 'none', downloaded: 0, total: 0 };
    const checkpoint = readTrustedResumeCheckpoint(rawRoot, appId, publishedFileId);
    if (checkpoint) {
      const taskKnownTotal = Math.max(
        Math.floor(Number(task.total || 0)),
        Math.floor(Number(task.size || 0)),
        checkpoint.total
      );
      const total = taskKnownTotal > 0 ? taskKnownTotal : checkpoint.total;
      const downloaded = Math.min(total, Math.max(Math.floor(Number(task.downloaded || 0)), checkpoint.downloaded));
      task.downloaded = downloaded;
      task.total = total;
      task.progress = Math.max(task.progress || 0, Math.min(95, (downloaded / total) * 100));
      task.progressIndeterminate = false;
      task.progressStage = '已读取可信续传进度，SteamKit 正在校验本地文件';
      task.progressStageMode = 'loading';
      if (downloaded !== checkpoint.downloaded || total !== checkpoint.total) {
        writeTrustedResumeCheckpoint(rawRoot, appId, publishedFileId, { downloaded, total });
      }
      return { source: 'checkpoint', downloaded, total, updatedAt: checkpoint.updatedAt };
    }
    const knownTotal = Math.max(0, Math.floor(Number(task.total || 0)));
    if (!hasPartialResumeFiles(rawRoot)) return { source: 'none', downloaded: 0, total: knownTotal };
    task.downloaded = 0;
    task.progress = 0;
    if (knownTotal > 0) task.total = knownTotal;
    task.progressIndeterminate = true;
    task.progressStage = '已发现本地续传文件，SteamKit 正在校验有效分块';
    task.progressStageMode = 'loading';
    return { source: 'partial-files', downloaded: 0, total: knownTotal };
  }

  function isTrustedProgress(rawRoot, appId, publishedFileId, progress) {
    if (!progress) return false;
    const downloaded = Math.max(0, Math.floor(Number(progress.downloaded || 0)));
    const total = Math.max(0, Math.floor(Number(progress.total || 0)));
    if (total <= 0 || downloaded < 0 || downloaded > total) return false;
    const networkDownloaded = Number(progress.networkDownloaded || 0);
    if (Number.isFinite(networkDownloaded) && networkDownloaded > 0) return true;
    const checkpoint = readTrustedResumeCheckpoint(rawRoot, appId, publishedFileId);
    return !!(checkpoint && downloaded <= checkpoint.downloaded && total === checkpoint.total);
  }

  function normalizeProgress(progress, resumeBaseline = null) {
    if (!progress) return progress;
    const downloaded = Math.max(0, Math.floor(Number(progress.downloaded || 0)));
    const reportedTotal = Math.max(0, Math.floor(Number(progress.total || 0)));
    const networkDownloaded = Math.max(0, Math.floor(Number(progress.networkDownloaded || 0)));
    const baseline = resumeBaseline && resumeBaseline.source !== 'none' ? resumeBaseline : null;
    if (!baseline) return progress;
    const baselineDownloaded = Math.max(0, Math.floor(Number(baseline.downloaded || 0)));
    const baselineTotal = Math.max(0, Math.floor(Number(baseline.total || 0)));
    const projectTotal = Math.max(baselineTotal, reportedTotal);
    if (projectTotal <= 0) return progress;
    if (networkDownloaded > 0) {
      return Object.assign({}, progress, {
        downloaded: Math.min(projectTotal, baselineDownloaded + networkDownloaded),
        total: projectTotal,
      });
    }
    if (baseline.source === 'checkpoint' && downloaded < baselineDownloaded) {
      return Object.assign({}, progress, { downloaded: baselineDownloaded, total: projectTotal });
    }
    return progress;
  }

  return {
    readTrustedResumeCheckpoint,
    writeTrustedResumeCheckpoint,
    seedTaskProgress,
    isTrustedProgress,
    normalizeProgress,
  };
}

module.exports = { createResumeProgress };
