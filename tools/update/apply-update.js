'use strict';

const fs = require('fs');
const path = require('path');
const manifestSafetyPath = fs.existsSync(path.join(__dirname, 'manifestSafety.js'))
  ? './manifestSafety'
  : '../../src/domains/updates/manifestSafety';
const updaterModulePath = name => fs.existsSync(path.join(__dirname, `${name}.js`))
  ? `./${name}`
  : `../../src/domains/updates/${name}`;
const {
  PROTECTED_PATHS,
  MAX_EXPANDED_BYTES,
  normalizeRelative,
  isProtected,
  validateArchiveEntries,
  validateRelativePath,
  validateManifestEntries,
  validateTransactionEntries,
} = require(manifestSafetyPath);
const {
  UPDATE_LOCK_FILE,
  getProcessIdentity,
  processIdentityMatches,
  processExists,
  acquireUpdateLock,
  releaseUpdateLock,
  waitForProcesses,
  run,
  atomicWriteJson,
  sha256FileSync,
} = require(updaterModulePath('updaterProcess'));
const {
  INSTALLED_FILES_MANIFEST,
  UPDATE_TRANSACTION_FILE,
  listFiles,
  readInstalledManifest,
  writeInstalledManifest,
  restoreInstalledManifest,
  assertSafeTargetPath,
  rollbackFiles,
  writeTransactionJournal,
  recoverInterruptedTransaction,
  applyFiles,
} = require(updaterModulePath('updateTransaction'));
const { startRestartProcess, restartAndWait } = require(updaterModulePath('updateHealth'));

const UPDATE_REQUEST_FILE = 'update-request.json';

function inspectZip(archive, destination) {
  if (process.platform === 'win32') {
    const escapedArchive = archive.replace(/'/g, "''");
    const script = `Add-Type -AssemblyName System.IO.Compression.FileSystem; $z=[IO.Compression.ZipFile]::OpenRead('${escapedArchive}'); try { $items=@($z.Entries | ForEach-Object { [pscustomobject]@{ Name=$_.FullName; Length=$_.Length; ExternalAttributes=$_.ExternalAttributes } }); [pscustomobject]@{ Entries=$items } | ConvertTo-Json -Compress -Depth 4 } finally { $z.Dispose() }`;
    const listed = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script]);
    const payload = JSON.parse(String(listed.stdout || '{}'));
    const entries = Array.isArray(payload.Entries) ? payload.Entries : (payload.Entries ? [payload.Entries] : []);
    validateArchiveEntries(entries, destination);
    return;
  }
  const listed = run('unzip', ['-Z1', archive]);
  const entries = String(listed.stdout || '').split(/\r?\n/).filter(Boolean);
  const details = run('zipinfo', ['-l', archive]);
  if (String(details.stdout || '').split(/\r?\n/).some(line => /^l[rwx-]{9}\s/.test(line))) {
    throw new Error('Update archive contains a symbolic link');
  }
  const summary = run('unzip', ['-Z', '-t', archive]);
  const sizeMatch = String(summary.stdout || '').match(/(?:^|\s)(\d+) bytes uncompressed/i);
  const expandedBytes = sizeMatch ? Number(sizeMatch[1]) : 0;
  if (!Number.isFinite(expandedBytes) || expandedBytes > MAX_EXPANDED_BYTES) {
    throw new Error('Update archive expands beyond the allowed size');
  }
  validateArchiveEntries(entries.map(name => ({ name, length: 0 })), destination);
}

function extractZip(archive, destination) {
  fs.mkdirSync(destination, { recursive: true });
  inspectZip(archive, destination);
  if (process.platform === 'win32') {
    const escapedArchive = archive.replace(/'/g, "''");
    const escapedDestination = destination.replace(/'/g, "''");
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Expand-Archive -LiteralPath '${escapedArchive}' -DestinationPath '${escapedDestination}' -Force`]);
    return;
  }
  run('unzip', ['-q', '-o', archive, '-d', destination]);
}

function validateStaging(staging, targetVersion) {
  const packagePath = path.join(staging, 'package.json');
  const serverPath = path.join(staging, 'server.js');
  const publicPath = path.join(staging, 'public', 'index.html');
  if (!fs.existsSync(packagePath) || !fs.existsSync(serverPath) || !fs.existsSync(publicPath)) {
    throw new Error('Update archive is missing required WallHub files');
  }
  const packageJson = JSON.parse(fs.readFileSync(packagePath, 'utf8').replace(/^\uFEFF/, ''));
  if (String(packageJson.version || '') !== String(targetVersion || '')) {
    throw new Error(`Update archive version ${packageJson.version || '<missing>'} does not match ${targetVersion}`);
  }
}

function prepareSourceDependencies(staging, sourceEnv = process.env, runCommand = run) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const env = Object.assign({}, sourceEnv, { NODE_ENV: 'production' });
  const proxy = String(sourceEnv.WALLHUB_UPDATE_NPM_PROXY || '').trim();
  if (proxy) {
    env.npm_config_proxy = proxy;
    env.npm_config_https_proxy = proxy;
  }
  runCommand(npm, ['ci', '--omit=dev', '--ignore-scripts', '--no-audit', '--no-fund'], {
    cwd: staging,
    env,
  });
}

function validateRequest(request) {
  const projectRoot = path.resolve(request.projectRoot || '');
  const updateRoot = path.join(projectRoot, 'updates');
  const archive = path.resolve(request.archive || '');
  if (!archive.startsWith(updateRoot + path.sep)) throw new Error('Update archive must be inside the WallHub updates directory');
  if (!fs.statSync(archive).isFile() || fs.lstatSync(archive).isSymbolicLink()) throw new Error('Update archive is not a regular file');
  if (!/^[a-fA-F0-9]{64}$/.test(String(request.expectedHash || ''))) throw new Error('Update request is missing a valid SHA-256 hash');
  const actualSize = fs.statSync(archive).size;
  if (Number(request.expectedSize || 0) > 0 && actualSize !== Number(request.expectedSize)) throw new Error('Update archive size changed after verification');
  return { projectRoot, updateRoot, archive };
}

async function applyUpdateUnlocked(request) {
  const { projectRoot, updateRoot, archive } = validateRequest(request);
  const staging = path.join(updateRoot, `staging-v${request.targetVersion}`);
  const backupRoot = path.join(updateRoot, 'backup-previous');
  const resultFile = path.join(updateRoot, 'last-update.json');
  const journalFile = path.join(updateRoot, UPDATE_TRANSACTION_FILE);
  const manifestFile = path.join(updateRoot, INSTALLED_FILES_MANIFEST);
  await waitForProcesses(request.waitProcesses || (request.waitPids || []).map(Number).filter(Number.isInteger));
  recoverInterruptedTransaction(projectRoot, updateRoot);
  fs.rmSync(staging, { recursive: true, force: true });
  const actualHash = sha256FileSync(archive);
  if (actualHash !== String(request.expectedHash).toLowerCase()) throw new Error('Update archive changed after SHA-256 verification');
  extractZip(archive, staging);
  validateStaging(staging, request.targetVersion);
  if (request.mode === 'source') prepareSourceDependencies(staging);
  const transaction = applyFiles(staging, projectRoot, backupRoot, journalFile, manifestFile);
  try {
    await restartAndWait(request, Number(request.healthTimeoutMs) || 60000);
  } catch (error) {
    rollbackFiles(projectRoot, backupRoot, transaction.entries);
    restoreInstalledManifest(manifestFile, backupRoot, transaction.manifest);
    await restartAndWait(request, Number(request.healthTimeoutMs) || 60000);
    fs.rmSync(journalFile, { force: true });
    error.recoveryRestarted = true;
    throw error;
  }
  writeTransactionJournal(journalFile, 'committed', transaction.entries, transaction.manifest);
  atomicWriteJson(resultFile, {
    success: true,
    version: request.targetVersion,
    installedAt: new Date().toISOString(),
    backupRoot,
  });
  try { fs.rmSync(request.markerFile || path.join(updateRoot, UPDATE_REQUEST_FILE), { force: true }); } catch {}
  try { fs.rmSync(journalFile, { force: true }); } catch {}
  fs.rmSync(staging, { recursive: true, force: true });
}

async function applyUpdate(request) {
  const updateRoot = path.join(path.resolve(request.projectRoot || ''), 'updates');
  const lock = request._updateLock || acquireUpdateLock(updateRoot);
  try {
    return await applyUpdateUnlocked(request);
  } finally {
    if (!request._updateLock) releaseUpdateLock(lock);
  }
}

async function recoverUpdateUnlocked(request, launcherPid) {
  const projectRoot = path.resolve(request.projectRoot);
  const updateRoot = path.join(projectRoot, 'updates');
  await waitForProcesses([Number(launcherPid)].filter(Number.isInteger), 30000);
  const recovered = recoverInterruptedTransaction(projectRoot, updateRoot);
  atomicWriteJson(path.join(updateRoot, 'last-update.json'), {
    success: false,
    version: request.targetVersion || '',
    recoveredAt: new Date().toISOString(),
    error: recovered ? 'An interrupted update was rolled back before startup' : 'An interrupted update marker was cleared before startup',
  });
  await restartAndWait(request);
  fs.rmSync(request.markerFile || path.join(updateRoot, UPDATE_REQUEST_FILE), { force: true });
}

async function recoverUpdate(request, launcherPid) {
  const updateRoot = path.join(path.resolve(request.projectRoot || ''), 'updates');
  const lock = request._updateLock || acquireUpdateLock(updateRoot);
  try {
    return await recoverUpdateUnlocked(request, launcherPid);
  } finally {
    if (!request._updateLock) releaseUpdateLock(lock);
  }
}

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) throw new Error('Missing updater request path');
  const request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  delete request.proxyUrl;
  delete request.updateProxy;
  delete request.WALLHUB_UPDATE_NPM_PROXY;
  const expectedRequestPath = path.join(path.resolve(request.projectRoot || ''), 'updates', UPDATE_REQUEST_FILE);
  request.markerFile = expectedRequestPath;
  request.requestPath = expectedRequestPath;
  const lock = acquireUpdateLock(path.dirname(request.markerFile));
  request._updateLock = lock;
  try {
    fs.mkdirSync(path.dirname(request.markerFile), { recursive: true });
    atomicWriteJson(request.markerFile, Object.assign({}, request, {
      targetVersion: request.targetVersion,
      requestedAt: Date.now(),
      helperPid: process.pid,
      helperIdentity: getProcessIdentity(process.pid),
      helperExecutable: request.helperExecutable || process.execPath,
      helperScript: request.helperScript || __filename,
      requestPath: request.markerFile,
      markerFile: request.markerFile,
    }));
    try {
      if (process.argv[3] === '--recover') await recoverUpdate(request, process.argv[4]);
      else await applyUpdate(request);
    } catch (error) {
      try {
        await waitForProcesses(request.waitProcesses || (request.waitPids || []).map(Number).filter(Number.isInteger), 15000);
      } catch {}
      try {
        const updateRoot = path.join(path.resolve(request.projectRoot), 'updates');
        fs.mkdirSync(updateRoot, { recursive: true });
        atomicWriteJson(path.join(updateRoot, 'last-update.json'), {
          success: false,
          version: request.targetVersion || '',
          failedAt: new Date().toISOString(),
          error: error.message || String(error),
        });
        if (!fs.existsSync(path.join(updateRoot, UPDATE_TRANSACTION_FILE))) {
          fs.rmSync(request.markerFile || path.join(updateRoot, UPDATE_REQUEST_FILE), { force: true });
        }
      } catch {}
      const recoveryRequired = (() => {
        try { return fs.existsSync(path.join(path.resolve(request.projectRoot), 'updates', UPDATE_TRANSACTION_FILE)); } catch { return true; }
      })();
      if (!error.recoveryRestarted && !recoveryRequired) {
        try {
          const cp = startRestartProcess(request);
          cp.unref();
        } catch {}
      }
      throw error;
    }
  } finally {
    releaseUpdateLock(lock);
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = {
  PROTECTED_PATHS,
  UPDATE_LOCK_FILE,
  INSTALLED_FILES_MANIFEST,
  UPDATE_TRANSACTION_FILE,
  UPDATE_REQUEST_FILE,
  normalizeRelative,
  isProtected,
  getProcessIdentity,
  processIdentityMatches,
  processExists,
  acquireUpdateLock,
  releaseUpdateLock,
  waitForProcesses,
  validateArchiveEntries,
  validateStaging,
  listFiles,
  validateRelativePath,
  validateManifestEntries,
  validateTransactionEntries,
  readInstalledManifest,
  writeInstalledManifest,
  restoreInstalledManifest,
  prepareSourceDependencies,
  inspectZip,
  assertSafeTargetPath,
  rollbackFiles,
  recoverInterruptedTransaction,
  applyFiles,
  applyUpdate,
};
