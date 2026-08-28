'use strict';

const { assembleBootstrapHelpers } = require('./bootstrapHelpers');

function assembleSteamKitDownloadServices(scope) {
  assembleBootstrapHelpers(scope);
  const { createSteamKitDownloadService } = scope.require('./src/domains/steamkit/download');
  const depotTools = scope.depotTools;

  scope.getDownloadItemDir = publishedFileId => {
    const id = String(publishedFileId || '').replace(/[^\d]/g, '');
    if (!id) throw new Error('Invalid workshop id');
    return scope.path.join(scope.state.downloadsDir, id);
  };
  scope.finalizeWorkshopItem = (sourceDir, publishedFileId) => {
    if (!sourceDir || !scope.fs.existsSync(sourceDir)) throw new Error('Downloaded workshop directory not found');
    const destDir = scope.getDownloadItemDir(publishedFileId);
    scope.ensureDir(scope.state.downloadsDir);
    const sourceResolved = scope.path.resolve(sourceDir);
    const destResolved = scope.path.resolve(destDir);
    if (sourceResolved !== destResolved) {
      if (scope.fs.existsSync(destDir)) scope.removePathWithRetry(destDir);
      scope.copyDirContents(sourceDir, destDir);
      try {
        if (!sourceResolved.startsWith(scope.path.resolve(scope.state.downloadsDir) + scope.path.sep)) scope.removePathWithRetry(sourceDir);
      } catch {}
    }
    return destDir;
  };
  scope.pickVideoFile = itemDir => {
    if (!scope.fs.existsSync(itemDir)) return null;
    const extensions = ['.mp4', '.webm', '.avi', '.wmv', '.mkv', '.mov', '.m4v'];
    const rank = new Map(extensions.map((extension, index) => [extension, index]));
    const files = scope.listFilesRecursive(itemDir)
      .map(filePath => ({ filePath, ext: scope.path.extname(filePath).toLowerCase(), size: scope.fs.statSync(filePath).size }))
      .filter(file => rank.has(file.ext));
    if (!files.length) return null;
    files.sort((a, b) => (rank.get(a.ext) - rank.get(b.ext)) || (b.size - a.size));
    return files[0].filePath;
  };
  scope.makeDepotLoginId = seed => depotTools.makeDepotLoginId(seed);
  scope.isDepotAuthFailureMessage = message => depotTools.isDepotAuthFailureMessage(message);
  scope.isDepotGuardRequiredMessage = message => depotTools.isDepotGuardRequiredMessage(message);
  scope.isDepotNetworkFailureMessage = message => depotTools.isDepotNetworkFailureMessage(message);
  scope.isDepotLoginVerifiedDespiteCanceled = message => depotTools.isDepotLoginVerifiedDespiteCanceled(message);

  let service = null;
  scope.getSteamKitDownloadService = () => {
    if (!service) {
      service = createSteamKitDownloadService({
        STEAM_CREDENTIALS: scope.STEAM_CREDENTIALS,
        DEPOT_CONFIG_DIR: scope.DEPOT_CONFIG_DIR,
        STEAMKIT_CONFIG_DIR: scope.STEAMKIT_CONFIG_DIR,
        ensureDir: scope.ensureDir,
        hasFilesRecursive: scope.hasFilesRecursive,
        copyDirContents: scope.copyDirContents,
        removePathWithRetry: scope.removePathWithRetry,
        getDownloadItemDir: scope.getDownloadItemDir,
        finalizeWorkshopItem: scope.finalizeWorkshopItem,
        deletePathIfInside: scope.deletePathIfInside,
        cleanupRuntimeDownloadResidues: scope.cleanupRuntimeDownloadResidues,
        runtimeResidueKeepIds: scope.runtimeResidueKeepIds,
        pickVideoFile: scope.pickVideoFile,
        extFromPath: scope.extFromPath,
        safeName: scope.safeName,
        waitForStartupPreparationForDownload: scope.waitForStartupPreparationForDownload,
        warmupSteamAccessControlPlane: scope.warmupSteamAccessGatewayControlPlane,
        markSteamAccessControlPlaneFailure: scope.markSteamAccessControlPlaneFailure,
        shouldRetrySteamLoginRequiredError: scope.shouldRetrySteamLoginRequiredError,
        refreshPersistentSteamLoginForRetry: scope.refreshPersistentSteamLoginForRetry,
        setValidatedPersistentLogin: scope.setValidatedPersistentLogin,
        depotDotnetMissingMessage: scope.depotDotnetMissingMessage,
        isDepotNetworkFailureMessage: scope.isDepotNetworkFailureMessage,
        isDepotAuthFailureMessage: scope.isDepotAuthFailureMessage,
        isDepotGuardRequiredMessage: scope.isDepotGuardRequiredMessage,
        isDepotLoginVerifiedDespiteCanceled: scope.isDepotLoginVerifiedDespiteCanceled,
        depotCommandFor: scope.depotCommandFor,
        getSteamKitMaxDownloads: scope.getSteamKitMaxDownloads,
        makeDepotLoginId: scope.makeDepotLoginId,
        getSteamContentCellId: scope.getSteamContentCellId,
        ensureDepotDownloaderReady: scope.ensureDepotDownloaderReady,
        createWallhubDepotProgressReader: scope.createWallhubDepotProgressReader,
        createWallhubDepotCdnLogReader: scope.createWallhubDepotCdnLogReader,
        appendTaskProcessOutput: scope.appendTaskProcessOutput,
        applyTaskByteProgress: scope.applyTaskByteProgress,
        runProcess: scope.runProcess,
        buildSteamContentEnv: scope.buildSteamContentEnv,
        buildDepotDotnetEnv: scope.buildDepotDotnetEnv,
        describeSteamCdnRouteStrategy: scope.describeSteamCdnRouteStrategy,
        logger: scope.debugLogger,
      });
      scope.state.steamKitDownloadService = service;
    }
    return service;
  };
  scope.codedError = (...args) => scope.getSteamKitDownloadService().codedError(...args);
  scope.steamKitNeedsOwnedAccount = appId => scope.getSteamKitDownloadService().steamKitNeedsOwnedAccount(appId);
  scope.makeSteamKitLoginRequiredError = () => scope.getSteamKitDownloadService().makeLoginRequiredError();
  scope.resolveDepotLogin = appId => scope.getSteamKitDownloadService().resolveLogin(appId);
  scope.canUseDepotLogin = login => scope.getSteamKitDownloadService().canUseLogin(login);
  scope.makeSteamKitJsonProgressRequiredError = () => scope.getSteamKitDownloadService().makeJsonProgressRequiredError();
  scope.normalizeDepotError = error => scope.getSteamKitDownloadService().normalizeError(error);
  scope.downloadWorkshopItem = (...args) => scope.getSteamKitDownloadService().downloadWorkshopItem(...args);
  scope.markSteamAccessControlPlaneFailure = (host, ip, error, meta = {}) => {
    const hostname = String(host || '').trim().toLowerCase();
    const address = String(ip || '').trim();
    if (!hostname || !address) return;
    const reason = String(error && error.message || error || 'depotdownloader-webapi-failed');
    scope.STEAM_ACCESS_GATEWAY.routeStore.cooldown(hostname, address, reason, 10 * 60 * 1000, Object.assign({
      source: 'depotdownloader', stage: 'steamkit-webapi',
    }, meta || {}));
    scope.STEAM_ACCESS_GATEWAY.removeCachedIp(hostname, Number(meta && meta.port) || 443, address);
    if (scope.STEAM_ACCESS_GATEWAY.logger && scope.STEAM_ACCESS_GATEWAY.logger.warn) {
      scope.STEAM_ACCESS_GATEWAY.logger.warn(`[SteamAccess] cooled SteamKit WebAPI route ${hostname} ${address}: ${reason}`);
    }
  };
}

module.exports = { assembleSteamKitDownloadServices };
