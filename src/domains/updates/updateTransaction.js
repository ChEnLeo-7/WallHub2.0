'use strict';

const fs = require('fs');
const path = require('path');
const manifestSafetyPath = fs.existsSync(path.join(__dirname, 'manifestSafety.js'))
  ? './manifestSafety'
  : '../../src/domains/updates/manifestSafety';
const {
  normalizeRelative,
  isProtected,
  validateRelativePath,
  validateManifestEntries,
  validateTransactionEntries,
} = require(manifestSafetyPath);
const { atomicWriteJson } = require('./updaterProcess');

const INSTALLED_FILES_MANIFEST = 'installed-files.json';
const UPDATE_TRANSACTION_FILE = 'update-transaction.json';

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
      } else throw new Error(`Update staging contains an unsupported link or file type: ${normalizeRelative(relative)}`);
    }
  };
  visit(root);
  return out;
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

function assertSafeTargetPath(projectRoot, targetPath, options = {}) {
  const root = path.resolve(projectRoot);
  const target = path.resolve(targetPath);
  if (target !== root && !target.startsWith(root + path.sep)) throw new Error(`Update target is outside WallHub: ${target}`);
  let current = root;
  const relative = path.relative(root, target);
  const segments = relative.split(path.sep).filter(Boolean);
  for (let index = 0; index < segments.length; index += 1) {
    current = path.join(current, segments[index]);
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

module.exports = {
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
};
