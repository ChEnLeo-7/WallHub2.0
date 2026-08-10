'use strict';

const {
  DEFAULT_REPOSITORY,
  parseVersion,
  compareVersions,
  normalizeRepository,
  normalizeArchitecture,
  detectInstallMode,
  releaseVersion,
  findReleaseAsset,
  selectReleaseAsset,
  parseChecksum,
  parseReleaseChecksum,
} = require('./releasePolicy');
const {
  assertTrustedGithubUrl,
  googlePingArgs,
  isLoopbackAddress,
  isAllowedWallhubHost,
  isWallhubReadAllowed,
  isUpdateMutationAllowed,
} = require('./routePolicy');
const { UPDATE_REQUEST_FILE, updaterLaunchRequest } = require('./installRequest');
const { pingGoogle, sha256File } = require('./githubClient');
const { spawnDetachedUpdater } = require('./updaterLauncher');
const { createUpdateService } = require('./serviceOperations');

module.exports = {
  DEFAULT_REPOSITORY,
  UPDATE_REQUEST_FILE,
  parseVersion,
  compareVersions,
  normalizeRepository,
  normalizeArchitecture,
  detectInstallMode,
  isLoopbackAddress,
  isAllowedWallhubHost,
  isWallhubReadAllowed,
  isUpdateMutationAllowed,
  releaseVersion,
  findReleaseAsset,
  selectReleaseAsset,
  assertTrustedGithubUrl,
  parseChecksum,
  parseReleaseChecksum,
  googlePingArgs,
  pingGoogle,
  sha256File,
  updaterLaunchRequest,
  spawnDetachedUpdater,
  createUpdateService,
};
