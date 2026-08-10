'use strict';

const path = require('path');

const DEFAULT_REPOSITORY = 'ChEnLeo-7/WallHub2.0';

function parseVersion(value) {
  const match = String(value || '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] || '',
  };
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error(`Invalid semantic version: ${!a ? left : right}`);
  for (const key of ['major', 'minor', 'patch']) {
    if (a[key] !== b[key]) return a[key] > b[key] ? 1 : -1;
  }
  if (a.prerelease === b.prerelease) return 0;
  if (!a.prerelease) return 1;
  if (!b.prerelease) return -1;
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true });
}

function normalizeRepository(value) {
  const repository = String(value || DEFAULT_REPOSITORY).trim();
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('Invalid GitHub repository');
  }
  return repository;
}

function normalizeArchitecture(arch) {
  if (arch === 'x64') return 'x64';
  if (arch === 'arm64') return 'arm64';
  return String(arch || 'unknown');
}

function detectInstallMode(options = {}) {
  const env = options.env || process.env;
  if (env.DOCKER_CONTAINER || env.CONTAINER || env.KUBERNETES_SERVICE_HOST) return 'docker';
  if (env.WALLHUB_LAUNCHER === '1') return 'portable';
  return 'source';
}

function releaseVersion(release) {
  const tag = String(release && release.tag_name || '').trim();
  const parsed = parseVersion(tag);
  return parsed ? tag.replace(/^v/i, '') : '';
}

function findReleaseAsset(release, name) {
  return Array.isArray(release && release.assets)
    ? release.assets.find(asset => String(asset && asset.name || '') === name) || null
    : null;
}

function selectReleaseAsset(release, options = {}) {
  const mode = options.mode || detectInstallMode(options);
  if (mode === 'docker') return null;
  const platform = options.platform || process.platform;
  const arch = normalizeArchitecture(options.arch || process.arch);
  const name = mode === 'portable'
    ? `WallHub-Portable-win-${arch}.zip`
    : 'WallHub-Source.zip';
  if (mode === 'portable' && platform !== 'win32') return null;
  const asset = findReleaseAsset(release, name);
  if (!asset) return null;
  return {
    name,
    url: String(asset.browser_download_url || ''),
    size: Number(asset.size || 0),
    checksumName: `${name}.sha256`,
  };
}

function parseChecksum(value, expectedName) {
  const text = Buffer.isBuffer(value) ? value.toString('utf8') : String(value || '');
  const match = text.trim().match(/^([a-fA-F0-9]{64})(?:\s+\*?(.+))?$/);
  if (!match) throw new Error('Invalid SHA-256 checksum file');
  if (match[2] && path.basename(match[2].trim()) !== expectedName) {
    throw new Error('SHA-256 checksum filename does not match the update asset');
  }
  return match[1].toLowerCase();
}

function parseReleaseChecksum(value, expectedName) {
  const name = String(expectedName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(value || '').match(new RegExp('^\\s*-\\s*`' + name + '`\\s*:\\s*([a-fA-F0-9]{64})\\s*$', 'im'));
  return match ? match[1].toLowerCase() : null;
}

module.exports = {
  DEFAULT_REPOSITORY,
  parseVersion,
  compareVersions,
  normalizeRepository,
  normalizeArchitecture,
  detectInstallMode,
  releaseVersion,
  findReleaseAsset,
  selectReleaseAsset,
  parseChecksum,
  parseReleaseChecksum,
};
