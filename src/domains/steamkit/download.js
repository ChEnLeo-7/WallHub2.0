'use strict';

const { createDownloadAuth } = require('./download/auth');
const { createResumeProgress } = require('./download/resume');
const { createDownloadTaskRunner } = require('./download/taskRunner');
const { classifySteamKitControlPlaneOutput } = require('./download/controlPlane');
const {
  isSteamKitContentStageKey,
  steamKitIdleTimeoutForStage,
  steamKitIdleWatchdogState,
  steamKitPreSpawnWarmupTimeoutMs,
} = require('./download/watchdog');

function createSteamKitDownloadService(deps = {}) {
  const auth = createDownloadAuth(deps);
  const resume = createResumeProgress(deps);
  const taskRunner = createDownloadTaskRunner(deps, auth, resume);
  return {
    codedError: auth.codedError,
    steamKitNeedsOwnedAccount: auth.steamKitNeedsOwnedAccount,
    makeLoginRequiredError: auth.makeLoginRequiredError,
    makeGuardRequiredError: auth.makeGuardRequiredError,
    makeLoginFailedError: auth.makeLoginFailedError,
    makeNetworkError: auth.makeNetworkError,
    resolveLogin: auth.resolveLogin,
    canUseLogin: auth.canUseLogin,
    makeJsonProgressRequiredError: auth.makeJsonProgressRequiredError,
    buildArgs: auth.buildArgs,
    redactDepotArgs: auth.redactDepotArgs,
    normalizeOutput: taskRunner.normalizeOutput,
    normalizeError: auth.normalizeError,
    downloadViaSteamKit: taskRunner.downloadViaSteamKit,
    downloadWorkshopItem: taskRunner.downloadWorkshopItem,
  };
}

module.exports = {
  createSteamKitDownloadService,
  classifySteamKitControlPlaneOutput,
  isSteamKitContentStageKey,
  steamKitIdleTimeoutForStage,
  steamKitIdleWatchdogState,
  steamKitPreSpawnWarmupTimeoutMs,
};
