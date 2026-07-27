'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const net = require('net');
const { spawnSync } = require('child_process');
const {
  compareVersions,
  detectInstallMode,
  parseChecksum,
  selectReleaseAsset,
  updaterLaunchRequest,
  spawnDetachedUpdater,
  UPDATE_REQUEST_FILE,
  isUpdateMutationAllowed,
  createUpdateService,
} = require('./service');
const {
  acquireUpdateLock,
  INSTALLED_FILES_MANIFEST,
  releaseUpdateLock,
  prepareSourceDependencies,
  isProtected,
  validateArchiveEntries,
  validateRelativePath,
  validateTransactionEntries,
  validateStaging,
  assertSafeTargetPath,
  recoverInterruptedTransaction,
  applyFiles,
  applyUpdate,
} = require('../../../tools/update/apply-update');

function release(version = '2.1.0') {
  return {
    tag_name: `v${version}`,
    html_url: `https://github.com/example/project/releases/tag/v${version}`,
    body: 'notes',
    assets: [
      { name: 'WallHub-Portable-win-x64.zip', browser_download_url: 'https://github.com/portable.zip', size: 100 },
      { name: 'WallHub-Portable-win-x64.zip.sha256', browser_download_url: 'https://github.com/portable.sha256', size: 96 },
      { name: 'WallHub-Source.zip', browser_download_url: 'https://github.com/source.zip', size: 80 },
      { name: 'WallHub-Source.zip.sha256', browser_download_url: 'https://github.com/source.sha256', size: 88 },
    ],
  };
}

test('semantic version comparison handles stable releases', () => {
  assert.equal(compareVersions('2.1.0', '2.0.9'), 1);
  assert.equal(compareVersions('v2.0.1', '2.0.1'), 0);
  assert.equal(compareVersions('2.0.1-beta.1', '2.0.1'), -1);
});

test('install mode distinguishes Docker, launcher packages, and source', () => {
  assert.equal(detectInstallMode({ env: { DOCKER_CONTAINER: '1' } }), 'docker');
  assert.equal(detectInstallMode({ env: { WALLHUB_LAUNCHER: '1' } }), 'portable');
  assert.equal(detectInstallMode({ env: {} }), 'source');
});

test('release asset selection uses portable package or cross-platform source bundle', () => {
  assert.equal(selectReleaseAsset(release(), { mode: 'portable', platform: 'win32', arch: 'x64' }).name, 'WallHub-Portable-win-x64.zip');
  assert.equal(selectReleaseAsset(release(), { mode: 'source', platform: 'linux', arch: 'arm64' }).name, 'WallHub-Source.zip');
  assert.equal(selectReleaseAsset(release(), { mode: 'docker', platform: 'linux', arch: 'x64' }), null);
});

test('checksum parsing rejects a mismatched filename', () => {
  const hash = 'a'.repeat(64);
  assert.equal(parseChecksum(`${hash}  WallHub-Source.zip`, 'WallHub-Source.zip'), hash);
  assert.throws(() => parseChecksum(`${hash}  other.zip`, 'WallHub-Source.zip'), /filename/);
});

test('update mutations require loopback when Origin is absent but allow same-origin LAN requests', () => {
  assert.equal(isUpdateMutationAllowed({ headers: {}, socket: { remoteAddress: '127.0.0.1' } }), true);
  assert.equal(isUpdateMutationAllowed({ headers: {}, socket: { remoteAddress: '::1' } }), true);
  assert.equal(isUpdateMutationAllowed({ headers: {}, socket: { remoteAddress: '192.168.1.20' } }), false);
  assert.equal(isUpdateMutationAllowed({
    headers: { origin: 'http://wallhub.lan:3090', host: 'wallhub.lan:3090' },
    socket: { remoteAddress: '192.168.1.20' },
  }), true);
  assert.equal(isUpdateMutationAllowed({
    headers: { origin: 'http://evil.example', host: 'wallhub.lan:3090' },
    socket: { remoteAddress: '192.168.1.20' },
  }), false);
  assert.equal(isUpdateMutationAllowed({
    headers: { origin: 'http://wallhub.lan:3090', host: 'wallhub.lan:3090', 'sec-fetch-site': 'cross-site' },
    socket: { remoteAddress: '192.168.1.20' },
  }), false);
});

test('update lock blocks a live owner and removes a crashed owner lock', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-update-lock-'));
  const updateRoot = path.join(root, 'updates');
  const first = acquireUpdateLock(updateRoot);
  const firstLock = JSON.parse(fs.readFileSync(path.join(updateRoot, 'update-lock.json'), 'utf8'));
  assert.match(firstLock.ownerToken, /^[a-f0-9]{32}$/);
  assert.ok(firstLock.processIdentity === null || typeof firstLock.processIdentity.startToken === 'string');
  assert.throws(() => acquireUpdateLock(updateRoot), /already in progress/);
  releaseUpdateLock(first);

  fs.mkdirSync(updateRoot, { recursive: true });
  fs.writeFileSync(path.join(updateRoot, 'update-lock.json'), JSON.stringify({ pid: 2147483647, startedAt: Date.now() }));
  const recovered = acquireUpdateLock(updateRoot, { staleMs: 60 * 60 * 1000 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(updateRoot, 'update-lock.json'), 'utf8')).pid, process.pid);
  releaseUpdateLock(recovered);
  assert.equal(fs.existsSync(path.join(updateRoot, 'update-lock.json')), false);
});

test('source dependency preparation maps helper proxy environment to npm without changing the request', () => {
  let captured = null;
  prepareSourceDependencies('/tmp/wallhub-staging', {
    PATH: 'test-path',
    WALLHUB_UPDATE_NPM_PROXY: 'http://user:secret@example.test:8080',
  }, (_command, _args, options) => { captured = options; });
  assert.equal(captured.env.npm_config_proxy, 'http://user:secret@example.test:8080');
  assert.equal(captured.env.npm_config_https_proxy, 'http://user:secret@example.test:8080');
  assert.equal(captured.env.WALLHUB_UPDATE_NPM_PROXY, 'http://user:secret@example.test:8080');
});

test('update service checks, downloads, verifies, and prepares an install', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-update-service-'));
  const payload = Buffer.from('verified archive');
  const hash = require('crypto').createHash('sha256').update(payload).digest('hex');
  let spawned = null;
  let spawnedOptions = null;
  const service = createUpdateService({
    currentVersion: '2.0.1',
    projectRoot: root,
    mode: 'source',
    platform: 'linux',
    arch: 'x64',
    requestBuffer: async (url) => url.includes('sha256') ? Buffer.from(`${hash}  WallHub-Source.zip`) : Buffer.from(JSON.stringify(release())),
    downloadFile: async (_url, destination, options) => {
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, payload);
      options.onProgress(payload.length, payload.length);
    },
    getProxyUrl: () => 'http://user:secret@example.test:8080',
    spawnUpdater(request, options) { spawned = request; spawnedOptions = options; return { pid: 123 }; },
    updaterScript: __filename,
  });

  const checked = await service.checkNow();
  assert.equal(checked.status, 'available');
  assert.equal(checked.latestVersion, '2.1.0');
  service.startDownload();
  await service._waitForDownload();
  assert.equal(service.snapshot().status, 'downloaded');
  service.installDownloaded();
  assert.equal(service.snapshot().status, 'installing');
  assert.equal(spawned.targetVersion, '2.1.0');
  assert.equal(spawned.proxyUrl, undefined);
  assert.equal(spawnedOptions.env.WALLHUB_UPDATE_NPM_PROXY, 'http://user:secret@example.test:8080');
  service.stopSchedule();
});

test('updater request waits for the launcher when applying a portable package', () => {
  const request = updaterLaunchRequest({ mode: 'portable', projectRoot: 'C:\\WallHub', archive: 'update.zip', targetVersion: '2.1.0', launcherPid: 4242 });
  assert.equal(request.mode, 'portable');
  assert.ok(request.waitPids.includes(process.pid));
  assert.ok(request.waitPids.includes(4242));
  assert.match(request.restartCommand, /WallHub\.exe$/);
  assert.equal(request.markerFile, path.join('C:\\WallHub', 'updates', UPDATE_REQUEST_FILE));
  assert.equal(request.requestPath, request.markerFile);
  assert.match(request.healthToken, /^[a-f0-9]{64}$/);
});

test('persistent updater request excludes proxy fields', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-update-request-'));
  const helperSource = path.join(root, 'helper-source.js');
  fs.writeFileSync(helperSource, 'process.exit(0);');
  const request = updaterLaunchRequest({ mode: 'source', projectRoot: root, archive: path.join(root, 'updates', 'source.zip'), targetVersion: '2.1.0' });
  request.proxyUrl = 'http://user:secret@example.test:8080';
  request.updateProxy = 'http://user:secret@example.test:8080';
  request.WALLHUB_UPDATE_NPM_PROXY = 'http://user:secret@example.test:8080';
  const helper = spawnDetachedUpdater(request, { scriptPath: helperSource, env: { WALLHUB_UPDATE_NPM_PROXY: request.proxyUrl } });
  const persisted = JSON.parse(fs.readFileSync(request.requestPath, 'utf8'));
  assert.equal(persisted.requestPath, request.requestPath);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'proxyUrl'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'updateProxy'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(persisted, 'WALLHUB_UPDATE_NPM_PROXY'), false);
  await new Promise(resolve => setTimeout(resolve, 50));
  try { fs.rmSync(request.requestPath, { force: true }); } catch {}
  try { fs.rmSync(helper.tempDir, { recursive: true, force: true }); } catch {}
});

test('updater protects runtime data and rolls program files forward', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-apply-root-'));
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-apply-staging-'));
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-apply-backup-'));
  fs.mkdirSync(path.join(staging, 'public'), { recursive: true });
  fs.writeFileSync(path.join(staging, 'server.js'), 'new');
  fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ version: '2.1.0' }));
  fs.writeFileSync(path.join(staging, 'public', 'index.html'), 'new ui');
  fs.mkdirSync(path.join(staging, 'Downloads'), { recursive: true });
  fs.writeFileSync(path.join(staging, 'Downloads', 'should-not-copy'), 'x');
  fs.writeFileSync(path.join(root, 'server.js'), 'old');
  fs.mkdirSync(path.join(root, 'Downloads'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Downloads', 'keep'), 'data');

  validateStaging(staging, '2.1.0');
  applyFiles(staging, root, backup);

  assert.equal(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), 'new');
  assert.equal(fs.readFileSync(path.join(root, 'Downloads', 'keep'), 'utf8'), 'data');
  assert.equal(fs.existsSync(path.join(root, 'Downloads', 'should-not-copy')), false);
  assert.equal(isProtected('SteamKit/account/session.bin'), true);
  assert.equal(isProtected('STEAMKIT/ACCOUNT/session.bin'), true);
  assert.equal(isProtected('DOWNLOADS/user-file.zip'), true);
});

test('installed-files manifest removes only known old program files and restores them', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-manifest-root-'));
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-manifest-staging-'));
  const updateRoot = path.join(root, 'updates');
  const backup = path.join(updateRoot, 'backup-previous');
  const journal = path.join(updateRoot, 'update-transaction.json');
  const manifest = path.join(updateRoot, INSTALLED_FILES_MANIFEST);
  fs.mkdirSync(path.join(staging, 'public'), { recursive: true });
  fs.writeFileSync(path.join(staging, 'server.js'), 'new');
  fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ version: '2.1.0' }));
  fs.writeFileSync(path.join(staging, 'public', 'index.html'), 'new ui');
  fs.writeFileSync(path.join(root, 'server.js'), 'old');
  fs.writeFileSync(path.join(root, 'obsolete.js'), 'old program file');
  fs.writeFileSync(path.join(root, 'user-file.txt'), 'user file');
  fs.mkdirSync(updateRoot, { recursive: true });
  fs.writeFileSync(manifest, JSON.stringify({ version: 1, files: ['obsolete.js', 'server.js'] }));

  applyFiles(staging, root, backup, journal, manifest);
  assert.equal(fs.existsSync(path.join(root, 'obsolete.js')), false);
  assert.equal(fs.readFileSync(path.join(root, 'user-file.txt'), 'utf8'), 'user file');
  assert.deepEqual(JSON.parse(fs.readFileSync(manifest, 'utf8')).files, ['package.json', 'public/index.html', 'server.js']);

  assert.equal(recoverInterruptedTransaction(root, updateRoot), true);
  assert.equal(fs.readFileSync(path.join(root, 'obsolete.js'), 'utf8'), 'old program file');
  assert.deepEqual(JSON.parse(fs.readFileSync(manifest, 'utf8')).files, ['obsolete.js', 'server.js']);
});

test('manifest and journal paths reject platform-equivalent unsafe forms', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-relative-paths-'));
  for (const value of [
    '.', '..', 'foo//bar', 'foo/../bar', '/absolute', 'C:/absolute',
    'foo\0bar', 'file.', 'file ', 'file:name', 'CON.txt',
  ]) {
    assert.throws(() => validateRelativePath(root, value), /unsafe path/);
  }
  assert.deepEqual(validateTransactionEntries(root, [{ relative: 'public/index.html', existed: false, action: 'copy' }]), [
    { relative: 'public/index.html', existed: false, action: 'copy' },
  ]);
  assert.throws(() => validateTransactionEntries(root, [
    { relative: 'public/index.html', existed: false, action: 'copy' },
    { relative: 'public/index.html', existed: false, action: 'remove' },
  ]), /duplicate/);
});

test('manifest rejects dot-segment attempts to delete protected files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-manifest-protected-'));
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-manifest-protected-stage-'));
  const updateRoot = path.join(root, 'updates');
  const manifest = path.join(updateRoot, INSTALLED_FILES_MANIFEST);
  fs.mkdirSync(path.join(staging, 'public'), { recursive: true });
  fs.writeFileSync(path.join(staging, 'server.js'), 'new');
  fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ version: '2.1.0' }));
  fs.writeFileSync(path.join(staging, 'public', 'index.html'), 'new ui');
  fs.mkdirSync(path.join(root, 'Downloads'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Downloads', 'keep'), 'user data');
  fs.mkdirSync(updateRoot, { recursive: true });
  fs.writeFileSync(manifest, JSON.stringify({ version: 1, files: ['foo/../Downloads/keep'] }));
  assert.throws(() => applyFiles(staging, root, path.join(updateRoot, 'backup-previous'), '', manifest), /unsafe path/);
  assert.equal(fs.readFileSync(path.join(root, 'Downloads', 'keep'), 'utf8'), 'user data');
});

test('first update without an installed-files manifest does not delete unknown files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-manifest-first-root-'));
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-manifest-first-staging-'));
  const updateRoot = path.join(root, 'updates');
  const manifest = path.join(updateRoot, INSTALLED_FILES_MANIFEST);
  fs.mkdirSync(path.join(staging, 'public'), { recursive: true });
  fs.writeFileSync(path.join(staging, 'server.js'), 'new');
  fs.writeFileSync(path.join(staging, 'package.json'), JSON.stringify({ version: '2.1.0' }));
  fs.writeFileSync(path.join(staging, 'public', 'index.html'), 'new ui');
  fs.writeFileSync(path.join(root, 'unknown-user-file.txt'), 'keep');

  applyFiles(staging, root, path.join(updateRoot, 'backup-previous'), '', manifest);
  assert.equal(fs.readFileSync(path.join(root, 'unknown-user-file.txt'), 'utf8'), 'keep');
  assert.equal(JSON.parse(fs.readFileSync(manifest, 'utf8')).version, 1);
});

test('updater rejects archive paths outside its staging directory', () => {
  assert.doesNotThrow(() => validateArchiveEntries(['public/index.html', 'src/app/router.js'], '/tmp/staging'));
  assert.throws(() => validateArchiveEntries(['../outside.txt'], '/tmp/staging'), /unsafe path/);
  assert.throws(() => validateArchiveEntries(['/absolute.txt'], '/tmp/staging'), /unsafe path/);
  assert.throws(() => validateArchiveEntries([{ name: 'public/link', externalAttributes: 0xa000 << 16 }], '/tmp/staging'), /link entry/);
  assert.throws(() => validateArchiveEntries([{ name: 'large.bin', length: 5 * 1024 * 1024 * 1024 }], '/tmp/staging'), /invalid size/);
});

test('updater restores a persisted interrupted transaction', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-recover-root-'));
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-recover-staging-'));
  const updateRoot = path.join(root, 'updates');
  const backup = path.join(updateRoot, 'backup-previous');
  const journal = path.join(updateRoot, 'update-transaction.json');
  fs.writeFileSync(path.join(root, 'server.js'), 'old');
  fs.writeFileSync(path.join(staging, 'server.js'), 'new');

  applyFiles(staging, root, backup, journal);
  assert.equal(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), 'new');
  assert.equal(recoverInterruptedTransaction(root, updateRoot), true);
  assert.equal(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), 'old');
  assert.equal(fs.existsSync(journal), false);
});

test('updater finalizes a committed transaction without rolling it back', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-committed-root-'));
  const updateRoot = path.join(root, 'updates');
  const journal = path.join(updateRoot, 'update-transaction.json');
  fs.mkdirSync(updateRoot, { recursive: true });
  fs.writeFileSync(path.join(root, 'server.js'), 'new');
  fs.writeFileSync(journal, JSON.stringify({
    state: 'committed',
    entries: [{ relative: 'server.js', existed: true, action: 'copy' }],
  }));
  assert.equal(recoverInterruptedTransaction(root, updateRoot), true);
  assert.equal(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), 'new');
  assert.equal(fs.existsSync(journal), false);
});

test('updater refuses a corrupted journal before touching files', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-corrupt-journal-root-'));
  const updateRoot = path.join(root, 'updates');
  const journal = path.join(updateRoot, 'update-transaction.json');
  fs.mkdirSync(updateRoot, { recursive: true });
  fs.mkdirSync(path.join(root, 'Downloads'), { recursive: true });
  fs.writeFileSync(path.join(root, 'Downloads', 'keep'), 'user data');
  fs.writeFileSync(journal, JSON.stringify({
    state: 'applying',
    entries: [{ relative: 'foo/../Downloads/keep', existed: false, action: 'remove' }],
  }));
  assert.throws(() => recoverInterruptedTransaction(root, updateRoot), /unsafe path/);
  assert.equal(fs.readFileSync(path.join(root, 'Downloads', 'keep'), 'utf8'), 'user data');
});

test('updater refuses to write through a target directory link', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-link-root-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-link-outside-'));
  const link = path.join(root, 'linked');
  try {
    fs.symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    t.skip(`directory links are unavailable: ${error.message}`);
    return;
  }
  assert.throws(() => assertSafeTargetPath(root, path.join(link, 'file.txt')), /traverses a link/);
});

test('updater dereferences an npm-style internal staging link into a regular file', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-bin-root-'));
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-bin-staging-'));
  const backup = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-bin-backup-'));
  const packageBin = path.join(staging, 'node_modules', 'example', 'cli.js');
  const binLink = path.join(staging, 'node_modules', '.bin', 'example');
  const installedPackageBin = path.join(root, 'node_modules', 'example', 'cli.js');
  const installedBinLink = path.join(root, 'node_modules', '.bin', 'example');
  fs.mkdirSync(path.dirname(packageBin), { recursive: true });
  fs.mkdirSync(path.dirname(binLink), { recursive: true });
  fs.mkdirSync(path.dirname(installedPackageBin), { recursive: true });
  fs.mkdirSync(path.dirname(installedBinLink), { recursive: true });
  fs.writeFileSync(packageBin, '#!/usr/bin/env node\n');
  fs.writeFileSync(installedPackageBin, '#!/usr/bin/env node\n// old\n');
  try {
    fs.symlinkSync(path.relative(path.dirname(binLink), packageBin), binLink, 'file');
    fs.symlinkSync(path.relative(path.dirname(installedBinLink), installedPackageBin), installedBinLink, 'file');
  } catch (error) {
    t.skip(`file links are unavailable: ${error.message}`);
    return;
  }
  applyFiles(staging, root, backup);
  assert.equal(fs.lstatSync(installedBinLink).isSymbolicLink(), false);
  assert.equal(fs.readFileSync(installedBinLink, 'utf8'), '#!/usr/bin/env node\n');
});

test('manual and automatic downloads share one in-flight operation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-update-concurrent-'));
  const payload = Buffer.from('one download');
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  let downloadCount = 0;
  let releaseDownload;
  const holdDownload = new Promise(resolve => { releaseDownload = resolve; });
  const service = createUpdateService({
    currentVersion: '2.0.1',
    projectRoot: root,
    mode: 'source',
    getAutoUpdateEnabled: () => true,
    isInstallSafe: () => false,
    requestBuffer: async (url) => url.includes('sha256') ? Buffer.from(`${hash}  WallHub-Source.zip`) : Buffer.from(JSON.stringify(release())),
    downloadFile: async (_url, destination) => {
      downloadCount += 1;
      await holdDownload;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, payload);
    },
  });
  await service.checkNow();
  service.startDownload();
  const automatic = service.runAutomatic();
  releaseDownload();
  await Promise.all([service._waitForDownload(), automatic]);
  assert.equal(downloadCount, 1);
  service.stopSchedule();
});

test('a check requested during download waits for the stable download snapshot', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-update-check-download-'));
  const payload = Buffer.from('stable download');
  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  let releaseCalls = 0;
  let releaseDownload;
  const holdDownload = new Promise(resolve => { releaseDownload = resolve; });
  const service = createUpdateService({
    currentVersion: '2.0.1',
    projectRoot: root,
    mode: 'source',
    requestBuffer: async (url) => {
      if (url.includes('sha256')) return Buffer.from(`${hash}  WallHub-Source.zip`);
      releaseCalls += 1;
      return Buffer.from(JSON.stringify(release(releaseCalls === 1 ? '2.1.0' : '2.2.0')));
    },
    downloadFile: async (_url, destination) => {
      await holdDownload;
      fs.mkdirSync(path.dirname(destination), { recursive: true });
      fs.writeFileSync(destination, payload);
    },
  });
  await service.checkNow();
  service.startDownload();
  await new Promise(resolve => setImmediate(resolve));
  const queuedCheck = service.checkNow();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(releaseCalls, 1);
  releaseDownload();
  await service._waitForDownload();
  const checked = await queuedCheck;
  assert.equal(releaseCalls, 2);
  assert.equal(checked.latestVersion, '2.2.0');
  assert.equal(checked.status, 'available');
  service.stopSchedule();
});

function createZip(source, archive) {
  if (process.platform === 'win32') {
    const escapedSource = source.replace(/'/g, "''");
    const escapedArchive = archive.replace(/'/g, "''");
    return spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Compress-Archive -Path '${escapedSource}\\*' -DestinationPath '${escapedArchive}' -CompressionLevel Fastest`], { encoding: 'utf8' });
  }
  return spawnSync('zip', ['-q', '-r', archive, '.'], { cwd: source, encoding: 'utf8' });
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(error => error ? reject(error) : resolve(address.port));
    });
  });
}

test('updater applies a real flat zip and requires the restarted app to become healthy', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-update-integration-'));
  const payloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-update-payload-'));
  const updateRoot = path.join(root, 'updates');
  const archive = path.join(updateRoot, 'WallHub-Portable-win-x64.zip');
  const port = await reservePort();
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.mkdirSync(path.join(payloadRoot, 'public'), { recursive: true });
  fs.mkdirSync(updateRoot, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '2.0.1' }));
  fs.writeFileSync(path.join(root, 'server.js'), 'old server');
  fs.writeFileSync(path.join(root, 'public', 'index.html'), 'old ui');
  fs.writeFileSync(path.join(payloadRoot, 'package.json'), JSON.stringify({ version: '2.1.0' }));
  fs.writeFileSync(path.join(payloadRoot, 'public', 'index.html'), 'new ui');
  fs.writeFileSync(path.join(payloadRoot, 'server.js'), [
    "const http = require('http');",
    'const port = Number(process.argv[2]);',
    "const server = http.createServer((req, res) => { if (req.url === '/health') res.writeHead(200, { 'X-WallHub-Health-Token': process.env.WALLHUB_UPDATE_HEALTH_TOKEN || '' }); else res.writeHead(404); res.end('ok'); });",
    "server.listen(port, '127.0.0.1');",
    'setTimeout(() => server.close(), 5000);',
  ].join('\n'));
  const zipped = createZip(payloadRoot, archive);
  if (zipped.error && zipped.error.code === 'ENOENT') {
    t.skip('no ZIP creation command is available');
    return;
  }
  assert.equal(zipped.status, 0, String(zipped.stderr || zipped.stdout || 'ZIP creation failed'));
  const expectedHash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');
  const markerFile = path.join(updateRoot, UPDATE_REQUEST_FILE);

  await applyUpdate({
    archive,
    projectRoot: root,
    mode: 'portable',
    targetVersion: '2.1.0',
    expectedHash,
    expectedSize: fs.statSync(archive).size,
    waitPids: [],
    restartCommand: process.execPath,
    restartArgs: [path.join(root, 'server.js'), String(port)],
    restartCwd: root,
    healthUrl: `http://127.0.0.1:${port}/health`,
    markerFile,
  });

  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, '2.1.0');
  assert.equal(fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'), 'new ui');
  assert.equal(fs.readFileSync(path.join(updateRoot, 'backup-previous', 'server.js'), 'utf8'), 'old server');
  assert.equal(JSON.parse(fs.readFileSync(path.join(updateRoot, 'last-update.json'), 'utf8')).success, true);
  assert.equal(fs.existsSync(path.join(updateRoot, 'update-transaction.json')), false);
});

test('updater rolls back when the updated app fails its health check', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-update-rollback-'));
  const payloadRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-update-bad-payload-'));
  const updateRoot = path.join(root, 'updates');
  const archive = path.join(updateRoot, 'WallHub-Portable-win-x64.zip');
  const port = await reservePort();
  const oldServer = [
    "const http = require('http');",
    'const port = Number(process.argv[2]);',
    "const server = http.createServer((req, res) => { if (req.url === '/health') res.writeHead(200, { 'X-WallHub-Health-Token': process.env.WALLHUB_UPDATE_HEALTH_TOKEN || '' }); else res.writeHead(404); res.end('old'); });",
    "server.listen(port, '127.0.0.1');",
    'setTimeout(() => server.close(), 5000);',
  ].join('\n');
  fs.mkdirSync(path.join(root, 'public'), { recursive: true });
  fs.mkdirSync(path.join(payloadRoot, 'public'), { recursive: true });
  fs.mkdirSync(updateRoot, { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ version: '2.0.1' }));
  fs.writeFileSync(path.join(root, 'server.js'), oldServer);
  fs.writeFileSync(path.join(root, 'public', 'index.html'), 'old ui');
  fs.writeFileSync(path.join(root, 'obsolete.js'), 'old program file');
  fs.writeFileSync(path.join(updateRoot, INSTALLED_FILES_MANIFEST), JSON.stringify({
    version: 1,
    files: ['obsolete.js', 'package.json', 'public/index.html', 'server.js'],
  }));
  fs.writeFileSync(path.join(payloadRoot, 'package.json'), JSON.stringify({ version: '2.1.0' }));
  fs.writeFileSync(path.join(payloadRoot, 'server.js'), 'process.exit(1);');
  fs.writeFileSync(path.join(payloadRoot, 'public', 'index.html'), 'bad ui');
  const zipped = createZip(payloadRoot, archive);
  if (zipped.error && zipped.error.code === 'ENOENT') {
    t.skip('no ZIP creation command is available');
    return;
  }
  assert.equal(zipped.status, 0, String(zipped.stderr || zipped.stdout || 'ZIP creation failed'));
  const expectedHash = crypto.createHash('sha256').update(fs.readFileSync(archive)).digest('hex');

  await assert.rejects(() => applyUpdate({
    archive,
    projectRoot: root,
    mode: 'portable',
    targetVersion: '2.1.0',
    expectedHash,
    expectedSize: fs.statSync(archive).size,
    waitPids: [],
    restartCommand: process.execPath,
    restartArgs: [path.join(root, 'server.js'), String(port)],
    restartCwd: root,
    healthUrl: `http://127.0.0.1:${port}/health`,
    healthTimeoutMs: 2000,
    markerFile: path.join(updateRoot, UPDATE_REQUEST_FILE),
  }), /health check/);

  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version, '2.0.1');
  assert.equal(fs.readFileSync(path.join(root, 'server.js'), 'utf8'), oldServer);
  assert.equal(fs.readFileSync(path.join(root, 'public', 'index.html'), 'utf8'), 'old ui');
  assert.equal(fs.readFileSync(path.join(root, 'obsolete.js'), 'utf8'), 'old program file');
  assert.deepEqual(
    JSON.parse(fs.readFileSync(path.join(updateRoot, INSTALLED_FILES_MANIFEST), 'utf8')).files,
    ['obsolete.js', 'package.json', 'public/index.html', 'server.js'],
  );
  assert.equal(fs.existsSync(path.join(updateRoot, 'update-transaction.json')), false);
});
