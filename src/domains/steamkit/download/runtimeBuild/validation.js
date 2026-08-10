'use strict';

const fs = require('fs');
const path = require('path');
const { createDepotRuntimePaths } = require('../../depotRuntimePaths');

function createRuntimeValidation(deps, buildEnvironment) {
  const {
    env = process.env,
    logger = console,
    STEAMKIT_ROOT,
    DEPOT_DOWNLOADER_DIR,
    DEPOT_STREAM_DOWNLOADER_DIR,
    DEPOT_JSON_PROGRESS_DIR,
    DEPOT_JSON_PROGRESS_PATCH_VERSION,
    DEPOT_STREAM_PATCH_VERSION,
    isTermuxLikeEnv,
    isAndroidHostLikeEnv,
    shouldRejectDepotAppHostForAndroid,
  } = deps;
  const depotRuntimePaths = createDepotRuntimePaths({ isTermuxLikeEnv, isAndroidHostLikeEnv, logger });

  function pathLooksExecutable(file) {
    return depotRuntimePaths.pathLooksExecutable(file);
  }

  function depotExecutableNames() {
    return depotRuntimePaths.depotExecutableNames();
  }

  function resolveDepotDownloaderPath() {
    return depotRuntimePaths.resolveDepotDownloaderPath({
      directPath: env.DEPOTDOWNLOADER_PATH,
      downloaderDir: DEPOT_DOWNLOADER_DIR,
    });
  }

  function resolveDepotRuntimePath(runtimeDir, directPath, options = {}) {
    return depotRuntimePaths.resolveDepotRuntimePath(runtimeDir, directPath, options);
  }

  function depotJsonProgressStampPath() {
    return path.join(DEPOT_JSON_PROGRESS_DIR, '.wallhub-json-progress-build.json');
  }

  function depotStreamStampPath() {
    return path.join(DEPOT_STREAM_DOWNLOADER_DIR, '.wallhub-stream-build.json');
  }

  function resolveDepotJsonProgressDownloaderPath(options = {}) {
    return resolveDepotRuntimePath(
      DEPOT_JSON_PROGRESS_DIR,
      env.WALLHUB_DEPOT_JSON_PROGRESS_PATH,
      Object.assign({ stampPath: depotJsonProgressStampPath(), patchVersion: DEPOT_JSON_PROGRESS_PATCH_VERSION }, options)
    );
  }

  function resolveDepotStreamDownloaderPath(options = {}) {
    return resolveDepotRuntimePath(
      DEPOT_STREAM_DOWNLOADER_DIR,
      env.WALLHUB_DEPOT_STREAM_PATH,
      Object.assign({ stampPath: depotStreamStampPath(), patchVersion: DEPOT_STREAM_PATCH_VERSION }, options)
    );
  }

  function findDepotDownloaderRecursive(root) {
    return depotRuntimePaths.findDepotDownloaderRecursive(root);
  }

  function findDepotRuntimeConfig(executable) {
    return depotRuntimePaths.findDepotRuntimeConfig(executable);
  }

  function getDepotRequiredDotnetVersion(executable) {
    return depotRuntimePaths.getDepotRequiredDotnetVersion(executable);
  }

  function cleanupLegacyDepotJsonProgressDir() {
    const legacyDir = path.join(STEAMKIT_ROOT, 'DepotDownloaderJsonProgress');
    if (path.resolve(legacyDir) === path.resolve(DEPOT_DOWNLOADER_DIR) || !fs.existsSync(legacyDir)) return;
    try {
      fs.rmSync(legacyDir, { recursive: true, force: true });
      logger.log(`[SteamKit] Removed legacy JSON progress runtime directory: ${legacyDir}`);
    } catch (error) {
      logger.warn('[SteamKit] Failed to remove legacy JSON progress runtime:', error.message);
    }
  }

  function depotRuntimeStampCandidates(executable, fallbackStampPath) {
    return depotRuntimePaths.depotRuntimeStampCandidates(executable, fallbackStampPath);
  }

  function depotRuntimeStampMatches(executable, fallbackStampPath, patchVersion) {
    return depotRuntimePaths.depotRuntimeStampMatches(executable, fallbackStampPath, patchVersion);
  }

  function buildReady(resolvePath, stampPath, patchVersion, label) {
    const executable = resolvePath();
    if (!executable) return '';
    if (shouldRejectDepotAppHostForAndroid() && path.extname(executable).toLowerCase() !== '.dll') {
      logger.warn(`[SteamKit] Existing Termux ${label} apphost is not portable, rebuilding as framework DLL.`);
      return '';
    }
    return depotRuntimeStampMatches(executable, stampPath, patchVersion) ? executable : '';
  }

  function depotJsonProgressBuildReady() {
    return buildReady(resolveDepotJsonProgressDownloaderPath, depotJsonProgressStampPath(), DEPOT_JSON_PROGRESS_PATCH_VERSION, 'DepotDownloader');
  }

  function depotStreamBuildReady() {
    return buildReady(resolveDepotStreamDownloaderPath, depotStreamStampPath(), DEPOT_STREAM_PATCH_VERSION, 'DepotDownloader stream');
  }

  function assertDepotDotnetRuntimeReady(executable) {
    return buildEnvironment.assertDepotDotnetRuntimeReady(executable, getDepotRequiredDotnetVersion);
  }

  return {
    pathLooksExecutable,
    depotExecutableNames,
    resolveDepotDownloaderPath,
    resolveDepotRuntimePath,
    resolveDepotJsonProgressDownloaderPath,
    resolveDepotStreamDownloaderPath,
    findDepotDownloaderRecursive,
    findDepotRuntimeConfig,
    getDepotRequiredDotnetVersion,
    cleanupLegacyDepotJsonProgressDir,
    depotJsonProgressStampPath,
    depotStreamStampPath,
    depotRuntimeStampCandidates,
    depotRuntimeStampMatches,
    depotJsonProgressBuildReady,
    depotStreamBuildReady,
    assertDepotDotnetRuntimeReady,
  };
}

module.exports = { createRuntimeValidation };
