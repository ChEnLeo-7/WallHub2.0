'use strict';

const fs = require('fs');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const path = require('path');
const { spawn, spawnSync } = require('child_process');

const PROTECTED_PATHS = [
  'downloads',
  'logs',
  'updates',
  'cache-settings.json',
  'launcher-settings.json',
  'SteamKit/account',
].map(value => value.toLowerCase());
const MAX_ARCHIVE_ENTRIES = 100000;
const MAX_EXPANDED_BYTES = 8 * 1024 * 1024 * 1024;
const MAX_ENTRY_BYTES = 4 * 1024 * 1024 * 1024;
const UPDATE_LOCK_FILE = 'update-lock.json';
const INSTALLED_FILES_MANIFEST = 'installed-files.json';
const UPDATE_TRANSACTION_FILE = 'update-transaction.json';
const UPDATE_REQUEST_FILE = 'update-request.json';
const UPDATE_LOCK_STALE_MS = 30 * 60 * 1000;
const WINDOWS_RESERVED_NAMES = new Set([
  'aux', 'con', 'nul', 'prn',
  'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
  'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

function normalizeRelative(value) {
  return String(value || '').split(path.sep).join('/').replace(/^\.\//, '');
}

function isProtected(relativePath) {
  const parts = String(relativePath || '').replace(/\\/g, '/').split('/');
  const canonical = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (canonical.length) canonical.pop();
      else canonical.push(part);
      continue;
    }
    canonical.push(part.replace(/[. ]+$/g, ''));
  }
  const value = canonical.join('/').toLowerCase();
  return PROTECTED_PATHS.some(protectedPath => value === protectedPath || value.startsWith(`${protectedPath}/`));
}

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

function validateArchiveEntries(entries, destination) {
  if (entries.length > MAX_ARCHIVE_ENTRIES) throw new Error(`Update archive contains too many entries: ${entries.length}`);
  const root = path.resolve(destination) + path.sep;
  let expandedBytes = 0;
  for (const rawEntry of entries) {
    const metadata = rawEntry && typeof rawEntry === 'object' ? rawEntry : { name: rawEntry };
    const entry = String(metadata.name || metadata.Name || '').replace(/\\/g, '/').trim();
    if (!entry) continue;
    if (/^(?:\/|[A-Za-z]:\/)/.test(entry)) {
      throw new Error(`Update archive contains an unsafe path: ${entry}`);
    }
    const target = path.resolve(destination, ...entry.split('/'));
    if (target !== path.resolve(destination) && !target.startsWith(root)) {
      throw new Error(`Update archive contains an unsafe path: ${entry}`);
    }
    const entryBytes = Number(metadata.length ?? metadata.Length ?? 0);
    if (!Number.isFinite(entryBytes) || entryBytes < 0 || entryBytes > MAX_ENTRY_BYTES) {
      throw new Error(`Update archive entry has an invalid size: ${entry}`);
    }
    expandedBytes += entryBytes;
    if (expandedBytes > MAX_EXPANDED_BYTES) throw new Error('Update archive expands beyond the allowed size');
    const attributes = Number(metadata.externalAttributes ?? metadata.ExternalAttributes ?? 0) >>> 0;
    const unixType = (attributes >>> 16) & 0xf000;
    if (metadata.symlink || unixType === 0xa000 || (attributes & 0x400) !== 0) {
      throw new Error(`Update archive contains a link entry: ${entry}`);
    }
  }
}

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

function listFiles(root) {
  const out = [];
  const resolvedRoot = path.resolve(root);
  const resolvedRootPrefix = resolvedRoot + path.sep;
  const visit = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const absolute = path.join(dir, entry.name);
      const relative = path.relative(root, absolute);
      if (isProtected(relative)) continue;
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) out.push(normalizeRelative(relative));
      else if (entry.isSymbolicLink()) {
        const resolved = fs.realpathSync(absolute);
        if (!resolved.startsWith(resolvedRootPrefix) || !fs.statSync(resolved).isFile()) {
          throw new Error(`Update staging link points outside the package or not to a regular file: ${normalizeRelative(relative)}`);
        }
        out.push(normalizeRelative(relative));
      }
      else throw new Error(`Update staging contains an unsupported link or file type: ${normalizeRelative(relative)}`);
    }
  };
  visit(root);
  return out;
}

function validateRelativePath(projectRoot, value, label = 'relative path') {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  const raw = value.replace(/\\/g, '/');
  if (!raw || raw.includes('\0') || raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    throw new Error(`${label} contains an unsafe path: ${value}`);
  }
  const segments = raw.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..')) {
    throw new Error(`${label} contains an unsafe path: ${value}`);
  }
  for (const segment of segments) {
    if (/[\u0001-\u001f\u007f<>:"|?*]/.test(segment) || /[. ]$/.test(segment) || segment.includes(':')) {
      throw new Error(`${label} contains an unsafe path: ${value}`);
    }
    const windowsName = segment.replace(/[. ]+$/g, '').toLowerCase();
    const baseName = windowsName.split('.')[0];
    if (WINDOWS_RESERVED_NAMES.has(baseName)) {
      throw new Error(`${label} contains an unsafe path: ${value}`);
    }
  }
  const root = path.resolve(projectRoot);
  const target = path.resolve(root, ...segments);
  const relative = path.relative(root, target);
  if (!relative || path.isAbsolute(relative) || relative.split(path.sep).some(segment => segment === '..')) {
    throw new Error(`${label} contains an unsafe path: ${value}`);
  }
  const normalized = relative.split(path.sep).join('/');
  if (isProtected(normalized)) throw new Error(`${label} contains an unsafe path: ${value}`);
  return normalized;
}

function validateManifestEntries(projectRoot, entries) {
  if (!Array.isArray(entries)) throw new Error('Installed-files manifest is invalid');
  const files = new Set();
  for (const value of entries) files.add(validateRelativePath(projectRoot, value, 'Installed-files manifest'));
  return Array.from(files);
}

function validateTransactionEntries(projectRoot, entries) {
  if (!Array.isArray(entries)) throw new Error('Interrupted update journal is invalid');
  const seen = new Set();
  return entries.map(entry => {
    if (!entry || typeof entry !== 'object' || (entry.action !== 'copy' && entry.action !== 'remove') || typeof entry.existed !== 'boolean') {
      throw new Error('Interrupted update journal contains an invalid entry');
    }
    const relative = validateRelativePath(projectRoot, entry.relative, 'Interrupted update journal');
    if (seen.has(relative)) throw new Error(`Interrupted update journal contains a duplicate path: ${relative}`);
    seen.add(relative);
    return Object.assign({}, entry, { relative });
  });
}

function readInstalledManifest(manifestFile, projectRoot) {
  if (!fs.existsSync(manifestFile)) return { existed: false, files: [] };
  if (fs.lstatSync(manifestFile).isSymbolicLink()) throw new Error('Installed-files manifest must be a regular file');
  const payload = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  if (!payload || payload.version !== 1) throw new Error('Installed-files manifest is invalid');
  return { existed: true, files: validateManifestEntries(projectRoot, payload.files) };
}

function writeInstalledManifest(manifestFile, files) {
  atomicWriteJson(manifestFile, { version: 1, files: files.slice().sort() });
}

function restoreInstalledManifest(manifestFile, backupRoot, manifestState) {
  if (!manifestState) return;
  if (!manifestState.existed) {
    fs.rmSync(manifestFile, { force: true });
    return;
  }
  const backup = path.join(backupRoot, INSTALLED_FILES_MANIFEST);
  fs.mkdirSync(path.dirname(manifestFile), { recursive: true });
  copyFileAtomic(backup, manifestFile);
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

function assertSafeTargetPath(projectRoot, targetPath, options = {}) {
  const root = path.resolve(projectRoot);
  const target = path.resolve(targetPath);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Update target is outside WallHub: ${target}`);
  let current = root;
  const relative = path.relative(root, target);
  const segments = relative.split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    current = path.join(current, segment);
    if (!fs.existsSync(current)) continue;
    if (!fs.lstatSync(current).isSymbolicLink()) continue;
    if (options.allowFinalFileLink && index === segments.length - 1) {
      const resolved = fs.realpathSync(current);
      if (resolved.startsWith(root + path.sep) && fs.statSync(resolved).isFile()) continue;
    }
    throw new Error(`Update target traverses a link: ${current}`);
  }
}

function copyFileAtomic(source, destination) {
  const temporary = `${destination}.${process.pid}.update-tmp`;
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, temporary);
  try { fs.chmodSync(temporary, fs.statSync(source).mode); } catch {}
  fs.rmSync(destination, { force: true });
  fs.renameSync(temporary, destination);
}

function rollbackFiles(projectRoot, backupRoot, journal) {
  const validatedJournal = validateTransactionEntries(projectRoot, journal);
  const errors = [];
  for (const entry of validatedJournal.slice().reverse()) {
    const destination = path.join(projectRoot, entry.relative);
    const backup = path.join(backupRoot, entry.relative);
    try {
      assertSafeTargetPath(projectRoot, destination, { allowFinalFileLink: true });
      if (entry.existed) copyFileAtomic(backup, destination);
      else fs.rmSync(destination, { force: true });
    } catch (error) {
      errors.push(`${entry.relative}: ${error.message || error}`);
    }
  }
  if (errors.length) throw new Error(`Update rollback failed:\n${errors.join('\n')}`);
}

function writeTransactionJournal(journalFile, state, entries, manifest) {
  atomicWriteJson(journalFile, {
    state,
    createdAt: new Date().toISOString(),
    entries,
    manifest: manifest ? { existed: manifest.existed } : undefined,
  });
}

function recoverInterruptedTransaction(projectRoot, updateRoot) {
  const journalFile = path.join(updateRoot, UPDATE_TRANSACTION_FILE);
  if (!fs.existsSync(journalFile)) return false;
  const payload = JSON.parse(fs.readFileSync(journalFile, 'utf8'));
  if (!payload || (payload.state !== undefined && payload.state !== 'applying' && payload.state !== 'committed')) {
    throw new Error('Interrupted update journal is invalid');
  }
  const entries = validateTransactionEntries(projectRoot, payload.entries);
  if (payload.manifest !== undefined && (!payload.manifest || typeof payload.manifest.existed !== 'boolean')) {
    throw new Error('Interrupted update journal manifest is invalid');
  }
  if (payload.state === 'committed') {
    fs.rmSync(journalFile, { force: true });
    return true;
  }
  const backupRoot = path.join(updateRoot, 'backup-previous');
  rollbackFiles(projectRoot, backupRoot, entries);
  restoreInstalledManifest(path.join(updateRoot, INSTALLED_FILES_MANIFEST), backupRoot, payload.manifest);
  fs.rmSync(journalFile, { force: true });
  return true;
}

function applyFiles(staging, projectRoot, backupRoot, journalFile = '', manifestFile = '') {
  const files = listFiles(staging).map(relative => validateRelativePath(projectRoot, relative, 'Update file'));
  const manifestState = manifestFile ? readInstalledManifest(manifestFile, projectRoot) : null;
  const currentFiles = new Set(files);
  const removedFiles = manifestState ? manifestState.files.filter(relative => !currentFiles.has(relative)) : [];
  const journal = files.map(relative => ({ relative, existed: fs.existsSync(path.join(projectRoot, relative)), action: 'copy' }));
  for (const relative of removedFiles) {
    journal.push({ relative, existed: fs.existsSync(path.join(projectRoot, relative)), action: 'remove' });
  }
  fs.rmSync(backupRoot, { recursive: true, force: true });
  fs.mkdirSync(backupRoot, { recursive: true });
  if (manifestState && manifestState.existed) {
    fs.copyFileSync(manifestFile, path.join(backupRoot, INSTALLED_FILES_MANIFEST));
  }
  for (const entry of journal) {
    const destination = path.join(projectRoot, entry.relative);
    assertSafeTargetPath(projectRoot, destination, { allowFinalFileLink: true });
    if (!entry.existed) continue;
    if (!fs.statSync(destination).isFile()) throw new Error(`Update target is not a regular file: ${entry.relative}`);
    const backup = path.join(backupRoot, entry.relative);
    fs.mkdirSync(path.dirname(backup), { recursive: true });
    fs.copyFileSync(destination, backup);
  }
  if (journalFile) writeTransactionJournal(journalFile, 'applying', journal, manifestState);
  try {
    for (const entry of journal) {
      const destination = path.join(projectRoot, entry.relative);
      if (entry.action === 'remove') {
        assertSafeTargetPath(projectRoot, destination, { allowFinalFileLink: true });
        fs.rmSync(destination, { force: true });
      } else {
        copyFileAtomic(path.join(staging, entry.relative), destination);
      }
    }
    if (manifestFile) writeInstalledManifest(manifestFile, files);
    return { entries: journal, manifest: manifestState };
  } catch (error) {
    try {
      rollbackFiles(projectRoot, backupRoot, journal);
      if (manifestFile) restoreInstalledManifest(manifestFile, backupRoot, manifestState);
    } catch (rollbackError) {
      throw new Error(`${error.message || error}\n${rollbackError.message || rollbackError}`);
    }
    throw error;
  }
}

function startRestartProcess(request) {
  if (!request.restartCommand) return;
  const restartEnv = Object.assign({}, process.env, {
    WALLHUB_UPDATE_HELPER: '',
    WALLHUB_UPDATE_RESTART: '1',
    WALLHUB_UPDATE_HEALTH_TOKEN: request.healthToken || '',
  });
  delete restartEnv.WALLHUB_UPDATE_NPM_PROXY;
  const cp = spawn(request.restartCommand, Array.isArray(request.restartArgs) ? request.restartArgs : [], {
    cwd: request.restartCwd || request.projectRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: restartEnv,
  });
  if (!Number.isInteger(cp.pid) || cp.pid <= 1) throw new Error('Could not restart WallHub after the update');
  cp.on('error', () => {});
  return cp;
}

function healthCheck(url, expectedToken) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const client = String(url).startsWith('https:') ? https : http;
      const request = client.get(url, { timeout: 2000 }, response => {
        response.resume();
        const actualToken = String(response.headers['x-wallhub-health-token'] || '');
        finish(response.statusCode === 200 && !!expectedToken && actualToken === String(expectedToken));
      });
      request.on('timeout', () => { request.destroy(); finish(false); });
      request.on('error', () => finish(false));
    } catch {
      finish(false);
    }
  });
}

async function restartAndWait(request, timeoutMs = 60000) {
  if (!request.healthToken) request.healthToken = crypto.randomBytes(32).toString('hex');
  const cp = startRestartProcess(request);
  const deadline = Date.now() + timeoutMs;
  let consecutive = 0;
  while (Date.now() < deadline) {
    if (cp.exitCode !== null || cp.signalCode !== null) break;
    if (await healthCheck(request.healthUrl || 'http://127.0.0.1:3090/health', request.healthToken)) {
      consecutive += 1;
      if (consecutive >= 3) {
        cp.unref();
        return cp;
      }
    } else {
      consecutive = 0;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  stopProcessTree(cp.pid);
  throw new Error('Updated WallHub did not pass its startup health check');
}

function stopProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return;
  if (process.platform === 'win32') {
    try { run('taskkill', ['/pid', String(pid), '/T', '/F']); } catch {}
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
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
  await waitForProcesses(request.waitProcesses || (request.waitPids || []).map(Number).filter(Number.isInteger));
  recoverInterruptedTransaction(projectRoot, updateRoot);
  fs.rmSync(staging, { recursive: true, force: true });
  const actualHash = sha256FileSync(archive);
  if (actualHash !== String(request.expectedHash).toLowerCase()) throw new Error('Update archive changed after SHA-256 verification');
  extractZip(archive, staging);
  validateStaging(staging, request.targetVersion);
  if (request.mode === 'source') prepareSourceDependencies(staging);
  const transaction = applyFiles(staging, projectRoot, backupRoot, journalFile, path.join(updateRoot, INSTALLED_FILES_MANIFEST));
  const journal = transaction.entries;
  try {
    await restartAndWait(request, Number(request.healthTimeoutMs) || 60000);
  } catch (error) {
    rollbackFiles(projectRoot, backupRoot, journal);
    restoreInstalledManifest(path.join(updateRoot, INSTALLED_FILES_MANIFEST), backupRoot, transaction.manifest);
    await restartAndWait(request, Number(request.healthTimeoutMs) || 60000);
    fs.rmSync(journalFile, { force: true });
    error.recoveryRestarted = true;
    throw error;
  }
  writeTransactionJournal(journalFile, 'committed', journal, transaction.manifest);
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
