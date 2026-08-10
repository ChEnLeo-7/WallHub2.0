'use strict';

const {
  normalizeMpkgId,
  normalizeMpkgTextureProfile,
} = require('../../mpkg/normalizers');

function createMpkgDebug(isDebugEnabled = () => false, logger = console) {
  return function debugMpkg(message) {
    try {
      if (!isDebugEnabled()) return;
    } catch {
      return;
    }
    logger.log(`[MPKG] Debug ${message}`);
  };
}

function createMpkgHandlers(deps = {}) {
  const {
    jsonRes,
    handlePreparedDownload,
    createPreparedDownload,
    prepareMpkgDownloadFile,
    startMpkgPreparation,
    getMpkgPreparation,
    serializeMpkgPreparation,
    debugMpkg,
  } = deps;

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
      const stage = String(snapshot.stage || '').trim().toLowerCase();
      if (stage === 'downloading' || stage === 'converting') result.stage = stage;
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

  return {
    handleMpkgDownload,
    handleMpkgPreparationStart,
    handleMpkgPreparationStatus,
  };
}

module.exports = { createMpkgDebug, createMpkgHandlers };
