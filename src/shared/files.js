'use strict';

const fs = require('fs');
const path = require('path');

function safeName(value) {
  return String(value || '')
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
}

function extFromUrl(url, fallback) {
  try {
    const pathname = new URL(url).pathname || '';
    const ext = path.extname(pathname).toLowerCase();
    if (ext && ext.length <= 8) return ext;
  } catch {}
  return fallback || '.bin';
}

function extFromPath(filePath, fallback) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return (ext && ext.length <= 8) ? ext : (fallback || '.bin');
}

function findFirstFileInDir(dir, predicate) {
  if (!fs.existsSync(dir)) return null;
  const queue = [dir];
  while (queue.length) {
    const current = queue.shift();
    let entries = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(filePath);
        continue;
      }
      if (entry.isFile() && predicate(filePath, entry)) return filePath;
    }
  }
  return null;
}

function listFilesRecursive(root) {
  const out = [];
  const walk = (dir) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(filePath);
      else if (entry.isFile()) out.push(filePath);
    }
  };
  walk(root);
  return out;
}

function findFirstVideoInDir(dir, isVideoExt) {
  return findFirstFileInDir(dir, filePath => isVideoExt(path.extname(filePath)));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  safeName,
  extFromUrl,
  extFromPath,
  findFirstFileInDir,
  listFilesRecursive,
  findFirstVideoInDir,
  ensureDir,
};
