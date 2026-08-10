'use strict';

const { createMpkgDebug, createMpkgHandlers } = require('./controller/mpkgHandlers');
const { createPreparedDownloadHandlers } = require('./controller/preparedDownloadHandlers');
const { createQueueActions } = require('./controller/queueActions');

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

  function taskQueue() {
    return getTaskQueue ? getTaskQueue() : [];
  }

  const debugMpkg = createMpkgDebug(isDebugEnabled, logger);
  const preparedDownloadHandlers = createPreparedDownloadHandlers({
    jsonRes,
    sendDownloadFile,
    sendPreparedDownload,
    createPreparedDownload,
    prepareClientDownloadFile,
    findDownloadedItemPath,
    findQueueItemById,
    sendPathAsClientDownload,
    debugMpkg,
  });
  const mpkgHandlers = createMpkgHandlers({
    jsonRes,
    handlePreparedDownload: preparedDownloadHandlers.handlePreparedDownload,
    createPreparedDownload,
    prepareMpkgDownloadFile,
    startMpkgPreparation,
    getMpkgPreparation,
    serializeMpkgPreparation,
    debugMpkg,
  });
  const queueActions = createQueueActions({
    jsonRes,
    readBody,
    taskQueue,
    listCachedItems,
    handleCachedItemDelete,
    deleteCachedItemFiles,
    cleanupTaskFiles,
    cleanupOrphanDepotDownloaderDownloads,
    getCacheItemsService,
    triggerQueue,
    enforceTopOnlyQueueRunner,
    sleep,
    livePauseControls: { livePauseMaxMs, setTimeoutFn, clearTimeoutFn },
    clearTimeoutFn,
    logger,
  });

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

  return {
    handlePreparedDownload: preparedDownloadHandlers.handlePreparedDownload,
    handleMpkgDownload: mpkgHandlers.handleMpkgDownload,
    handleMpkgPreparationStart: mpkgHandlers.handleMpkgPreparationStart,
    handleMpkgPreparationStatus: mpkgHandlers.handleMpkgPreparationStatus,
    handleClientDownload: preparedDownloadHandlers.handleClientDownload,
    handleQueueItemDownload: preparedDownloadHandlers.handleQueueItemDownload,
    handleDownload,
    listQueueItems,
    handleQueueAction: queueActions.handleQueueAction,
  };
}

module.exports = {
  createDownloadsController,
};
