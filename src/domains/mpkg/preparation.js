'use strict';

const { normalizeMpkgId, normalizeMpkgTextureProfile } = require('./normalizers');

function normalizePreparationStage(value) {
  return String(value || '').trim().toLowerCase() === 'converting' ? 'converting' : 'downloading';
}

function jobKey(id, textureProfile) {
  return `${id}|${textureProfile}`;
}

function normalizeError(error) {
  const message = String(error && error.message || error || 'MPKG 准备失败').trim() || 'MPKG 准备失败';
  return {
    message,
    code: String(error && error.code || ''),
    statusCode: Number(error && error.statusCode) || 500,
    requiresSteamLogin: !!(error && error.requiresSteamLogin),
    requiresSteamGuard: !!(error && error.requiresSteamGuard),
  };
}

function createMpkgPreparationService(options = {}) {
  const prepareDownloadFile = options.prepareDownloadFile;
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const terminalTtlMs = Math.max(60 * 1000, Number(options.terminalTtlMs) || 30 * 60 * 1000);
  const jobs = new Map();

  if (typeof prepareDownloadFile !== 'function') {
    throw new TypeError('prepareDownloadFile is required');
  }

  function cleanup() {
    const current = now();
    let removed = 0;
    for (const [id, job] of jobs) {
      if (job.status === 'preparing') continue;
      if (current - Number(job.updatedAt || job.startedAt || current) < terminalTtlMs) continue;
      jobs.delete(id);
      removed += 1;
    }
    return removed;
  }

  function start(id, title, textureProfile = 'fast') {
    cleanup();
    const jobId = normalizeMpkgId(id);
    if (!jobId) {
      const error = new Error('Invalid id');
      error.statusCode = 400;
      throw error;
    }

    const profile = normalizeMpkgTextureProfile(textureProfile);
    const key = jobKey(jobId, profile);
    const existing = jobs.get(key);
    if (existing && existing.status !== 'error') return existing;
    if (existing) jobs.delete(key);

    const startedAt = now();
    const job = {
      id: jobId,
      textureProfile: profile,
      title: String(title || ''),
      status: 'preparing',
      stage: 'downloading',
      startedAt,
      updatedAt: startedAt,
      filePath: '',
      fileName: '',
      error: '',
      code: '',
      statusCode: 0,
      requiresSteamLogin: false,
      requiresSteamGuard: false,
      promise: null,
    };
    jobs.set(key, job);

    const setStage = (stage) => {
      if (job.status !== 'preparing') return;
      const nextStage = normalizePreparationStage(stage);
      if (job.stage === nextStage) return;
      job.stage = nextStage;
      job.updatedAt = now();
    };

    let work;
    try {
      work = prepareDownloadFile(jobId, job.title, profile, { onStageChange: setStage });
    } catch (error) {
      work = Promise.reject(error);
    }
    job.promise = Promise.resolve(work)
      .then((prepared) => {
        if (!prepared || !prepared.filePath || !prepared.fileName) {
          const error = new Error('MPKG 准备完成但未返回有效文件');
          error.statusCode = 500;
          throw error;
        }
        job.filePath = String(prepared.filePath);
        job.fileName = String(prepared.fileName);
        job.status = 'ready';
        job.updatedAt = now();
        return job;
      })
      .catch((error) => {
        const normalized = normalizeError(error);
        job.status = 'error';
        job.error = normalized.message;
        job.code = normalized.code;
        job.statusCode = normalized.statusCode;
        job.requiresSteamLogin = normalized.requiresSteamLogin;
        job.requiresSteamGuard = normalized.requiresSteamGuard;
        job.updatedAt = now();
        return job;
      });
    return job;
  }

  function get(id, textureProfile = 'fast') {
    cleanup();
    const jobId = normalizeMpkgId(id);
    return jobId ? jobs.get(jobKey(jobId, normalizeMpkgTextureProfile(textureProfile))) || null : null;
  }

  function toPublic(job) {
    if (!job) return null;
    const result = {
      id: String(job.id || ''),
      status: String(job.status || 'error'),
    };
    if (job.status === 'preparing') {
      result.stage = normalizePreparationStage(job.stage);
      const startedAt = Number(job.startedAt);
      const current = now();
      result.elapsedMs = Math.max(0, current - (Number.isFinite(startedAt) ? startedAt : current));
    } else if (job.status === 'ready') {
      result.fileName = String(job.fileName || '');
    } else if (job.status === 'error') {
      result.error = String(job.error || 'MPKG 准备失败');
      result.code = String(job.code || '');
      if (job.requiresSteamLogin) result.requiresSteamLogin = true;
      if (job.requiresSteamGuard) result.requiresSteamGuard = true;
    }
    return result;
  }

  return {
    jobs,
    start,
    get,
    cleanup,
    toPublic,
  };
}

module.exports = {
  createMpkgPreparationService,
};
