'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { UPDATE_REQUEST_FILE } = require('./installRequest');

const UPDATER_DEPENDENCIES = [
  'updaterProcess.js',
  'updateTransaction.js',
  'updateHealth.js',
];

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

function copyUpdaterDependencies(sourceScript, tempDir) {
  fs.copyFileSync(require.resolve('./manifestSafety'), path.join(tempDir, 'manifestSafety.js'));
  for (const name of UPDATER_DEPENDENCIES) {
    fs.copyFileSync(require.resolve(`./${path.basename(name, '.js')}`), path.join(tempDir, name));
  }
}

function spawnDetachedUpdater(request, options = {}) {
  const sourceScript = options.scriptPath;
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-updater-'));
  const scriptPath = path.join(tempDir, 'apply-update.js');
  const requestPath = request.requestPath || request.markerFile || path.join(request.projectRoot, 'updates', UPDATE_REQUEST_FILE);
  fs.copyFileSync(sourceScript, scriptPath);
  copyUpdaterDependencies(sourceScript, tempDir);

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

module.exports = {
  spawnDetachedUpdater,
};
