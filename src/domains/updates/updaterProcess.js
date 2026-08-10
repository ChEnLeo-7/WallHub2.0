'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const UPDATE_LOCK_FILE = 'update-lock.json';
const UPDATE_LOCK_STALE_MS = 30 * 60 * 1000;

function getProcessIdentity(pid = process.pid) {
  if (!Number.isInteger(pid) || pid <= 1) return null;
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
      const closeParen = stat.lastIndexOf(')');
      const fields = stat.slice(closeParen + 2).trim().split(/\s+/);
      return { startToken: String(fields[19] || '') };
    } catch {}
  }
  if (process.platform === 'win32') {
    try {
      const result = spawnSync('powershell.exe', [
        '-NoProfile', '-NonInteractive', '-Command',
        `$p=Get-Process -Id ${pid} -ErrorAction Stop; $p.StartTime.ToUniversalTime().Ticks`,
      ], { encoding: 'utf8', windowsHide: true });
      if (result.status === 0) {
        const startToken = String(result.stdout || '').trim();
        if (startToken) return { startToken };
      }
    } catch {}
  }
  return null;
}

function processIdentityMatches(pid, identity) {
  if (!identity || !identity.startToken) return null;
  const current = getProcessIdentity(pid);
  if (!current || !current.startToken) return null;
  return String(current.startToken) === String(identity.startToken);
}

function processExists(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error && error.code === 'EPERM';
  }
}

function acquireUpdateLock(updateRoot, options = {}) {
  fs.mkdirSync(updateRoot, { recursive: true });
  const lockPath = path.join(updateRoot, UPDATE_LOCK_FILE);
  const staleMs = Number(options.staleMs || UPDATE_LOCK_STALE_MS);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    let fd;
    try {
      fd = fs.openSync(lockPath, 'wx');
      const ownerToken = crypto.randomBytes(16).toString('hex');
      const owner = {
        pid: process.pid,
        startedAt: Date.now(),
        ownerToken,
        processIdentity: getProcessIdentity(process.pid),
      };
      fs.writeFileSync(fd, JSON.stringify(owner));
      return { fd, path: lockPath, ownerToken, pid: owner.pid, processIdentity: owner.processIdentity };
    } catch (error) {
      if (fd !== undefined) {
        try { fs.closeSync(fd); } catch {}
      }
      if (!error || error.code !== 'EEXIST') throw error;
      let lock = null;
      try { lock = JSON.parse(fs.readFileSync(lockPath, 'utf8')); } catch {}
      const pid = Number(lock && lock.pid);
      const startedAt = Number(lock && lock.startedAt);
      let lockMtime = 0;
      try { lockMtime = fs.statSync(lockPath).mtimeMs; } catch {}
      const age = Number.isFinite(startedAt) ? Date.now() - startedAt : Date.now() - lockMtime;
      const hasOwnerPid = Number.isInteger(pid) && pid > 1;
      const identityMatch = hasOwnerPid ? processIdentityMatches(pid, lock && lock.processIdentity) : false;
      const ownerAlive = processExists(pid) && (identityMatch !== false && (identityMatch === true || age < staleMs));
      if (ownerAlive || (!hasOwnerPid && age < staleMs)) {
        throw new Error('Another WallHub update is already in progress');
      }
      try { fs.rmSync(lockPath, { force: true }); } catch (removeError) {
        if (removeError && removeError.code !== 'ENOENT') throw removeError;
      }
    }
  }
  throw new Error('Could not acquire the WallHub update lock');
}

function releaseUpdateLock(lock) {
  if (!lock) return;
  try { fs.closeSync(lock.fd); } catch {}
  try {
    const current = JSON.parse(fs.readFileSync(lock.path, 'utf8'));
    if (current && current.ownerToken === lock.ownerToken && Number(current.pid) === Number(lock.pid)) {
      fs.rmSync(lock.path, { force: true });
    }
  } catch {}
}

function processReference(value) {
  if (value && typeof value === 'object') return { pid: Number(value.pid), identity: value.identity || value.processIdentity || null };
  return { pid: Number(value), identity: null };
}

function processReferenceExists(value) {
  const reference = processReference(value);
  if (!processExists(reference.pid)) return false;
  const match = processIdentityMatches(reference.pid, reference.identity);
  return match !== false;
}

async function waitForProcesses(pids, timeoutMs = 60000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (!pids.some(processReferenceExists)) return;
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for WallHub processes: ${pids.filter(processReferenceExists).map(value => processReference(value).pid).join(', ')}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, Object.assign({ encoding: 'utf8', windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, options));
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(String(result.stderr || result.stdout || `${command} exited ${result.status}`).trim().slice(-2000));
  return result;
}

function atomicWriteJson(filePath, value) {
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

function sha256FileSync(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    while ((bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) {
      hash.update(buffer.subarray(0, bytesRead));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

module.exports = {
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
};
