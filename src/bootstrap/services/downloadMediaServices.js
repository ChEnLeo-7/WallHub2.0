'use strict';

function assembleDownloadMediaServices(scope) {
  const { createCacheItemsService } = scope.require('./src/domains/downloads/cacheItems');
  const { createClientDownloadService } = scope.require('./src/domains/downloads/clientDownloads');
  const { createDownloadQueueService } = scope.require('./src/domains/downloads/queue');
  const { createDownloadFileSender } = scope.require('./src/domains/downloads/fileSender');
  const { createDownloadsController } = scope.require('./src/domains/downloads/controller');
  const { createMpkgConversionService } = scope.require('./src/domains/mpkg/conversion');
  const { createMpkgPreparationService } = scope.require('./src/domains/mpkg/preparation');
  const { createVideoController } = scope.require('./src/domains/video/controller');
  const { createDepotStreamService } = scope.require('./src/domains/steamkit/depotStream');
  const { jsonRes, send } = scope.require('./src/app/http');
  const {
    isSocksProxyProtocol,
    proxyAuth,
    connectViaSocksProxy,
  } = scope.require('./src/infrastructure/http/proxy');

  let cacheItemsService = null;
  let clientDownloadService = null;
  let downloadQueueService = null;
  let downloadsController = null;
  let mpkgService = null;
  let mpkgPreparationService = null;
  let videoController = null;

  scope.streamFileWithRange = (...args) => scope.getVideoController().streamFileWithRange(...args);
  scope.MPKG_BUILD_PROMISES = {
    has(buildKey) { return scope.getMpkgService().buildPromises.has(buildKey); },
  };
  scope.getCacheItemsService = () => {
    if (!cacheItemsService) {
      cacheItemsService = createCacheItemsService({
        getDownloadsDir: () => scope.state.downloadsDir,
        getWorkshopCacheDir: () => scope.state.workshopCacheDir,
        getSteamKitConfigDir: () => scope.STEAMKIT_CONFIG_DIR,
        getTaskQueue: () => scope.state.taskQueue,
        getMpkgBuildPromises: () => scope.MPKG_BUILD_PROMISES,
        getMpkgService: scope.getMpkgService,
        getFileDetails: scope.getFileDetails,
        getWorkshopContentDir: scope.getWorkshopContentDir,
        findFirstVideoInDir: scope.findFirstVideoInDir,
        isSceneWorkshopDir: scope.isSceneWorkshopDir,
        cleanText: scope.cleanText,
        detectVideoTag: scope.detectVideoTag,
        workshopTypeFromDetails: scope.workshopTypeFromDetails,
        streamFileWithRange: scope.streamFileWithRange,
        hasFilesRecursive: scope.hasFilesRecursive,
        ensureDir: scope.ensureDir,
        jsonRes,
        logger: console,
      });
    }
    return cacheItemsService;
  };
  scope.findCachedItemDir = id => scope.getCacheItemsService().findCachedItemDir(id);
  scope.isCacheItemTombstoned = id => scope.getCacheItemsService().isCacheItemTombstoned(id);
  scope.removePathWithRetry = target => scope.getCacheItemsService().removePathWithRetry(target);
  scope.deletePathIfInside = (target, roots) => scope.getCacheItemsService().deletePathIfInside(target, roots);
  scope.cleanupTaskFiles = task => scope.getCacheItemsService().cleanupTaskFiles(task);
  scope.cleanupRuntimeDownloadResidues = (appId = 431960, keepIds = []) => scope.getCacheItemsService().cleanupRuntimeDownloadResidues(appId, keepIds);
  scope.cleanupOrphanDepotDownloaderDownloads = (appId, keepIds) => scope.getCacheItemsService().cleanupOrphanDepotDownloaderDownloads(appId, keepIds);
  scope.runtimeResidueKeepIds = (excludeId = '') => scope.getCacheItemsService().runtimeResidueKeepIds(excludeId);

  scope.getDownloadQueueService = () => {
    if (!downloadQueueService) {
      downloadQueueService = createDownloadQueueService({
        getMaxConcurrentDownloads: scope.getMaxConcurrentDownloads,
        getFileDetails: scope.getFileDetails,
        safeName: scope.safeName,
        detectVideoTag: scope.detectVideoTag,
        workshopTypeFromDetails: scope.workshopTypeFromDetails,
        downloadWorkshopItem: scope.downloadWorkshopItem,
        dirSizeRecursive: scope.dirSizeRecursive,
        findCachedItemDir: scope.findCachedItemDir,
        isVideoExt: scope.isVideoExt,
        findFirstVideoInDir: scope.findFirstVideoInDir,
        onTaskCompleted: () => scope.getCacheItemsService().invalidateCacheSnapshot(),
        logger: console,
      });
      scope.state.downloadQueueService = downloadQueueService;
      scope.state.taskQueue = downloadQueueService.tasks;
    }
    return downloadQueueService;
  };
  scope.findQueueItemById = id => scope.getDownloadQueueService().findById(id);
  scope.createWorkshopQueueTask = (id, title, options = {}) => scope.getDownloadQueueService().createTask(id, title, options);
  scope.enforceTopOnlyQueueRunner = () => scope.getDownloadQueueService().enforceTopOnlyRunner();
  scope.findDownloadedItemPath = id => scope.getDownloadQueueService().findDownloadedPath(id);
  scope.triggerQueue = () => scope.getDownloadQueueService().trigger();

  const downloadFileSender = createDownloadFileSender({ fs: scope.fs });
  scope.sendDownloadFile = (req, res, filePath, fileName, options = {}) => downloadFileSender(req, res, filePath, fileName, options);
  scope.createPreparedDownload = (filePath, fileName, options = {}) => scope.PREPARED_DOWNLOAD_STORE.create(filePath, fileName, options);
  scope.sendPreparedDownload = (req, res, token, options = {}) => {
    const entry = scope.PREPARED_DOWNLOAD_STORE.consume(token);
    if (!entry) return jsonRes(res, 404, { error: 'Prepared download expired', code: 'DOWNLOAD_EXPIRED' });
    return scope.sendDownloadFile(req, res, entry.filePath, entry.fileName, Object.assign({}, options, { deleteAfterSend: false }));
  };
  scope.sendPathAsClientDownload = async (req, res, sourcePath, title, id) => {
    const prepared = await scope.getClientDownloadService().preparePathAsDownload(sourcePath, title, id);
    return scope.sendDownloadFile(req, res, prepared.filePath, prepared.fileName, { deleteAfterSend: prepared.deleteAfterSend });
  };

  const mpkgToolDir = scope.path.join(scope.TOOLS_DIR, 'mpkg');
  scope.getMpkgService = () => {
    if (!mpkgService) {
      mpkgService = createMpkgConversionService({
        toolDir: mpkgToolDir,
        toolScript: scope.path.join(mpkgToolDir, 'mobile_mpkg.py'),
        ensureDir: scope.ensureDir,
        commandExists: scope.commandExists,
        runProcess: scope.runProcess,
        sleep: scope.sleep,
        findDownloadedItemPath: scope.findDownloadedItemPath,
        createWorkshopQueueTask: scope.createWorkshopQueueTask,
        safeName: scope.safeName,
        isDebugEnabled: scope.mpkgDebugEnabled,
        getTextureProfile: () => process.env.WALLHUB_MPKG_TEXTURE_PROFILE || scope.state.videoCacheSettings.mpkgTextureProfile,
        logger: console,
      });
      scope.state.mpkgService = mpkgService;
    }
    return mpkgService;
  };
  scope.isSceneWorkshopDir = dir => scope.getMpkgService().isSceneWorkshopDir(dir);
  scope.prepareMpkgDownloadFile = (...args) => scope.getMpkgService().prepareDownloadFile(...args);
  scope.getMpkgPreparationService = () => {
    if (!mpkgPreparationService) {
      mpkgPreparationService = createMpkgPreparationService({ prepareDownloadFile: scope.prepareMpkgDownloadFile });
      scope.state.mpkgPreparationService = mpkgPreparationService;
    }
    return mpkgPreparationService;
  };
  scope.getClientDownloadService = () => {
    if (!clientDownloadService) {
      clientDownloadService = createClientDownloadService({
        ensureDir: scope.ensureDir,
        safeName: scope.safeName,
        zipDir: scope.zipDir,
        findDownloadedItemPath: scope.findDownloadedItemPath,
        createWorkshopQueueTask: scope.createWorkshopQueueTask,
        sleep: scope.sleep,
      });
    }
    return clientDownloadService;
  };
  scope.prepareClientDownloadFile = (id, title) => scope.getClientDownloadService().prepareDownloadFile(id, title);

  scope.getVideoController = () => {
    if (!videoController) {
      videoController = createVideoController({
        createDepotStreamService,
        userAgent: scope.UA,
        jsonRes,
        send,
        getVideoCacheSettings: () => scope.state.videoCacheSettings,
        effectiveDownloaderMode: scope.effectiveDownloaderMode,
        getServerStopping: () => scope.state.serverStopping,
        isCacheItemTombstoned: scope.isCacheItemTombstoned,
        getDownloadQueueService: scope.getDownloadQueueService,
        getTaskQueue: () => scope.state.taskQueue,
        createWorkshopQueueTask: scope.createWorkshopQueueTask,
        getWorkshopCacheDir: () => scope.state.workshopCacheDir,
        waitForStartupPreparationForDownload: scope.waitForStartupPreparationForDownload,
        getFileDetails: scope.getFileDetails,
        detectVideoTag: scope.detectVideoTag,
        isVideoExt: scope.isVideoExt,
        extFromUrl: scope.extFromUrl,
        extFromPath: scope.extFromPath,
        mimeFromExt: scope.mimeFromExt,
        getVideoMime: scope.getVideoMime,
        updateSteamCdnStatus: scope.updateSteamCdnStatus,
        updateSteamCdnStatusFromText: scope.updateSteamCdnStatusFromText,
        steamCdnStatusSnapshot: scope.steamCdnStatusSnapshot,
        getProxyCandidates: scope.getProxyCandidates,
        isSocksProxyProtocol,
        connectViaSocksProxy,
        proxyAuth,
        resolveDepotLogin: scope.resolveDepotLogin,
        steamKitNeedsOwnedAccount: scope.steamKitNeedsOwnedAccount,
        canUseDepotLogin: scope.canUseDepotLogin,
        makeSteamKitLoginRequiredError: scope.makeSteamKitLoginRequiredError,
        normalizeDepotError: scope.normalizeDepotError,
        shouldRetrySteamLoginRequiredError: scope.shouldRetrySteamLoginRequiredError,
        refreshPersistentSteamLoginForRetry: scope.refreshPersistentSteamLoginForRetry,
        codedError: scope.codedError,
        depotCommandFor: scope.depotCommandFor,
        getSteamKitStreamMaxDownloads: scope.getSteamKitStreamMaxDownloads,
        makeDepotLoginId: scope.makeDepotLoginId,
        getSteamContentCellId: scope.getSteamContentCellId,
        ensureDepotStreamDownloaderReady: scope.ensureDepotStreamDownloaderReady,
        ensureDir: scope.ensureDir,
        runProcess: scope.runProcess,
        buildSteamContentEnv: scope.buildSteamContentEnv,
        buildDepotDotnetEnv: scope.buildDepotDotnetEnv,
        getSteamCdnRouteStrategy: scope.getSteamCdnRouteStrategy,
        describeSteamCdnRouteStrategy: scope.describeSteamCdnRouteStrategy,
        fmtBytes: scope.fmtBytes,
        getDepotStreamCacheMaxBytes: scope.getDepotStreamCacheMaxBytes,
        hasFilesRecursive: scope.hasFilesRecursive,
        sleep: scope.sleep,
        logger: console,
        DEPOT_STREAM_PATCH_VERSION: scope.DEPOT_STREAM_PATCH_VERSION,
        DEPOT_CONFIG_DIR: scope.DEPOT_CONFIG_DIR,
        DEPOT_STREAM_CACHE_DIR: scope.DEPOT_STREAM_CACHE_DIR,
        DEPOT_STREAM_MAX_RANGE_BYTES: scope.DEPOT_STREAM_MAX_RANGE_BYTES,
        DEPOT_STREAM_FIRST_RANGE_BYTES: scope.DEPOT_STREAM_FIRST_RANGE_BYTES,
        DEPOT_STREAM_TAIL_BYTES: scope.DEPOT_STREAM_TAIL_BYTES,
        DEPOT_STREAM_INITIAL_BUFFER_BYTES: scope.DEPOT_STREAM_INITIAL_BUFFER_BYTES,
        DEPOT_STREAM_AHEAD_BYTES: scope.DEPOT_STREAM_AHEAD_BYTES,
        DEPOT_STREAM_WORKER_IDLE_MS: scope.DEPOT_STREAM_WORKER_IDLE_MS,
        DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK: scope.DEPOT_STREAM_CACHE_CLEANUP_HIGH_WATERMARK,
        DEPOT_STREAM_CACHE_CLEANUP_TARGET: scope.DEPOT_STREAM_CACHE_CLEANUP_TARGET,
        DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS: scope.DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS,
      });
    }
    return videoController;
  };
  scope.steamKitDepotStreamingEnabled = (...args) => scope.getVideoController().steamKitDepotStreamingEnabled(...args);
  scope.getDepotStreamService = (...args) => scope.getVideoController().getDepotStreamService(...args);
  scope.stopAllDepotStreamWorkers = (...args) => scope.getVideoController().stopAllDepotStreamWorkers(...args);
  scope.cleanupDepotStreamCache = (...args) => scope.getVideoController().cleanupDepotStreamCache(...args);
  scope.clearDepotStreamCacheNow = (...args) => scope.getVideoController().clearDepotStreamCacheNow(...args);
  scope.listCachedItems = (options = {}) => scope.getCacheItemsService().listCachedItems(options);
  scope.deleteCachedItemFiles = key => scope.getCacheItemsService().deleteCachedItemFiles(key);

  scope.getDownloadsController = () => {
    if (!downloadsController) {
      downloadsController = createDownloadsController({
        jsonRes,
        readBody: scope.require('./src/app/http').readBody,
        sendDownloadFile: scope.sendDownloadFile,
        sendPreparedDownload: scope.sendPreparedDownload,
        createPreparedDownload: scope.createPreparedDownload,
        prepareMpkgDownloadFile: scope.prepareMpkgDownloadFile,
        startMpkgPreparation: (id, title, profile) => scope.getMpkgPreparationService().start(id, title, profile),
        getMpkgPreparation: (id, profile) => scope.getMpkgPreparationService().get(id, profile),
        serializeMpkgPreparation: job => scope.getMpkgPreparationService().toPublic(job),
        prepareClientDownloadFile: scope.prepareClientDownloadFile,
        findDownloadedItemPath: scope.findDownloadedItemPath,
        findQueueItemById: scope.findQueueItemById,
        sendPathAsClientDownload: scope.sendPathAsClientDownload,
        getTaskQueue: () => scope.getDownloadQueueService().tasks,
        createWorkshopQueueTask: scope.createWorkshopQueueTask,
        getDownloadQueueService: scope.getDownloadQueueService,
        listCachedItems: scope.listCachedItems,
        isCacheItemTombstoned: scope.isCacheItemTombstoned,
        handleCachedItemDelete: (...args) => scope.getCacheItemsService().handleCachedItemDelete(...args),
        deleteCachedItemFiles: scope.deleteCachedItemFiles,
        getCacheItemsService: scope.getCacheItemsService,
        cleanupTaskFiles: scope.cleanupTaskFiles,
        cleanupOrphanDepotDownloaderDownloads: scope.cleanupOrphanDepotDownloaderDownloads,
        triggerQueue: scope.triggerQueue,
        enforceTopOnlyQueueRunner: scope.enforceTopOnlyQueueRunner,
        sleep: scope.sleep,
        isDebugEnabled: scope.mpkgDebugEnabled,
        logger: console,
      });
    }
    return downloadsController;
  };
}

module.exports = { assembleDownloadMediaServices };
