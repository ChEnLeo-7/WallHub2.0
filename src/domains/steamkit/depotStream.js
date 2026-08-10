'use strict';

const { createDepotStreamRangeTools } = require('./depotStream/range');
const { createDepotStreamCacheFiles } = require('./depotStream/cacheFiles');
const { createDepotStreamWorkerScheduler } = require('./depotStream/workerScheduler');
const { createDepotStreamCacheMaintenance } = require('./depotStream/cacheMaintenance');
const { createDepotStreamWorkerLifecycle } = require('./depotStream/workerLifecycle');
const { createDepotStreamRangeTasks } = require('./depotStream/rangeTasks');
const { createDepotStreamHttpResponse } = require('./depotStream/httpResponse');
const { createDepotStreamRequestLifecycle } = require('./depotStream/requestLifecycle');

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
    DEPOT_STREAM_WORKER_IDLE_MS,
    DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK,
    DEPOT_STREAM_CACHE_CLEANUP_TARGET,
    DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS,
    depotCommandFor,
    getSteamKitStreamMaxDownloads,
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
  } = deps;

  const rangePromises = new Map();
  const workers = new Map();
  const demandEpochs = new Map();
  let generation = 0;
  let workerJobSequence = 0;
  let aheadScheduleCount = 0;
  let serverStopping = false;

  const rangeTools = createDepotStreamRangeTools({
    maxRangeBytes: DEPOT_STREAM_MAX_RANGE_BYTES,
    firstRangeBytes: DEPOT_STREAM_FIRST_RANGE_BYTES,
  });
  const cacheFiles = createDepotStreamCacheFiles(DEPOT_STREAM_CACHE_DIR);
  let workerLifecycle;
  let rangeTasks;
  const workerScheduler = createDepotStreamWorkerScheduler({
    nextSequence: () => ++workerJobSequence,
    refreshWorkerIdle: worker => workerLifecycle.refreshWorkerIdle(worker),
    stopWorker: (worker, reason, cause) => workerLifecycle.stopWorker(worker, reason, cause),
  });
  const cacheMaintenance = createDepotStreamCacheMaintenance({
    cacheDir: DEPOT_STREAM_CACHE_DIR,
    cleanupHighWatermark: DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK,
    cleanupTarget: DEPOT_STREAM_CACHE_CLEANUP_TARGET,
    cleanupDebounceMs: DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS,
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
    getMaxDownloads: getSteamKitStreamMaxDownloads,
    describeCdnRouteStrategy: describeSteamCdnRouteStrategy,
    updateCdnStatusFromText: updateSteamCdnStatusFromText,
    workerHasWork: workerScheduler.depotStreamWorkerHasWork,
    rejectWorkerPending: workerScheduler.rejectDepotStreamWorkerPending,
    handleWorkerMessage: workerScheduler.handleDepotStreamWorkerMessage,
    retryWorkerTempCleanups: cacheMaintenance.retryWorkerTempCleanups,
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
    isServerStopping: () => serverStopping,
    getCacheFile: cacheFiles.depotStreamCacheFile,
    getCacheDir: cacheFiles.depotStreamCacheDir,
    selectCoverage: cacheFiles.selectDepotStreamCoverage,
    planBlocks: rangeTools.planDepotStreamBlocks,
    clampRange: rangeTools.clampDepotStreamRange,
    getWorker: workerLifecycle.getWorker,
    getWorkerKey: workerLifecycle.workerKey,
    stopWorker: workerLifecycle.stopWorker,
    requestWorkerRange: workerScheduler.requestDepotStreamWorkerRange,
    cancelWorkerJob: workerScheduler.cancelDepotStreamWorkerJob,
    cancelWorkerPrefetch: workerScheduler.cancelDepotStreamWorkerPrefetch,
    promoteWorkerJob: workerScheduler.promoteDepotStreamWorkerJob,
    setWorkerJobSchedule: workerScheduler.setDepotStreamWorkerJobSchedule,
    createAbortError: workerScheduler.createDepotStreamAbortError,
    isAbortError: workerScheduler.isDepotStreamAbortError,
    shouldStopWorkerForRangeError: workerScheduler.shouldStopDepotStreamWorkerForRangeError,
    ensureDir,
    scheduleTempCleanup: cacheMaintenance.scheduleTempCleanup,
    maybeScheduleCacheCleanupAfterWrite: cacheMaintenance.maybeScheduleCacheCleanupAfterWrite,
    sleep,
  });
  const httpResponse = createDepotStreamHttpResponse({
    getVideoMime,
    send,
    createAbortError: workerScheduler.createDepotStreamAbortError,
  });
  const requestLifecycle = createDepotStreamRequestLifecycle({
    getVideoStream: getDepotVideoStream,
    normalizeRange: rangeTools.normalizeRange,
    planBlocks: rangeTools.planDepotStreamBlocks,
    selectCoverage: cacheFiles.selectDepotStreamCoverage,
    resolveDepotLogin,
    getVideoMime,
    getMaxDownloads: getSteamKitStreamMaxDownloads,
    describeCdnRouteStrategy: describeSteamCdnRouteStrategy,
    needsOwnedAccount: steamKitNeedsOwnedAccount,
    canUseLogin: canUseDepotLogin,
    makeLoginRequiredError: makeSteamKitLoginRequiredError,
    normalizeError: normalizeDepotError,
    shouldRetryLoginRequiredError: shouldRetrySteamLoginRequiredError,
    refreshLoginForRetry: refreshPersistentSteamLoginForRetry,
    jsonRes,
    send,
    nextDemandEpoch: rangeTasks.nextDemandEpoch,
    prepareBlock: rangeTasks.prepareBlock,
    cancelEntryPrefetch: rangeTasks.cancelEntryPrefetch,
    scheduleAheadPrefetch: rangeTasks.scheduleAheadPrefetch,
    createAbortError: workerScheduler.createDepotStreamAbortError,
    isAbortError: workerScheduler.isDepotStreamAbortError,
    streamCacheSegments: httpResponse.streamCacheSegments,
    endResponse: httpResponse.endResponse,
  });

  function setServerStopping(value) {
    serverStopping = !!value;
  }

  function buildArgs(executable, publishedFileId, appId, options) {
    const { argsPrefix } = depotCommandFor(executable);
    const args = [
      ...argsPrefix,
      '-app', String(appId),
      '-pubfile', String(publishedFileId),
      '-dir', DEPOT_CONFIG_DIR,
      '-max-downloads', String(getSteamKitStreamMaxDownloads()),
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
    console.log(`[Depot Stream] runtime: ${executable}`);
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
    cleanupCache: cacheMaintenance.cleanupCache,
    scheduleCacheCleanup: cacheMaintenance.scheduleCacheCleanup,
    maybeScheduleCacheCleanupAfterWrite: cacheMaintenance.maybeScheduleCacheCleanupAfterWrite,
    getCacheStats: cacheMaintenance.getCacheStats,
    clearCacheNow: cacheMaintenance.clearCacheNow,
    handleVideoStream: requestLifecycle.handleVideoStream,
    _test: {
      planDepotStreamBlocks: rangeTools.planDepotStreamBlocks,
      listDepotStreamCacheRanges: cacheFiles.listDepotStreamCacheRanges,
      selectDepotStreamCoverage: cacheFiles.selectDepotStreamCoverage,
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
      depotStreamRangePromiseKey: rangeTasks.rangePromiseKey,
      depotStreamRangeTaskReusable: rangeTasks.rangeTaskReusable,
      findDepotStreamInFlightRange: rangeTasks.findInFlightRange,
      depotStreamPrefetchTaskIsCurrent: rangeTasks.prefetchTaskIsCurrent,
      attachDepotStreamWorkerStdinErrorHandler: workerLifecycle.attachWorkerStdinErrorHandler,
      depotStreamWorkerProcessExited: workerLifecycle.workerProcessExited,
      killDepotStreamWorkerProcess: workerLifecycle.killWorkerProcess,
      clearDepotStreamWorkerForceKillTimer: workerLifecycle.clearWorkerForceKillTimer,
      scheduleDepotStreamWorkerForceKill: workerLifecycle.scheduleWorkerForceKill,
      attachDepotStreamWorkerLifecycleCleanup: workerLifecycle.attachWorkerLifecycleCleanup,
      scheduleDepotStreamTempCleanup: cacheMaintenance.scheduleTempCleanup,
      retryDepotStreamWorkerTempCleanups: cacheMaintenance.retryWorkerTempCleanups,
      activeTempFiles: cacheMaintenance.activeTempFiles,
      tempCleanupRetries: cacheMaintenance.tempCleanupRetries,
      tmpStaleMs: cacheMaintenance.tmpStaleMs,
      getEstimatedCacheBytes: cacheMaintenance.getEstimatedBytes,
      getAheadScheduleCount: () => aheadScheduleCount,
      getDemandEpoch: entry => demandEpochs.get(cacheFiles.depotStreamCacheDir(entry)) || 0,
      getGeneration: () => generation,
    },
  };
}

module.exports = { createDepotStreamService };
