'use strict';

const fs = require('fs');
const path = require('path');
const {
  DEFAULT_REPOSITORY,
  compareVersions,
  normalizeRepository,
  detectInstallMode,
  releaseVersion,
  findReleaseAsset,
  selectReleaseAsset,
  parseChecksum,
  parseReleaseChecksum,
} = require('./releasePolicy');
const { updaterLaunchRequest } = require('./installRequest');
const { MAX_UPDATE_ASSET_BYTES, sha256File, createGithubClient } = require('./githubClient');
const { createDownloadScheduler } = require('./downloadScheduler');
const { spawnDetachedUpdater } = require('./updaterLauncher');

function createUpdateService(options = {}) {
  const logger = options.logger || console;
  const env = options.env || process.env;
  const projectRoot = path.resolve(options.projectRoot || process.cwd());
  const currentVersion = String(options.currentVersion || '0.0.0').replace(/^v/i, '');
  const repository = normalizeRepository(options.repository || env.WALLHUB_UPDATE_REPOSITORY || DEFAULT_REPOSITORY);
  const mode = options.mode || detectInstallMode({ env });
  const platform = options.platform || process.platform;
  const arch = options.arch || process.arch;
  const updateDir = options.updateDir || path.join(projectRoot, 'updates');
  const hashFile = options.hashFile || sha256File;
  const getAutoUpdateEnabled = options.getAutoUpdateEnabled || (() => false);
  const getProxyUrl = options.getProxyUrl || (() => '');
  const isInstallSafe = options.isInstallSafe || (() => true);
  const onInstallStarting = options.onInstallStarting || (() => {});
  const onInstallCancelled = options.onInstallCancelled || (() => {});
  const onInstallPrepared = options.onInstallPrepared || (() => {});
  const github = createGithubClient({
    env,
    logger,
    platform,
    requestBuffer: options.requestBuffer,
    downloadFile: options.downloadFile,
    checkGoogleReachability: options.checkGoogleReachability,
    acceleratorMode: options.githubAcceleratorMode,
    getProxyUrl,
    userAgent: `WallHub/${currentVersion}`,
  });
  let state = {
    currentVersion,
    latestVersion: '',
    status: 'idle',
    progress: 0,
    downloadedBytes: 0,
    totalBytes: 0,
    updateAvailable: false,
    checkedAt: 0,
    updatedAt: Date.now(),
    releaseUrl: '',
    releaseNotes: '',
    mode,
    platform,
    arch,
    canDownload: false,
    canInstall: false,
    dockerAutoUpdate: mode === 'docker' && env.WALLHUB_DOCKER_AUTO_UPDATE === '1',
    assetName: '',
    error: '',
    errorCode: '',
  };
  let release = null;
  let selectedAsset = null;
  let downloadedPath = '';
  let downloadedHash = '';
  let checkPromise = null;
  let downloadPromise = null;
  let installStarted = false;

  function setState(patch) {
    state = Object.assign({}, state, patch, { updatedAt: Date.now() });
    return snapshot();
  }

  function snapshot() {
    return Object.assign({}, state, { autoUpdateEnabled: !!getAutoUpdateEnabled() });
  }

  async function performCheck() {
    setState({ status: 'checking', progress: 0, error: '', errorCode: '' });
    const apiUrl = `https://api.github.com/repos/${repository}/releases/latest`;
    await github.selectRoutes(repository);
    let nextRelease = null;
    await github.requestTrustedBuffer(apiUrl, { timeoutMs: 30000 }, body => {
      nextRelease = JSON.parse(body.toString('utf8'));
    });
    if (nextRelease.draft || nextRelease.prerelease) throw new Error('GitHub returned a non-stable release');
    const latestVersion = releaseVersion(nextRelease);
    if (!latestVersion) throw new Error('Latest GitHub release does not use a semantic version tag');
    const updateAvailable = compareVersions(latestVersion, currentVersion) > 0;
    release = nextRelease;
    selectedAsset = updateAvailable ? selectReleaseAsset(nextRelease, { mode, platform, arch }) : null;
    downloadedPath = '';
    downloadedHash = '';
    const canDownload = !!selectedAsset;
    const status = updateAvailable ? (canDownload || mode === 'docker' ? 'available' : 'unsupported') : 'up-to-date';
    return setState({
      latestVersion,
      status,
      progress: status === 'up-to-date' ? 100 : 0,
      updateAvailable,
      checkedAt: Date.now(),
      releaseUrl: String(nextRelease.html_url || ''),
      releaseNotes: String(nextRelease.body || '').slice(0, 12000),
      canDownload,
      canInstall: false,
      assetName: selectedAsset ? selectedAsset.name : '',
      totalBytes: selectedAsset ? selectedAsset.size : 0,
      downloadedBytes: 0,
      error: '',
      errorCode: status === 'unsupported' ? 'UPDATE_ASSET_UNAVAILABLE' : '',
    });
  }

  async function checkNow(checkOptions = {}) {
    const maxAgeMs = Number(checkOptions.maxAgeMs || 0);
    if (maxAgeMs > 0 && state.checkedAt > 0 && Date.now() - state.checkedAt < maxAgeMs) return snapshot();
    if (downloadPromise && !checkOptions.allowDuringDownload) {
      await downloadPromise.catch(() => {});
      return checkNow(checkOptions);
    }
    if (checkPromise) return checkPromise;
    checkPromise = performCheck()
      .catch(error => {
        setState({ status: 'error', error: error.message || String(error), errorCode: 'UPDATE_CHECK_FAILED' });
        throw error;
      })
      .finally(() => { checkPromise = null; });
    return checkPromise;
  }

  async function resolveExpectedHash(downloadRelease, downloadAsset) {
    let expectedHash = parseReleaseChecksum(downloadRelease.body, downloadAsset.name);
    if (expectedHash) return expectedHash;
    const checksumAsset = findReleaseAsset(downloadRelease, downloadAsset.checksumName);
    if (!checksumAsset || !checksumAsset.browser_download_url) {
      const error = new Error(`Missing Release checksum for ${downloadAsset.name}`);
      error.code = 'UPDATE_CHECKSUM_UNAVAILABLE';
      throw error;
    }
    await github.requestTrustedBuffer(checksumAsset.browser_download_url, { timeoutMs: 30000, maxBytes: 4096 }, body => {
      expectedHash = parseChecksum(body, downloadAsset.name);
    });
    return expectedHash;
  }

  async function performDownload() {
    if (!release || !state.updateAvailable) await checkNow({ allowDuringDownload: true });
    if (!state.updateAvailable) return snapshot();
    const downloadRelease = release;
    const downloadAsset = selectedAsset;
    const downloadVersion = state.latestVersion;
    if (!downloadAsset) {
      const error = new Error(mode === 'docker' ? 'Docker updates are applied by the container updater' : 'No update asset is available for this installation');
      error.code = mode === 'docker' ? 'UPDATE_DOCKER_EXTERNAL' : 'UPDATE_ASSET_UNAVAILABLE';
      throw error;
    }
    if (!Number.isFinite(downloadAsset.size) || downloadAsset.size <= 0 || downloadAsset.size > MAX_UPDATE_ASSET_BYTES) {
      const error = new Error('The update asset has an invalid or unsupported size');
      error.code = 'UPDATE_ASSET_SIZE_INVALID';
      throw error;
    }
    setState({ status: 'downloading', progress: 0, downloadedBytes: 0, error: '', errorCode: '' });
    const expectedHash = await resolveExpectedHash(downloadRelease, downloadAsset);
    const destination = path.join(updateDir, `v${downloadVersion}`, downloadAsset.name);
    await github.downloadTrustedFile(downloadAsset.url, destination, {
      timeoutMs: 30 * 60 * 1000,
      totalBytes: downloadAsset.size,
      maxBytes: MAX_UPDATE_ASSET_BYTES,
      onProgress(downloadedBytes, totalBytes) {
        const progress = totalBytes > 0 ? Math.min(99, Math.floor(downloadedBytes * 100 / totalBytes)) : 0;
        setState({ status: 'downloading', progress, downloadedBytes, totalBytes });
      },
    }, async filePath => {
      const actualHash = String(await hashFile(filePath)).toLowerCase();
      if (actualHash === expectedHash) return;
      try { fs.rmSync(filePath, { force: true }); } catch {}
      const error = new Error('Downloaded update failed SHA-256 verification');
      error.code = 'UPDATE_CHECKSUM_MISMATCH';
      throw error;
    });
    downloadedPath = destination;
    downloadedHash = expectedHash;
    return setState({
      status: 'downloaded',
      progress: 100,
      downloadedBytes: fs.statSync(destination).size,
      canInstall: true,
      error: '',
      errorCode: '',
    });
  }

  function beginDownload() {
    if (downloadPromise) return downloadPromise;
    const operation = performDownload()
      .catch(error => {
        setState({ status: 'error', error: error.message || String(error), errorCode: error.code || 'UPDATE_DOWNLOAD_FAILED', canInstall: false });
        throw error;
      })
      .finally(() => {
        if (downloadPromise === operation) downloadPromise = null;
      });
    downloadPromise = operation;
    return operation;
  }

  function startDownload() {
    beginDownload().catch(error => {
      logger.warn('[Update] Download failed:', error.message || error);
    });
    return snapshot();
  }

  function installDownloaded() {
    if (installStarted) return snapshot();
    if (!downloadedPath || state.status !== 'downloaded') {
      const error = new Error('Download and verify the update before installing it');
      error.code = 'UPDATE_NOT_DOWNLOADED';
      throw error;
    }
    if (!isInstallSafe()) {
      const error = new Error('WallHub is busy; finish active downloads or conversions before installing the update');
      error.code = 'UPDATE_BUSY';
      throw error;
    }
    const request = updaterLaunchRequest({
      archive: downloadedPath,
      projectRoot,
      mode,
      targetVersion: state.latestVersion,
      expectedHash: downloadedHash,
      expectedSize: selectedAsset && selectedAsset.size,
      supervised: !!options.supervised,
      launcherPid: env.WALLHUB_LAUNCHER_PID,
      port: env.PORT,
    });
    onInstallStarting(request);
    let launcher;
    try {
      launcher = (options.spawnUpdater || spawnDetachedUpdater)(request, {
        scriptPath: options.updaterScript || path.join(projectRoot, 'tools', 'update', 'apply-update.js'),
        env: (() => {
          const proxyUrl = String(getProxyUrl() || '').trim();
          return proxyUrl ? { WALLHUB_UPDATE_NPM_PROXY: proxyUrl } : undefined;
        })(),
      });
    } catch (error) {
      onInstallCancelled(request);
      throw error;
    }
    installStarted = true;
    setState({ status: 'installing', progress: 100, canInstall: false, error: '', errorCode: '' });
    logger.log(`[Update] Installer helper started pid=${launcher.pid || '-'} target=v${state.latestVersion}`);
    const readinessDeadline = Date.now() + 10000;
    const waitForReadiness = () => {
      try {
        const marker = JSON.parse(fs.readFileSync(request.markerFile, 'utf8'));
        if (Number(marker.helperPid) === Number(launcher.pid)) {
          onInstallPrepared(request);
          return;
        }
      } catch {}
      if (Date.now() < readinessDeadline) {
        setTimeout(waitForReadiness, 100).unref?.();
        return;
      }
      setState({
        status: 'error',
        canInstall: true,
        error: 'The update helper did not become ready; WallHub was not stopped',
        errorCode: 'UPDATE_HELPER_START_FAILED',
      });
      try {
        if (!fs.existsSync(path.join(projectRoot, 'updates', 'update-transaction.json'))) fs.rmSync(request.markerFile, { force: true });
      } catch {}
      installStarted = false;
      onInstallCancelled(request);
    };
    setTimeout(waitForReadiness, 50).unref?.();
    return snapshot();
  }

  async function runAutomatic() {
    try {
      await checkNow({ maxAgeMs: 5 * 60 * 1000 });
      if (!getAutoUpdateEnabled() || !state.updateAvailable || mode === 'docker' || !selectedAsset) return snapshot();
      await beginDownload();
      if (getAutoUpdateEnabled() && isInstallSafe()) installDownloaded();
      return snapshot();
    } catch (error) {
      logger.warn('[Update] Automatic update deferred:', error.message || error);
      return snapshot();
    }
  }

  const scheduler = createDownloadScheduler({
    runAutomatic,
    getAutoUpdateEnabled,
    initialDelayMs: options.initialDelayMs,
    checkIntervalMs: options.checkIntervalMs,
  });

  return {
    snapshot,
    checkNow,
    startDownload,
    installDownloaded,
    runAutomatic,
    schedule: scheduler.schedule,
    scheduleSoon: scheduler.scheduleSoon,
    stopSchedule: scheduler.stopSchedule,
    _waitForDownload: () => (downloadPromise || Promise.resolve(snapshot())).catch(() => snapshot()),
  };
}

module.exports = {
  createUpdateService,
};
