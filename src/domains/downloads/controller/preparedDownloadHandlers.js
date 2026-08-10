'use strict';

function createPreparedDownloadHandlers(deps = {}) {
  const {
    jsonRes,
    sendDownloadFile,
    sendPreparedDownload,
    createPreparedDownload,
    prepareClientDownloadFile,
    findDownloadedItemPath,
    findQueueItemById,
    sendPathAsClientDownload,
    debugMpkg,
  } = deps;

  async function handlePreparedDownload(req, res, prepareFn, id, title, probePath) {
    const q = new URL(req.url, 'http://x').searchParams;
    const token = q.get('token');
    const isMpkg = probePath === '/api/mpkg/download';
    const onDebug = isMpkg ? debugMpkg : undefined;
    const requestStartedAt = Date.now();
    if (token) {
      if (onDebug) onDebug('request phase=prepared-token');
      return sendPreparedDownload(req, res, token, { onDebug });
    }
    if (onDebug) onDebug(`request phase=${q.get('probe') === '1' ? 'probe' : 'direct'} id=${String(id || '').replace(/[^\d]/g, '') || '-'}`);
    try {
      const prepared = await prepareFn(id, title);
      if (onDebug) onDebug(`prepared file id=${String(id || '').replace(/[^\d]/g, '') || '-'} filename=${prepared.fileName || '-'} elapsedMs=${Date.now() - requestStartedAt}`);
      if (q.get('probe') === '1') {
        const preparedToken = createPreparedDownload(prepared.filePath, prepared.fileName, { deleteAfterSend: prepared.deleteAfterSend });
        if (onDebug) onDebug(`probe response prepared filename=${prepared.fileName || '-'} elapsedMs=${Date.now() - requestStartedAt}`);
        return jsonRes(res, 200, {
          success: true,
          downloadUrl: `${probePath}?token=${encodeURIComponent(preparedToken)}`,
          filename: prepared.fileName
        });
      }
      if (onDebug) onDebug(`stream handoff filename=${prepared.fileName || '-'} elapsedMs=${Date.now() - requestStartedAt}`);
      return sendDownloadFile(req, res, prepared.filePath, prepared.fileName, { deleteAfterSend: prepared.deleteAfterSend, onDebug });
    } catch (e) {
      if (onDebug) onDebug(`request failed phase=${q.get('probe') === '1' ? 'probe' : 'direct'} elapsedMs=${Date.now() - requestStartedAt} error=${String(e && e.message || e || 'unknown')}`);
      return jsonRes(res, e.statusCode || 500, {
        error: e.message || 'Download failed',
        code: e.code || '',
        requiresSteamLogin: !!e.requiresSteamLogin,
        requiresSteamGuard: !!e.requiresSteamGuard
      });
    }
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

  return {
    handlePreparedDownload,
    handleClientDownload,
    handleQueueItemDownload,
  };
}

module.exports = { createPreparedDownloadHandlers };
