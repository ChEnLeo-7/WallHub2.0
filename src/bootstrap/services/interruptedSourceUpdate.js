'use strict';

const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

function readProcessStartToken(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return '';
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const closeParen = stat.lastIndexOf(')');
      const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
      return String(fields[19] || '');
    } catch {}
  }
  if (process.platform === 'win32') {
    try {
      const result = childProcess.spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `$p=Get-Process -Id ${pid} -ErrorAction Stop; $p.StartTime.ToUniversalTime().Ticks`,
      ], { encoding: 'utf8', windowsHide: true });
      if (result.status === 0) return String(result.stdout || '').trim();
    } catch {}
  }
  return '';
}

function matchesProcessIdentity(pid, identity) {
  const expected = String(identity && identity.startToken || '');
  return !!expected && readProcessStartToken(pid) === expected;
}

function handOffInterruptedSourceUpdate(projectRoot) {
  if (process.env.WALLHUB_UPDATE_RESTART === '1') return false;
  const updateRoot = path.join(projectRoot, 'updates');
  const requestFile = path.join(updateRoot, 'update-request.json');
  const transactionFile = path.join(updateRoot, 'update-transaction.json');
  if (!fs.existsSync(requestFile)) {
    if (fs.existsSync(transactionFile)) {
      console.error('[Update] WallHub found a pending transaction but update-request.json is missing; refusing normal startup. Restore the request file or reinstall WallHub.');
      return true;
    }
    return false;
  }
  try {
    const request = JSON.parse(fs.readFileSync(requestFile, 'utf8'));
    if (!request || request.mode !== 'source') {
      if (fs.existsSync(transactionFile)) {
        console.error('[Update] WallHub found a pending transaction with an invalid update-request.json; refusing normal startup.');
        return true;
      }
      fs.rmSync(requestFile, { force: true });
      return false;
    }
    const helperPid = Number(request.helperPid || 0);
    if (helperPid > 1) {
      try {
        process.kill(helperPid, 0);
        if (matchesProcessIdentity(helperPid, request.helperIdentity)) return true;
      } catch (error) {
        if (error && error.code === 'EPERM' && matchesProcessIdentity(helperPid, request.helperIdentity)) return true;
      }
    }
    if (!fs.existsSync(transactionFile)) {
      fs.rmSync(requestFile, { force: true });
      return false;
    }
    const helperExecutable = String(request.helperExecutable || '');
    const helperScript = String(request.helperScript || '');
    if (!fs.existsSync(helperExecutable) || !fs.existsSync(helperScript)) {
      throw new Error('interrupted update helper files are unavailable');
    }
    const recovery = childProcess.spawn(
      helperExecutable,
      [helperScript, requestFile, '--recover', String(process.pid)],
      {
        cwd: path.dirname(helperScript),
        detached: true,
        stdio: 'ignore',
        windowsHide: true,
      },
    );
    if (!Number.isInteger(recovery.pid) || recovery.pid <= 1) throw new Error('could not start interrupted update recovery');
    recovery.unref();
    return true;
  } catch (error) {
    console.error(`[Update] WallHub cannot recover the interrupted source update: ${error.message || error}`);
    console.error(`[Update] WallHub is refusing normal startup while ${transactionFile} exists. Keep ${path.join(updateRoot, 'backup-previous')} and reinstall WallHub before removing it.`);
    return true;
  }
}

module.exports = { handOffInterruptedSourceUpdate };
