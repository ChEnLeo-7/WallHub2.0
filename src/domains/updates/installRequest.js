'use strict';

const crypto = require('crypto');
const path = require('path');

const UPDATE_REQUEST_FILE = 'update-request.json';

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

module.exports = {
  UPDATE_REQUEST_FILE,
  updaterLaunchRequest,
};
