'use strict';

const { createDepotStreamRangeTools } = require('./depotStream/range');
const { createDepotStreamCacheFiles } = require('./depotStream/cacheFiles');
const { createDepotStreamWorkerScheduler } = require('./depotStream/workerScheduler');
const { createDepotStreamCacheMaintenance } = require('./depotStream/cacheMaintenance');
const { createDepotStreamWorkerLifecycle } = require('./depotStream/workerLifecycle');
const { createDepotStreamRangeTasks } = require('./depotStream/rangeTasks');
const { createDepotStreamHttpResponse } = require('./depotStream/httpResponse');
const { createDepotStreamRequestLifecycle } = require('./depotStream/requestLifecycle');
const { createDepotStreamPlaybackFeedback } = require('./depotStream/playbackFeedback');
const { createDepotStreamMetrics } = require('./depotStream/metrics');
const { createDepotStreamFullCache } = require('./depotStream/fullCache');

function createDepotStreamService(deps = {}) {
  const {
    DEPOT_STREAM_PATCH_VERSION,
    DEPOT_CONFIG_DIR,
    DEPOT_STREAM_CACHE_DIR,
    DEPOT_STREAM_MAX_RANGE_BYTES,
    DEPOT_STREAM_FIRST_RANGE_BYTES,
    DEPOT_STREAM_TAIL_BYTES,
    DEPOT_STREAM_INITIAL_BUFFER_BYTES,
    DEPOT_STREAM_AHEAD_BYTES,
    DEPOT_STREAM_CHUNK_BUFFER_BYTES,
    DEPOT_STREAM_READ_THROUGH,
    DEPOT_STREAM_READ_WINDOW_BYTES,
    DEPOT_STREAM_WORKER_IDLE_MS,
    DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK,
    DEPOT_STREAM_CACHE_CLEANUP_TARGET,
    DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS,
    depotCommandFor,
    getSteamKitMaxDownloads,
    makeDepotLoginId,
    getSteamContentCellId,
    resolveDepotLogin,
    ensureDepotStreamDownloaderReady,
    ensureDir,
    runProcess,
    buildSteamContentEnv,
    buildDepotDotnetEnv,
    getSteamCdnRouteStrategy,
    updateSteamCdnStatusFromText,
    describeSteamCdnRouteStrategy,
    fmtBytes,
    getDepotStreamCacheMaxBytes,
    getDepotVideoStreams,
    getDepotVideoStream,
    hasFilesRecursive,
    getVideoMime,
    steamKitNeedsOwnedAccount,
    canUseDepotLogin,
    makeSteamKitLoginRequiredError,
    normalizeDepotError,
    shouldRetrySteamLoginRequiredError,
    refreshPersistentSteamLoginForRetry,
    jsonRes,
    send,
    sleep,
    debugLogger = console,
  } = deps;

  const rangePromises = new Map();
  const workers = new Map();
  const demandEpochs = new Map();
  let generation = 0;
  let workerJobSequence = 0;
  let aheadScheduleCount = 0;
  let serverStopping = false;
  const completedSessions = [];
  const streamChunkBufferBytes = Math.max(8 * 1024 * 1024, Math.min(
    512 * 1024 * 1024,
    parseInt(String(DEPOT_STREAM_CHUNK_BUFFER_BYTES || 64 * 1024 * 1024), 10) || 64 * 1024 * 1024
  ));
  const getStreamMaxDownloads = () => Math.max(1, Math.min(32,
    parseInt(String(getSteamKitMaxDownloads()), 10) || 1));
  const metrics = createDepotStreamMetrics({ logger: debugLogger });

  const rangeTools = createDepotStreamRangeTools({
    maxRangeBytes: DEPOT_STREAM_MAX_RANGE_BYTES,
    firstRangeBytes: DEPOT_STREAM_FIRST_RANGE_BYTES,
    tailBytes: DEPOT_STREAM_TAIL_BYTES,
  });
  const cacheFiles = createDepotStreamCacheFiles(DEPOT_STREAM_CACHE_DIR);
  let workerLifecycle;
  let rangeTasks;
  let playbackFeedback;
  const workerScheduler = createDepotStreamWorkerScheduler({
    nextSequence: () => ++workerJobSequence,
    refreshWorkerIdle: worker => workerLifecycle.refreshWorkerIdle(worker),
    stopWorker: (worker, reason, cause) => workerLifecycle.stopWorker(worker, reason, cause),
    logger: debugLogger,
  });
  const cacheMaintenance = createDepotStreamCacheMaintenance({
    cacheDir: DEPOT_STREAM_CACHE_DIR,
    cleanupHighWatermark: DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK,
    cleanupTarget: DEPOT_STREAM_CACHE_CLEANUP_TARGET,
    cleanupDebounceMs: DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS,
    extentBytes: DEPOT_STREAM_MAX_RANGE_BYTES,
    headBytes: DEPOT_STREAM_FIRST_RANGE_BYTES,
    tailBytes: DEPOT_STREAM_TAIL_BYTES,
    workers,
    rangePromises,
    getCacheDir: cacheFiles.depotStreamCacheDir,
    getCacheMaxBytes: getDepotStreamCacheMaxBytes,
    getVideoStreams: getDepotVideoStreams,
    fmtBytes,
    hasFilesRecursive,
    ensureDir,
    stopAllWorkers: reason => workerLifecycle.stopAllWorkers(reason),
    cancelRangeTask: (task, reason) => rangeTasks.cancelRangeTask(task, reason),
    removeCacheFile: cacheFiles.removeDepotStreamCacheFile,
    clearCacheIndexes: cacheFiles.clearDepotStreamCacheIndexes,
    logger: debugLogger,
  });
  workerLifecycle = createDepotStreamWorkerLifecycle({
    patchVersion: DEPOT_STREAM_PATCH_VERSION,
    configDir: DEPOT_CONFIG_DIR,
    workerIdleMs: DEPOT_STREAM_WORKER_IDLE_MS,
    workers,
    demandEpochs,
    isServerStopping: () => serverStopping,
    incrementGeneration: () => { generation++; },
    getCacheDir: cacheFiles.depotStreamCacheDir,
    buildArgs,
    ensureDownloaderReady: ensureDepotStreamDownloaderReady,
    ensureDir,
    depotCommandFor,
    buildSteamContentEnv,
    buildDepotDotnetEnv,
    getCdnRouteStrategy: getSteamCdnRouteStrategy,
    getContentCellId: getSteamContentCellId,
    getMaxDownloads: getStreamMaxDownloads,
    chunkBufferBytes: streamChunkBufferBytes,
    describeCdnRouteStrategy: describeSteamCdnRouteStrategy,
    updateCdnStatusFromText: updateSteamCdnStatusFromText,
    workerHasWork: workerScheduler.depotStreamWorkerHasWork,
    rejectWorkerPending: workerScheduler.rejectDepotStreamWorkerPending,
    handleWorkerMessage: workerScheduler.handleDepotStreamWorkerMessage,
    retryWorkerTempCleanups: cacheMaintenance.retryWorkerTempCleanups,
    logger: debugLogger,
  });
  rangeTasks = createDepotStreamRangeTasks({
    maxRangeBytes: DEPOT_STREAM_MAX_RANGE_BYTES,
    firstRangeBytes: DEPOT_STREAM_FIRST_RANGE_BYTES,
    tailBytes: DEPOT_STREAM_TAIL_BYTES,
    initialBufferBytes: DEPOT_STREAM_INITIAL_BUFFER_BYTES,
    aheadBytes: DEPOT_STREAM_AHEAD_BYTES,
    rangePromises,
    workers,
    demandEpochs,
    activeTempFiles: cacheMaintenance.activeTempFiles,
    getGeneration: () => generation,
    incrementAheadScheduleCount: () => { aheadScheduleCount++; },
    logger: debugLogger,
    isServerStopping: () => serverStopping,
    getCacheFile: cacheFiles.depotStreamCacheFile,
    getCacheDir: cacheFiles.depotStreamCacheDir,
    selectCoverage: cacheFiles.selectDepotStreamCoverage,
    commitCacheRange: cacheFiles.commitDepotStreamCacheRange,
    planBlocks: rangeTools.planDepotStreamBlocks,
    clampRange: rangeTools.clampDepotStreamRange,
    getWorker: workerLifecycle.getWorker,
    getWorkerKey: workerLifecycle.workerKey,
    stopWorker: workerLifecycle.stopWorker,
    requestWorkerRange: workerScheduler.requestDepotStreamWorkerRange,
    cancelWorkerJob: workerScheduler.cancelDepotStreamWorkerJob,
    cancelWorkerPrefetch: workerScheduler.cancelDepotStreamWorkerPrefetch,
    cancelBlockingWorkerPrefetch: workerScheduler.cancelBlockingDepotStreamWorkerPrefetch,
    promoteWorkerJob: workerScheduler.promoteDepotStreamWorkerJob,
    setWorkerJobSchedule: workerScheduler.setDepotStreamWorkerJobSchedule,
    createAbortError: workerScheduler.createDepotStreamAbortError,
    isAbortError: workerScheduler.isDepotStreamAbortError,
    shouldStopWorkerForRangeError: workerScheduler.shouldStopDepotStreamWorkerForRangeError,
    ensureDir,
    scheduleTempCleanup: cacheMaintenance.scheduleTempCleanup,
    reserveCacheWrite: cacheMaintenance.reserveCacheWriteAsync,
    waitForCacheWrite: cacheMaintenance.waitForCacheWrite,
    releaseCacheWrite: cacheMaintenance.releaseCacheWrite,
    getMaxDownloads: getStreamMaxDownloads,
    recordNetworkSample: (entry, bytes, elapsedMs) => playbackFeedback && playbackFeedback.recordNetworkSample(entry, bytes, elapsedMs),
    recordMetric: metrics.record,
    logger: debugLogger,
  });
  playbackFeedback = createDepotStreamPlaybackFeedback({
    maxRangeBytes: DEPOT_STREAM_MAX_RANGE_BYTES,
    firstRangeBytes: DEPOT_STREAM_FIRST_RANGE_BYTES,
    maxAheadBytes: DEPOT_STREAM_AHEAD_BYTES,
    getGeneration: () => generation,
    getDemandEpoch: entry => demandEpochs.get(cacheFiles.depotStreamCacheDir(entry)) || 0,
    nextDemandEpoch: rangeTasks.nextDemandEpoch,
    cancelEntryPrefetch: rangeTasks.cancelEntryPrefetch,
    prefetchRange: rangeTasks.prefetchRange,
    selectCoverage: cacheFiles.selectDepotStreamCoverage,
    getCacheMaxBytes: getDepotStreamCacheMaxBytes,
    getMaxDownloads: getStreamMaxDownloads,
    resolveDepotLogin,
    incrementAheadScheduleCount: () => { aheadScheduleCount++; },
    recordMetric: metrics.record,
    onFinished: summary => {
      completedSessions.push(summary);
      if (completedSessions.length > 12) completedSessions.shift();
    },
    logger: debugLogger,
  });
  const fullCache = createDepotStreamFullCache({
    maxRangeBytes: DEPOT_STREAM_MAX_RANGE_BYTES,
    getGeneration: () => generation,
    getDemandEpoch: entry => demandEpochs.get(cacheFiles.depotStreamCacheDir(entry)) || 0,
    selectCoverage: cacheFiles.selectDepotStreamCoverage,
    ensureRangeCached: rangeTasks.ensureRangeCached,
    getCacheMaxBytes: getDepotStreamCacheMaxBytes,
    pinCacheFile: cacheMaintenance.pinCacheFile,
    resolveDepotLogin,
    isAbortError: workerScheduler.isDepotStreamAbortError,
    recordMetric: metrics.record,
    logger: debugLogger,
  });
  const httpResponse = createDepotStreamHttpResponse({
    getVideoMime,
    send,
    createAbortError: workerScheduler.createDepotStreamAbortError,
    pinCacheFile: cacheMaintenance.pinCacheFile,
    readWindowBytes: DEPOT_STREAM_READ_WINDOW_BYTES,
    logger: debugLogger,
  });
  const requestLifecycle = createDepotStreamRequestLifecycle({
    getVideoStream: getDepotVideoStream,
    normalizeRange: rangeTools.normalizeRange,
    planBlocks: rangeTools.planDepotStreamBlocks,
    selectCoverage: cacheFiles.selectDepotStreamCoverage,
    resolveDepotLogin,
    getVideoMime,
    getMaxDownloads: getStreamMaxDownloads,
    describeCdnRouteStrategy: describeSteamCdnRouteStrategy,
    needsOwnedAccount: steamKitNeedsOwnedAccount,
    canUseLogin: canUseDepotLogin,
    makeLoginRequiredError: makeSteamKitLoginRequiredError,
    normalizeError: normalizeDepotError,
    shouldRetryLoginRequiredError: shouldRetrySteamLoginRequiredError,
    refreshLoginForRetry: refreshPersistentSteamLoginForRetry,
    jsonRes,
    send,
    getDemandEpoch: entry => demandEpochs.get(cacheFiles.depotStreamCacheDir(entry)) || 0,
    prepareBlock: rangeTasks.prepareBlock,
    cancelEntryBlockingPrefetch: rangeTasks.cancelEntryBlockingPrefetch,
    scheduleAheadPrefetch: playbackFeedback.onRangeComplete,
    createAbortError: workerScheduler.createDepotStreamAbortError,
    isAbortError: workerScheduler.isDepotStreamAbortError,
    streamCacheSegments: httpResponse.streamCacheSegments,
    streamRangeTask: httpResponse.streamRangeTask,
    prepareStreamingBlock: rangeTasks.prepareStreamingBlock,
    readThroughEnabled: DEPOT_STREAM_READ_THROUGH !== false,
    pinCacheFiles: cacheMaintenance.pinCacheFiles,
    endResponse: httpResponse.endResponse,
    beginRequestMetric: metrics.beginRequest,
    logger: debugLogger,
  });

  function setServerStopping(value) {
    serverStopping = !!value;
  }

  function diagnostics() {
    const sessions = Array.from(getDepotVideoStreams()).map(entry => {
      const stats = entry.depotPlaybackStats || {};
      const feedback = entry.playbackFeedback || {};
      const events = Array.isArray(entry.depotStreamMetrics) ? entry.depotStreamMetrics : [];
      return {
        playbackSessionId: entry.depotPlaybackSessionId || '',
        state: feedback.state || 'preparing',
        readyState: Number(feedback.readyState || 0),
        networkState: Number(feedback.networkState || 0),
        stalls: Number(stats.stalls || 0),
        stallMs: Number(stats.stallMs || 0),
        networkBytesPerSecond: Math.round(Number(entry.depotNetworkBytesPerSecond || 0)),
        activeNetworkBytesPerSecond: Math.round(Number(entry.depotNetworkActiveBytesPerSecond || 0)),
        anchorConfidence: entry.depotPlaybackByteAnchor && entry.depotPlaybackByteAnchor.confidence || 'none',
        recentEvents: events.slice(-12).map(event => ({
          event: event.event,
          at: event.at,
          elapsedMs: Number(event.elapsedMs || 0),
        })),
      };
    });
    return {
      readThrough: DEPOT_STREAM_READ_THROUGH !== false,
      rangeBytes: DEPOT_STREAM_MAX_RANGE_BYTES,
      firstRangeBytes: DEPOT_STREAM_FIRST_RANGE_BYTES,
      tailBytes: DEPOT_STREAM_TAIL_BYTES,
      readWindowBytes: DEPOT_STREAM_READ_WINDOW_BYTES,
      maxDownloads: getStreamMaxDownloads(),
      chunkBufferBytes: streamChunkBufferBytes,
      sessions,
      completedSessions: completedSessions.slice(),
    };
  }

  function buildArgs(executable, publishedFileId, appId, options) {
    const { argsPrefix } = depotCommandFor(executable);
    const args = [
      ...argsPrefix,
      '-app', String(appId),
      '-pubfile', String(publishedFileId),
      '-dir', DEPOT_CONFIG_DIR,
      '-max-downloads', String(getStreamMaxDownloads()),
      '-loginid', makeDepotLoginId(`stream:${appId}:${publishedFileId}`),
    ];
    const cellId = getSteamContentCellId();
    if (cellId) args.push('-cellid', String(cellId));
    if (options && options.worker) {
      args.push('-wallhub-stream-worker');
    } else if (options && options.info) {
      args.push('-wallhub-stream-info');
    } else if (options && options.range) {
      args.push(
        '-wallhub-stream-range',
        '-wallhub-range-start', String(options.range.start),
        '-wallhub-range-end', String(options.range.end)
      );
    }
    const login = options && options.depotLogin || resolveDepotLogin(appId);
    if (login.user) {
      args.push('-username', login.user, '-remember-password');
      if (login.pass) args.push('-password', login.pass);
      if (login.guard) args.push('-no-mobile');
    }
    if (process.env.DEPOTDOWNLOADER_DEBUG === '1') args.push('-debug');
    return { args, inputLines: login.guard ? [login.guard] : [] };
  }

  async function getInfo(publishedFileId, depotLogin) {
    const executable = await ensureDepotStreamDownloaderReady();
    ensureDir(DEPOT_CONFIG_DIR);
    const { command } = depotCommandFor(executable);
    const built = buildArgs(executable, publishedFileId, 431960, { info: true, depotLogin });
    debugLogger.log(`[Depot Stream] runtime: ${executable}`);
    const timeout = Math.max(30000, parseInt(process.env.WALLHUB_DEPOT_STREAM_INFO_TIMEOUT || '90000', 10) || 90000);
    const result = await runProcess(command, built.args, timeout, {
      cwd: DEPOT_CONFIG_DIR,
      inputLines: built.inputLines,
      closeStdin: built.inputLines.length > 0,
      env: buildSteamContentEnv(Object.assign({}, process.env, buildDepotDotnetEnv())),
      replaceEnv: true,
      preparedEnv: true,
    });
    const text = String(result && result.out || '').trim();
    const line = text.split(/\r?\n/).reverse().find(value => /^\s*\{/.test(value));
    if (!line) throw new Error('Depot stream helper did not return video metadata');
    const info = JSON.parse(line);
    const size = parseInt(String(info.size || '0'), 10);
    if (!Number.isFinite(size) || size <= 0) throw new Error('Depot stream helper returned invalid video size');
    return {
      appId: parseInt(String(info.appId || 431960), 10) || 431960,
      publishedFileId: String(info.publishedFileId || publishedFileId),
      depotId: String(info.depotId || ''),
      manifestId: String(info.manifestId || ''),
      fileName: String(info.fileName || ''),
      size,
      chunks: parseInt(String(info.chunks || '0'), 10) || 0,
    };
  }

  return {
    rangePromises,
    workers,
    setServerStopping,
    buildArgs,
    getInfo,
    streamFileWithRange: httpResponse.streamFileWithRange,
    normalizeRange: rangeTools.normalizeRange,
    findCachedRange: cacheFiles.findCachedRange,
    pipeCachedRange: httpResponse.pipeCachedRange,
    stopAllWorkers: workerLifecycle.stopAllWorkers,
    stopWorkerByKey: workerLifecycle.stopWorkerByKey,
    releaseEntry: workerLifecycle.releaseEntry,
    getWorker: workerLifecycle.getWorker,
    ensureRangeCached: rangeTasks.ensureRangeCached,
    scheduleInitialPrefetch: rangeTasks.scheduleInitialPrefetch,
    scheduleAheadPrefetch: rangeTasks.scheduleAheadPrefetch,
    applyPlaybackFeedback: playbackFeedback.apply,
    finishPlayback: playbackFeedback.finish,
    startFullCache: fullCache.start,
    getFullCacheStatus: fullCache.snapshot,
    cancelFullCache: fullCache.cancel,
    cleanupCache: cacheMaintenance.cleanupCache,
    scheduleCacheCleanup: cacheMaintenance.scheduleCacheCleanup,
    maybeScheduleCacheCleanupAfterWrite: cacheMaintenance.maybeScheduleCacheCleanupAfterWrite,
    getCacheStats: cacheMaintenance.getCacheStats,
    clearCacheNow: cacheMaintenance.clearCacheNow,
    diagnostics,
    handleVideoStream: requestLifecycle.handleVideoStream,
    _test: {
      planDepotStreamBlocks: rangeTools.planDepotStreamBlocks,
      listDepotStreamCacheRanges: cacheFiles.listDepotStreamCacheRanges,
      selectDepotStreamCoverage: cacheFiles.selectDepotStreamCoverage,
      commitDepotStreamCacheRange: cacheFiles.commitDepotStreamCacheRange,
      clearDepotStreamCacheIndexes: cacheFiles.clearDepotStreamCacheIndexes,
      requestDepotStreamWorkerRange: workerScheduler.requestDepotStreamWorkerRange,
      handleDepotStreamWorkerMessage: workerScheduler.handleDepotStreamWorkerMessage,
      cancelDepotStreamWorkerJob: workerScheduler.cancelDepotStreamWorkerJob,
      promoteDepotStreamWorkerJob: workerScheduler.promoteDepotStreamWorkerJob,
      demoteDepotStreamWorkerJob: workerScheduler.demoteDepotStreamWorkerJob,
      waitForDepotStreamRangeTask: rangeTasks.waitForRangeTask,
      reconcileDepotStreamRangeTaskWaiters: rangeTasks.reconcileRangeTaskWaiters,
      createDepotStreamAbortError: workerScheduler.createDepotStreamAbortError,
      isDepotStreamAbortError: workerScheduler.isDepotStreamAbortError,
      shouldStopDepotStreamWorkerForRangeError: workerScheduler.shouldStopDepotStreamWorkerForRangeError,
      createDepotStreamRequestAbort: requestLifecycle.createRequestAbort,
      prepareDepotStreamBlock: rangeTasks.prepareBlock,
      prefetchDepotStreamRange: rangeTasks.prefetchRange,
      nextDepotStreamDemandEpoch: rangeTasks.nextDemandEpoch,
      cancelDepotStreamEntryPrefetch: rangeTasks.cancelEntryPrefetch,
      depotStreamWorkerKey: workerLifecycle.workerKey,
      updateDepotStreamWorkerCdnStatus: workerLifecycle.updateWorkerCdnStatus,
      parseDepotStreamWorkerInfo: workerLifecycle.parseInfoPayload,
      depotStreamRangePromiseKey: rangeTasks.rangePromiseKey,
      depotStreamRangeTaskReusable: rangeTasks.rangeTaskReusable,
      findDepotStreamInFlightRange: rangeTasks.findInFlightRange,
      depotStreamPrefetchTaskIsCurrent: rangeTasks.prefetchTaskIsCurrent,
      depotStreamInitialPrefetchPlan: rangeTasks.initialPrefetchPlan,
      depotStreamPrefetchBlocks: rangeTasks.prefetchBlocks,
      attachDepotStreamWorkerStdinErrorHandler: workerLifecycle.attachWorkerStdinErrorHandler,
      depotStreamWorkerProcessExited: workerLifecycle.workerProcessExited,
      killDepotStreamWorkerProcess: workerLifecycle.killWorkerProcess,
      clearDepotStreamWorkerForceKillTimer: workerLifecycle.clearWorkerForceKillTimer,
      scheduleDepotStreamWorkerForceKill: workerLifecycle.scheduleWorkerForceKill,
      attachDepotStreamWorkerLifecycleCleanup: workerLifecycle.attachWorkerLifecycleCleanup,
      scheduleDepotStreamTempCleanup: cacheMaintenance.scheduleTempCleanup,
      retryDepotStreamWorkerTempCleanups: cacheMaintenance.retryWorkerTempCleanups,
      activeTempFiles: cacheMaintenance.activeTempFiles,
      activeCacheFiles: cacheMaintenance.activeCacheFiles,
      tempCleanupRetries: cacheMaintenance.tempCleanupRetries,
      tmpStaleMs: cacheMaintenance.tmpStaleMs,
      getEstimatedCacheBytes: cacheMaintenance.getEstimatedBytes,
      getReservedCacheBytes: cacheMaintenance.getReservedBytes,
      reserveCacheWrite: cacheMaintenance.reserveCacheWrite,
      waitForCacheWrite: cacheMaintenance.waitForCacheWrite,
      releaseCacheWrite: cacheMaintenance.releaseCacheWrite,
      pinCacheFile: cacheMaintenance.pinCacheFile,
      getAheadScheduleCount: () => aheadScheduleCount,
      getDemandEpoch: entry => demandEpochs.get(cacheFiles.depotStreamCacheDir(entry)) || 0,
      getGeneration: () => generation,
      normalizePlaybackFeedback: playbackFeedback.normalize,
      playbackMetrics: playbackFeedback.playbackMetrics,
      playbackBufferWatermarks: playbackFeedback.bufferWatermarks,
      playbackBufferStatus: playbackFeedback.bufferStatus,
      streamDepotStreamRangeTask: httpResponse.streamRangeTask,
      depotStreamMetrics: entry => Array.isArray(entry && entry.depotStreamMetrics)
        ? entry.depotStreamMetrics.slice()
        : [],
    },
  };
}

module.exports = { createDepotStreamService };
