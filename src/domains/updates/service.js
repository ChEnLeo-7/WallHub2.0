'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const DEFAULT_REPOSITORY = 'ChEnLeo-7/WallHub2.0';
const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const MAX_RELEASE_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_UPDATE_ASSET_BYTES = 4 * 1024 * 1024 * 1024;
const UPDATE_REQUEST_FILE = 'update-request.json';

function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`Invalid semantic version: ${!a ? left : right}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

function normalizeRepository(value) {
  const repository = String(value || DEFAULT_REPOSITORY).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('Invalid GitHub repository');
  }
  return repository;
}

function normalizeArchitecture(arch) {
  if (arch === 'x64') return 'x64';
  if (arch === 'arm64') return 'arm64';
  return String(arch || 'unknown');
}

function detectInstallMode(options = {}) {
  const env = options.env || process.env;
  if (env.DOCKER_CONTAINER || env.CONTAINER || env.KUBERNETES_SERVICE_HOST) return 'docker';
  if (env.WALLHUB_LAUNCHER === '1') return 'portable';
  return 'source';
}

function releaseVersion(release) {
  const tag = String(release && release.tag_name || '').trim();
  const parsed = parseVersion(tag);
  return parsed ? tag.replace(/^v/i, '') : '';
}

function findReleaseAsset(release, name) {
  return Array.isArray(release && release.assets)
    ? release.assets.find(asset => String(asset && asset.name || '') === name) || null
    : null;
}

function selectReleaseAsset(release, options = {}) {
  const mode = options.mode || detectInstallMode(options);
  if (mode === 'docker') return null;
  const platform = options.platform || process.platform;
  const arch = normalizeArchitecture(options.arch || process.arch);
  const name = mode === 'portable'
    ? `WallHub-Portable-win-${arch}.zip`
    : 'WallHub-Source.zip';
  if (mode === 'portable' && platform !== 'win32') return null;
  const asset = findReleaseAsset(release, name);
  if (!asset) return null;
  return {
    name,
    url: String(asset.browser_download_url || ''),
    size: Number(asset.size || 0),
    checksumName: `${name}.sha256`,
  };
}

function curlProxyArgs(proxyUrl) {
  const value = String(proxyUrl || '').trim();
  return value ? ['--proxy', value] : [];
}

function canRetryWithoutCertificateRevocation(stderr, options = {}) {
  return process.platform === 'win32' &&
    !options.revocationFallback &&
    process.env.WALLHUB_CURL_NO_REVOKE !== '1' &&
    /(?:0x80092013|revocation (?:server|function).*offline|CRYPT_E_REVOCATION_OFFLINE)/i.test(String(stderr || ''));
}

function requestBufferWithCurl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '--fail', '--location', '--silent', '--show-error',
      '--proto', '=https', '--proto-redir', '=https',
      '--max-time', String(Math.max(5, Math.ceil(Number(options.timeoutMs || 30000) / 1000))),
      ...curlProxyArgs(options.proxyUrl),
      '--header', 'Accept: application/vnd.github+json',
      '--header', `User-Agent: ${options.userAgent || 'WallHub-Updater'}`,
    ];
    if (process.platform === 'win32' && (options.revocationFallback || process.env.WALLHUB_CURL_NO_REVOKE === '1')) args.push('--ssl-no-revoke');
    if (options.token) args.push('--header', `Authorization: Bearer ${options.token}`);
    args.push(String(url));
    const cp = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', args, { windowsHide: true });
    const chunks = [];
    let bytes = 0;
    let stderr = '';
    cp.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > (options.maxBytes || MAX_RELEASE_RESPONSE_BYTES)) {
        try { cp.kill(); } catch {}
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    cp.stderr.on('data', chunk => { stderr += chunk.toString(); });
    cp.on('error', reject);
    cp.on('close', code => {
      if (bytes > (options.maxBytes || MAX_RELEASE_RESPONSE_BYTES)) return reject(new Error('GitHub response is too large'));
      if (code !== 0 && canRetryWithoutCertificateRevocation(stderr, options)) {
        return requestBufferWithCurl(url, Object.assign({}, options, { revocationFallback: true })).then(resolve, reject);
      }
      if (code !== 0) return reject(new Error((stderr || `curl exit ${code}`).trim().slice(-1200)));
      resolve(Buffer.concat(chunks));
    });
  });
}

function downloadFileWithCurl(url, destination, options = {}) {
  return new Promise((resolve, reject) => {
    const partial = `${destination}.part`;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    try { fs.rmSync(partial, { force: true }); } catch {}
    const args = [
      '--fail', '--location', '--silent', '--show-error',
      '--proto', '=https', '--proto-redir', '=https',
      '--max-time', String(Math.max(60, Math.ceil(Number(options.timeoutMs || 30 * 60 * 1000) / 1000))),
      '--max-filesize', String(Math.max(1, Number(options.maxBytes || MAX_UPDATE_ASSET_BYTES))),
      ...curlProxyArgs(options.proxyUrl),
      '--header', `User-Agent: ${options.userAgent || 'WallHub-Updater'}`,
    ];
    if (process.platform === 'win32' && (options.revocationFallback || process.env.WALLHUB_CURL_NO_REVOKE === '1')) args.push('--ssl-no-revoke');
    if (options.token) args.push('--header', `Authorization: Bearer ${options.token}`);
    args.push('--output', partial, String(url));
    const cp = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', args, { windowsHide: true });
    let stderr = '';
    const timer = setInterval(() => {
      try {
        const downloaded = fs.statSync(partial).size;
        options.onProgress?.(downloaded, Number(options.totalBytes || 0));
      } catch {}
    }, 250);
    timer.unref?.();
    cp.stderr.on('data', chunk => { stderr += chunk.toString(); });
    cp.on('error', error => {
      clearInterval(timer);
      reject(error);
    });
    cp.on('close', code => {
      clearInterval(timer);
      if (code !== 0) {
        try { fs.rmSync(partial, { force: true }); } catch {}
        if (canRetryWithoutCertificateRevocation(stderr, options)) {
          return downloadFileWithCurl(url, destination, Object.assign({}, options, { revocationFallback: true })).then(resolve, reject);
        }
        return reject(new Error((stderr || `curl exit ${code}`).trim().slice(-1200)));
      }
      options.onProgress?.(fs.statSync(partial).size, Number(options.totalBytes || 0));
      const size = fs.statSync(partial).size;
      if (size > Number(options.maxBytes || MAX_UPDATE_ASSET_BYTES)) {
        try { fs.rmSync(partial, { force: true }); } catch {}
        return reject(new Error('Downloaded update exceeds the allowed size'));
      }
      if (Number(options.totalBytes || 0) > 0 && size !== Number(options.totalBytes)) {
        try { fs.rmSync(partial, { force: true }); } catch {}
        return reject(new Error(`Downloaded update size ${size} does not match the release metadata ${options.totalBytes}`));
      }
      fs.renameSync(partial, destination);
      resolve(destination);
    });
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('data', chunk => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function parseChecksum(value, expectedName) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value || '');
  const match = text.trim().match(/^([a-fA-F0-9]{64})(?:\s+\*?(.+))?$/);
  if (!match) throw new Error('Invalid SHA-256 checksum file');
  if (match[2] && path.basename(match[2].trim()) !== expectedName) {
    throw new Error('SHA-256 checksum filename does not match the update asset');
  }
  return match[1].toLowerCase();
}

function parseReleaseChecksum(value, expectedName) {
  const name = String(expectedName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(value || '').match(new RegExp('^\\s*-\\s*`' + name + '`\\s*:\\s*([a-fA-F0-9]{64})\\s*$', 'im'));
  return match ? match[1].toLowerCase() : null;
}

function isLoopbackAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function isUpdateMutationAllowed(req) {
  const headers = req && req.headers ? req.headers : {};
  const fetchSite = String(headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') return false;
  const origin = String(headers.origin || '').trim();
  if (!origin) {
    const remoteAddress = req && req.socket && req.socket.remoteAddress;
    return isLoopbackAddress(remoteAddress);
  }
  try {
    return new URL(origin).host.toLowerCase() === String(headers.host || '').toLowerCase();
  } catch {
    return false;
  }
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(value, null, 2));
  try {
    fs.renameSync(temporary, filePath);
  } catch (error) {
    if (!fs.existsSync(filePath)) throw error;
    fs.rmSync(filePath, { force: true });
    fs.renameSync(temporary, filePath);
  }
}

function updaterLaunchRequest(options = {}) {
  const mode = options.mode;
  const waitPids = [process.pid];
  if ((mode === 'portable' || options.supervised) && process.ppid > 1) waitPids.push(process.ppid);
  const launcherPid = Number(options.launcherPid || 0);
  if (mode === 'portable' && Number.isInteger(launcherPid) && launcherPid > 1) waitPids.push(launcherPid);
  const restartCommand = mode === 'portable'
    ? path.join(options.projectRoot, 'WallHub.exe')
    : process.execPath;
  const restartArgs = mode === 'portable' ? [] : [path.join(options.projectRoot, 'server.js'), ...process.argv.slice(2)];
  const requestPath = path.join(options.projectRoot, 'updates', UPDATE_REQUEST_FILE);
  return {
    schemaVersion: 1,
    archive: options.archive,
    projectRoot: options.projectRoot,
    mode,
    targetVersion: options.targetVersion,
    expectedHash: options.expectedHash,
    expectedSize: options.expectedSize,
    waitPids: Array.from(new Set(waitPids)),
    restartCommand,
    restartArgs,
    restartCwd: options.projectRoot,
    healthUrl: `http://127.0.0.1:${Number(options.port) || 3090}/health`,
    healthToken: crypto.randomBytes(32).toString('hex'),
    requestPath,
    markerFile: requestPath,
  };
}

function spawnDetachedUpdater(request, options = {}) {
  const sourceScript = options.scriptPath;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-updater-'));
  const scriptPath = path.join(tempDir, 'apply-update.js');
  const requestPath = request.requestPath || request.markerFile || path.join(request.projectRoot, 'updates', UPDATE_REQUEST_FILE);
  fs.copyFileSync(sourceScript, scriptPath);

  let nodePath = process.execPath;
  if (process.platform === 'win32' && path.resolve(process.execPath).startsWith(path.resolve(request.projectRoot) + path.sep)) {
    nodePath = path.join(tempDir, 'node.exe');
    fs.copyFileSync(process.execPath, nodePath);
  }
  request.helperExecutable = nodePath;
  request.helperScript = scriptPath;
  request.requestPath = requestPath;
  request.markerFile = requestPath;
  const persistedRequest = Object.assign({}, request);
  delete persistedRequest.proxyUrl;
  delete persistedRequest.updateProxy;
  delete persistedRequest.WALLHUB_UPDATE_NPM_PROXY;
  writeJsonAtomic(requestPath, persistedRequest);
  const helperEnv = Object.assign({}, process.env, options.env || {}, { WALLHUB_UPDATE_HELPER: '1' });
  const cp = spawn(nodePath, [scriptPath, requestPath], {
    cwd: tempDir,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: helperEnv,
  });
  cp.on('error', error => {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    try {
      if (!fs.existsSync(path.join(request.projectRoot, 'updates', 'update-transaction.json'))) fs.rmSync(requestPath, { force: true });
    } catch {}
    options.onError?.(error);
  });
  if (!Number.isInteger(cp.pid) || cp.pid <= 1) {
    try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch {}
    throw new Error('Could not start the detached update helper');
  }
  cp.unref();
  return { pid: cp.pid, tempDir };
}

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
  const requestBuffer = options.requestBuffer || requestBufferWithCurl;
  const downloadFile = options.downloadFile || downloadFileWithCurl;
  const hashFile = options.hashFile || sha256File;
  const getAutoUpdateEnabled = options.getAutoUpdateEnabled || (() => false);
  const getProxyUrl = options.getProxyUrl || (() => '');
  const isInstallSafe = options.isInstallSafe || (() => true);
  const onInstallStarting = options.onInstallStarting || (() => {});
  const onInstallCancelled = options.onInstallCancelled || (() => {});
  const onInstallPrepared = options.onInstallPrepared || (() => {});
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
  let initialTimer = null;
  let intervalTimer = null;
  let installStarted = false;

  function setState(patch) {
    state = Object.assign({}, state, patch, { updatedAt: Date.now() });
    return snapshot();
  }

  function snapshot() {
    return Object.assign({}, state, { autoUpdateEnabled: !!getAutoUpdateEnabled() });
  }

  function networkOptions(extra = {}) {
    return Object.assign({
      token: env.GITHUB_TOKEN || '',
      proxyUrl: getProxyUrl(),
      userAgent: `WallHub/${currentVersion}`,
    }, extra);
  }

  async function performCheck() {
    setState({ status: 'checking', progress: 0, error: '', errorCode: '' });
    const apiUrl = `https://api.github.com/repos/${repository}/releases/latest`;
    const body = await requestBuffer(apiUrl, networkOptions({ timeoutMs: 30000 }));
    const nextRelease = JSON.parse(body.toString('utf8'));
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
    let expectedHash = parseReleaseChecksum(downloadRelease.body, downloadAsset.name);
    if (!expectedHash) {
      const checksumAsset = findReleaseAsset(downloadRelease, downloadAsset.checksumName);
      if (!checksumAsset || !checksumAsset.browser_download_url) {
        const error = new Error(`Missing Release checksum for ${downloadAsset.name}`);
        error.code = 'UPDATE_CHECKSUM_UNAVAILABLE';
        throw error;
      }
      const checksumBody = await requestBuffer(checksumAsset.browser_download_url, networkOptions({ timeoutMs: 30000, maxBytes: 4096 }));
      expectedHash = parseChecksum(checksumBody, downloadAsset.name);
    }
    const targetDir = path.join(updateDir, `v${downloadVersion}`);
    const destination = path.join(targetDir, downloadAsset.name);
    await downloadFile(downloadAsset.url, destination, networkOptions({
      timeoutMs: 30 * 60 * 1000,
      totalBytes: downloadAsset.size,
      maxBytes: MAX_UPDATE_ASSET_BYTES,
      onProgress(downloadedBytes, totalBytes) {
        const progress = totalBytes > 0 ? Math.min(99, Math.floor(downloadedBytes * 100 / totalBytes)) : 0;
        setState({ status: 'downloading', progress, downloadedBytes, totalBytes });
      },
    }));
    const actualHash = await hashFile(destination);
    if (String(actualHash).toLowerCase() !== expectedHash) {
      try { fs.rmSync(destination, { force: true }); } catch {}
      const error = new Error('Downloaded update failed SHA-256 verification');
      error.code = 'UPDATE_CHECKSUM_MISMATCH';
      throw error;
    }
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

  function startDownload() {
    beginDownload().catch(error => {
      logger.warn('[Update] Download failed:', error.message || error);
    });
    return snapshot();
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

  function schedule() {
    stopSchedule();
    initialTimer = setTimeout(runAutomatic, Number(options.initialDelayMs || 15000));
    initialTimer.unref?.();
    intervalTimer = setInterval(runAutomatic, Number(options.checkIntervalMs || DEFAULT_CHECK_INTERVAL_MS));
    intervalTimer.unref?.();
  }

  function scheduleSoon() {
    if (!getAutoUpdateEnabled()) return;
    if (initialTimer) clearTimeout(initialTimer);
    initialTimer = setTimeout(runAutomatic, 1000);
    initialTimer.unref?.();
  }

  function stopSchedule() {
    if (initialTimer) clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    initialTimer = null;
    intervalTimer = null;
  }

  return {
    snapshot,
    checkNow,
    startDownload,
    installDownloaded,
    runAutomatic,
    schedule,
    scheduleSoon,
    stopSchedule,
    _waitForDownload: () => (downloadPromise || Promise.resolve(snapshot())).catch(() => snapshot()),
  };
}

module.exports = {
  DEFAULT_REPOSITORY,
  UPDATE_REQUEST_FILE,
  parseVersion,
  compareVersions,
  normalizeRepository,
  normalizeArchitecture,
  detectInstallMode,
  isLoopbackAddress,
  isUpdateMutationAllowed,
  releaseVersion,
  findReleaseAsset,
  selectReleaseAsset,
  parseChecksum,
  parseReleaseChecksum,
  sha256File,
  updaterLaunchRequest,
  spawnDetachedUpdater,
  createUpdateService,
};
