'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const {
  depotRuntimeStampMatches,
  readJsonFile,
  resolveDepotRuntimePath,
} = require('./depotRuntimePaths');

test('SteamKit runtime stamps accept UTF-8 BOM without requiring a rebuild', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-depot-stamp-'));
  try {
    const executable = path.join(root, 'DepotDownloader.exe');
    const stamp = path.join(root, '.wallhub-json-progress-build.json');
    fs.writeFileSync(executable, 'runtime');
    fs.writeFileSync(stamp, `\uFEFF${JSON.stringify({ patchVersion: 'test-patch' })}`, 'utf8');

    assert.deepEqual(readJsonFile(stamp), { patchVersion: 'test-patch' });
    assert.equal(depotRuntimeStampMatches(executable, stamp, 'test-patch'), true);
    assert.equal(resolveDepotRuntimePath(root, '', { stampPath: stamp, patchVersion: 'test-patch' }), executable);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit runtime stamps still reject a different patch version', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-depot-stamp-version-'));
  try {
    const executable = path.join(root, 'DepotDownloader.exe');
    const stamp = path.join(root, '.wallhub-json-progress-build.json');
    fs.writeFileSync(executable, 'runtime');
    fs.writeFileSync(stamp, JSON.stringify({ patchVersion: 'old-patch' }), 'utf8');

    assert.equal(depotRuntimeStampMatches(executable, stamp, 'new-patch'), false);
    assert.equal(resolveDepotRuntimePath(root, '', { stampPath: stamp, patchVersion: 'new-patch' }), '');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
