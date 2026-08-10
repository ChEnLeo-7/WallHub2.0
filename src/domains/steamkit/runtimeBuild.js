'use strict';

const { createBuildEnvironment } = require('./download/runtimeBuild/environment');
const { createSourceDownload } = require('./download/runtimeBuild/source');
const { createRuntimeValidation } = require('./download/runtimeBuild/validation');
const { createRuntimePublisher } = require('./download/runtimeBuild/publish');
const { createRuntimeStartup } = require('./download/runtimeBuild/startup');

function createSteamKitRuntimeBuildService(deps) {
  if (typeof deps.ensureDir !== 'function') throw new Error('ensureDir is required');
  if (typeof deps.runProcess !== 'function') throw new Error('runProcess is required');
  if (typeof deps.updateRuntimeSetup !== 'function') throw new Error('updateRuntimeSetup is required');

  const environment = createBuildEnvironment(deps);
  const source = createSourceDownload(deps, environment);
  const validation = createRuntimeValidation(deps, environment);
  const publisher = createRuntimePublisher(deps, environment, source, validation);
  const startup = createRuntimeStartup(deps, validation, publisher);

  return {
    prepareRuntimeOnStartup: startup.prepareRuntimeOnStartup,
    waitForStartupPreparationForDownload: startup.waitForStartupPreparationForDownload,
    cleanupLegacyDepotJsonProgressDir: validation.cleanupLegacyDepotJsonProgressDir,
    commandExists: environment.commandExists,
    pathLooksExecutable: validation.pathLooksExecutable,
    depotExecutableNames: validation.depotExecutableNames,
    resolveDepotDownloaderPath: validation.resolveDepotDownloaderPath,
    resolveDepotRuntimePath: validation.resolveDepotRuntimePath,
    resolveDepotJsonProgressDownloaderPath: validation.resolveDepotJsonProgressDownloaderPath,
    resolveDepotStreamDownloaderPath: validation.resolveDepotStreamDownloaderPath,
    findDepotDownloaderRecursive: validation.findDepotDownloaderRecursive,
    parseCsvEnv: source.parseCsvEnv,
    isGithubDownloadUrl: source.isGithubDownloadUrl,
    buildGithubProxyUrl: source.buildGithubProxyUrl,
    githubProxyCandidates: source.githubProxyCandidates,
    checkGoogleReachability: source.checkGoogleReachability,
    chooseGithubDownloadRoutes: source.chooseGithubDownloadRoutes,
    downloadFileBuffer: source.downloadFileBuffer,
    downloadGithubRouteToFile: source.downloadGithubRouteToFile,
    looksLikeZipBuffer: source.looksLikeZipBuffer,
    parseVersionParts: environment.parseVersionParts,
    formatMajorMinor: environment.formatMajorMinor,
    findDepotRuntimeConfig: validation.findDepotRuntimeConfig,
    getDepotRequiredDotnetVersion: validation.getDepotRequiredDotnetVersion,
    getInstalledDotnetRuntimeVersions: environment.getInstalledDotnetRuntimeVersions,
    resolveDotnetRoot: environment.resolveDotnetRoot,
    getInstalledDotnetSdkVersions: environment.getInstalledDotnetSdkVersions,
    dotnetRuntimeSatisfies: environment.dotnetRuntimeSatisfies,
    dotnetMajorInstalled: environment.dotnetMajorInstalled,
    dotnet9InstallMessage: environment.dotnet9InstallMessage,
    assertDotnet9BuildEnvironment: environment.assertDotnet9BuildEnvironment,
    buildDepotDotnetBuildEnv: environment.buildDepotDotnetBuildEnv,
    buildDepotPublishArgs: environment.buildDepotPublishArgs,
    warmupDotnetForDepotBuild: environment.warmupDotnetForDepotBuild,
    depotDotnetMissingMessage: environment.depotDotnetMissingMessage,
    assertDepotDotnetRuntimeReady: validation.assertDepotDotnetRuntimeReady,
    extractZip: source.extractZip,
    findFileRecursive: source.findFileRecursive,
    findRecoverableDepotBuildOutput: publisher.findRecoverableDepotBuildOutput,
    recoverDepotRuntimeFromBuildOutput: publisher.recoverDepotRuntimeFromBuildOutput,
    isRecoverableDotnetPostBuildCrash: publisher.isRecoverableDotnetPostBuildCrash,
    depotJsonProgressStampPath: validation.depotJsonProgressStampPath,
    depotStreamStampPath: validation.depotStreamStampPath,
    depotRuntimeStampCandidates: validation.depotRuntimeStampCandidates,
    depotRuntimeStampMatches: validation.depotRuntimeStampMatches,
    depotJsonProgressBuildReady: validation.depotJsonProgressBuildReady,
    depotStreamBuildReady: validation.depotStreamBuildReady,
    replaceSourceOnce: publisher.replaceSourceOnce,
    replaceSourceRegexOnce: publisher.replaceSourceRegexOnce,
    patchDepotDownloaderForJsonProgress: publisher.patchDepotDownloaderForJsonProgress,
    buildPatchedDepotDownloaderRuntime: publisher.buildPatchedDepotDownloaderRuntime,
    buildJsonProgressDepotDownloader: publisher.buildJsonProgressDepotDownloader,
    buildDepotStreamDownloader: publisher.buildDepotStreamDownloader,
    ensureJsonProgressDepotDownloaderReady: publisher.ensureJsonProgressDepotDownloaderReady,
    ensureDepotStreamDownloaderReady: publisher.ensureDepotStreamDownloaderReady,
    warmupDepotStreamDownloader: publisher.warmupDepotStreamDownloader,
    ensureDepotDownloaderReady: publisher.ensureDepotDownloaderReady,
    depotCommandFor: environment.depotCommandFor,
    assertDepotExecutableStarts: environment.assertDepotExecutableStarts,
    buildDepotDotnetEnv: environment.buildDepotDotnetEnv,
  };
}

module.exports = { createSteamKitRuntimeBuildService };
