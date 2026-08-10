'use strict';

const path = require('path');

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

module.exports = {
  PROTECTED_PATHS,
  MAX_EXPANDED_BYTES,
  normalizeRelative,
  isProtected,
  validateArchiveEntries,
  validateRelativePath,
  validateManifestEntries,
  validateTransactionEntries,
};
