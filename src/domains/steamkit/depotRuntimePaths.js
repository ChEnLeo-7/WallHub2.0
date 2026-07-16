'use strict';

const fs = require('fs');
const path = require('path');

function pathLooksExecutable(filePath) {
  try {
    return !!filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

function depotExecutableNames(options = {}) {
  if (options.isTermuxLikeEnv || options.isAndroidHostLikeEnv) {
    return ['DepotDownloader.dll', 'DepotDownloader', 'DepotDownloader.exe'];
  }
  return process.platform === 'win32'
    ? ['DepotDownloader.exe', 'DepotDownloader.dll', 'DepotDownloader']
    : ['DepotDownloader', 'DepotDownloader.dll', 'DepotDownloader.exe'];
}

function findDepotDownloaderRecursive(root, options = {}) {
  if (!root || !fs.existsSync(root)) return null;
  const names = new Set(depotExecutableNames(options).map(name => name.toLowerCase()));
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const filePath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stack.push(filePath);
      } else if (entry.isFile() && names.has(entry.name.toLowerCase())) {
        return filePath;
      }
    }
  }
  return null;
}

function resolveDepotRuntimePath(runtimeDir, directPath, options = {}) {
  const direct = String(directPath || '').trim();
  if (!direct && options.requireStamp !== false) {
    const stamp = options.stampPath || '';
    try {
      const data = stamp && fs.existsSync(stamp) ? JSON.parse(fs.readFileSync(stamp, 'utf8')) : null;
      if (!data || data.patchVersion !== options.patchVersion) return '';
    } catch {
      return '';
    }
  }

  const candidates = [];
  if (direct) candidates.push(direct);
  depotExecutableNames(options).forEach(name => candidates.push(path.join(runtimeDir, name)));
  for (const candidate of candidates) {
    if (pathLooksExecutable(candidate)) return candidate;
  }
  return findDepotDownloaderRecursive(runtimeDir, options);
}

function resolveDepotDownloaderPath(options = {}) {
  const direct = String(options.directPath || '').trim();
  const downloaderDir = options.downloaderDir || '';
  const candidates = [];
  const addCandidate = candidate => {
    if (candidate) candidates.push(candidate);
  };
  const addDir = dir => {
    if (!dir) return;
    depotExecutableNames(options).forEach(name => addCandidate(path.join(dir, name)));
  };

  if (direct) {
    addCandidate(direct);
    try {
      if (fs.existsSync(direct) && fs.statSync(direct).isDirectory()) addDir(direct);
    } catch {}
  }
  addDir(downloaderDir);

  for (const candidate of candidates) {
    if (pathLooksExecutable(candidate)) return candidate;
  }
  return findDepotDownloaderRecursive(downloaderDir, options);
}

function findDepotRuntimeConfig(executable) {
  const dir = path.dirname(executable);
  const base = path.basename(executable, path.extname(executable));
  const candidates = [
    path.join(dir, `${base}.runtimeconfig.json`),
    path.join(dir, 'DepotDownloader.runtimeconfig.json'),
  ];
  for (const filePath of candidates) {
    if (fs.existsSync(filePath)) return filePath;
  }

  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const filePath = path.join(current, entry.name);
      if (entry.isDirectory()) stack.push(filePath);
      else if (entry.isFile() && /\.runtimeconfig\.json$/i.test(entry.name)) return filePath;
    }
  }
  return '';
}

function getDepotRequiredDotnetVersion(executable, logger = console) {
  const configPath = findDepotRuntimeConfig(executable);
  if (!configPath) return '';
  try {
    const data = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    const options = data.runtimeOptions || {};
    const frameworks = Array.isArray(options.frameworks)
      ? options.frameworks
      : (options.framework ? [options.framework] : []);
    const framework = frameworks.find(item => String((item && item.name) || '') === 'Microsoft.NETCore.App') || frameworks[0];
    return String((framework && framework.version) || '').trim();
  } catch (error) {
    logger.warn('[SteamKit] Failed to read runtimeconfig:', error.message);
    return '';
  }
}

function depotRuntimeStampCandidates(executable, fallbackStampPath) {
  const rows = [];
  const add = candidate => {
    const value = String(candidate || '').trim();
    if (value && !rows.includes(value)) rows.push(value);
  };
  const base = path.basename(String(fallbackStampPath || ''));
  if (executable && base) add(path.join(path.dirname(executable), base));
  add(fallbackStampPath);
  return rows;
}

function depotRuntimeStampMatches(executable, fallbackStampPath, patchVersion) {
  for (const stamp of depotRuntimeStampCandidates(executable, fallbackStampPath)) {
    try {
      const data = stamp && fs.existsSync(stamp) ? JSON.parse(fs.readFileSync(stamp, 'utf8')) : null;
      if (data && data.patchVersion === patchVersion) return true;
    } catch {}
  }
  return false;
}

function createDepotRuntimePaths(options = {}) {
  const envOptions = () => ({
    isTermuxLikeEnv: !!(options.isTermuxLikeEnv && options.isTermuxLikeEnv()),
    isAndroidHostLikeEnv: !!(options.isAndroidHostLikeEnv && options.isAndroidHostLikeEnv()),
  });

  return {
    pathLooksExecutable,
    depotExecutableNames: () => depotExecutableNames(envOptions()),
    findDepotDownloaderRecursive: root => findDepotDownloaderRecursive(root, envOptions()),
    resolveDepotRuntimePath: (runtimeDir, directPath, runtimeOptions = {}) => resolveDepotRuntimePath(
      runtimeDir,
      directPath,
      Object.assign({}, envOptions(), runtimeOptions)
    ),
    resolveDepotDownloaderPath: runtimeOptions => resolveDepotDownloaderPath(Object.assign({}, envOptions(), runtimeOptions)),
    findDepotRuntimeConfig,
    getDepotRequiredDotnetVersion: executable => getDepotRequiredDotnetVersion(executable, options.logger || console),
    depotRuntimeStampCandidates,
    depotRuntimeStampMatches,
  };
}

module.exports = {
  pathLooksExecutable,
  depotExecutableNames,
  findDepotDownloaderRecursive,
  resolveDepotRuntimePath,
  resolveDepotDownloaderPath,
  findDepotRuntimeConfig,
  getDepotRequiredDotnetVersion,
  depotRuntimeStampCandidates,
  depotRuntimeStampMatches,
  createDepotRuntimePaths,
};
