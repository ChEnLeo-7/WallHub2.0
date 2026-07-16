'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createMpkgConversionService } = require('./conversion');

test('MPKG conversion runs Python unbuffered and mirrors tool output to server logger', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-mpkg-log-'));
  try {
    const itemDir = path.join(root, 'item');
    const toolDir = path.join(root, 'tool');
    fs.mkdirSync(itemDir, { recursive: true });
    fs.mkdirSync(toolDir, { recursive: true });
    const toolScript = path.join(toolDir, 'mobile_mpkg.py');
    fs.writeFileSync(toolScript, '# fake tool');

    const logs = [];
    const warns = [];
    let observedBin = '';
    let observedArgs = [];
    let observedOptions = null;
    const service = createMpkgConversionService({
      toolDir,
      toolScript,
      ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
      commandExists: (cmd) => cmd === 'python3' ? '/fake/python3' : '',
      pythonDependencyStatus: (python) => ({ ok: python === '/fake/python3', executable: python }),
      runProcess: async (bin, args, timeout, options) => {
        observedBin = bin;
        observedArgs = args.slice();
        observedOptions = options;
        options.onStdout('scan scene.pkg\nwrite mpkg\n');
        options.onStderr('warning texture skipped\n');
        const output = args[args.indexOf('--output') + 1];
        fs.writeFileSync(output, Buffer.alloc(8));
      },
      safeName: (value) => String(value || ''),
      logger: { log: (msg) => logs.push(String(msg)), warn: (msg) => warns.push(String(msg)) },
    });

    const outputPath = path.join(root, 'out', '123.mpkg');
    const result = await service.buildForItem(itemDir, '123', outputPath);

    assert.equal(result, outputPath);
    assert.equal(observedBin, '/fake/python3');
    assert.equal(observedArgs[0], '-u');
    assert.equal(observedArgs[1], toolScript);
    assert.equal(observedOptions.env.PYTHONUNBUFFERED, '1');
    assert.equal(observedOptions.env.PYTHONPATH, '');
    assert.equal(observedOptions.closeStdin, true);
    assert.ok(logs.some(line => line.includes('[MPKG] scan scene.pkg')));
    assert.ok(logs.some(line => line.includes('[MPKG] write mpkg')));
    assert.ok(warns.some(line => line.includes('[MPKG] warning texture skipped')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MPKG debug mode passes a trace flag to Python and logs process-to-publish boundaries', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-mpkg-debug-'));
  try {
    const itemDir = path.join(root, 'item');
    const toolDir = path.join(root, 'tool');
    const toolScript = path.join(toolDir, 'mobile_mpkg.py');
    fs.mkdirSync(itemDir, { recursive: true });
    fs.mkdirSync(toolDir, { recursive: true });
    fs.writeFileSync(toolScript, '# fake tool');

    const logs = [];
    let observedOptions = null;
    const service = createMpkgConversionService({
      toolDir,
      toolScript,
      ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
      commandExists: (cmd) => cmd === 'python3' ? '/fake/python3' : '',
      pythonDependencyStatus: () => ({ ok: true }),
      isDebugEnabled: () => true,
      runProcess: async (bin, args, timeout, options) => {
        observedOptions = options;
        fs.writeFileSync(args[args.indexOf('--output') + 1], Buffer.alloc(24));
        return { out: 'done', err: '' };
      },
      safeName: (value) => String(value || ''),
      logger: { log: (msg) => logs.push(String(msg)), warn: (msg) => logs.push(String(msg)) },
    });

    const result = await service.buildForItem(itemDir, '123', path.join(root, 'out', '123.mpkg'));

    assert.equal(result, path.join(root, 'out', '123.mpkg'));
    assert.equal(observedOptions.env.WALLHUB_MPKG_DEBUG, '1');
    assert.equal(observedOptions.env.WALLHUB_MPKG_DEBUG_VERBOSE, '0');
    const debugLogs = logs.filter(line => line.includes('[MPKG] Debug'));
    assert.ok(debugLogs.some(line => line.includes('[MPKG] Debug conversion process start item=123')));
    assert.ok(debugLogs.some(line => line.includes('[MPKG] Debug temporary MPKG verified item=123 bytes=24')));
    assert.ok(debugLogs.some(line => line.includes('[MPKG] Debug MPKG output published item=123 bytes=24')));
    assert.equal(debugLogs.some(line => line.includes(root)), false, 'debug tracing must not expose absolute temporary paths');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MPKG warns when the selected Python lacks the native DXT decoder', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-mpkg-native-dxt-'));
  try {
    const itemDir = path.join(root, 'item');
    const toolDir = path.join(root, 'tool');
    const toolScript = path.join(toolDir, 'mobile_mpkg.py');
    fs.mkdirSync(itemDir, { recursive: true });
    fs.mkdirSync(toolDir, { recursive: true });
    fs.writeFileSync(toolScript, '# fake tool');

    const warns = [];
    const service = createMpkgConversionService({
      toolDir,
      toolScript,
      ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
      commandExists: (cmd) => cmd === 'python3' ? '/fake/python3' : '',
      pythonDependencyStatus: () => ({ ok: true, executable: '/fake/python3', acceleratedDxt: false }),
      runProcess: async (_bin, args) => {
        fs.writeFileSync(args[args.indexOf('--output') + 1], Buffer.alloc(8));
      },
      safeName: (value) => String(value || ''),
      logger: { log: () => {}, warn: (message) => warns.push(String(message)) },
    });

    await service.buildForItem(itemDir, '123', path.join(root, 'out', '123.mpkg'));

    assert.ok(warns.some((line) => line.includes('texture2ddecoder')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MPKG compact profile uses an isolated cache file and forwards the profile to Python', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-mpkg-compact-'));
  try {
    const itemDir = path.join(root, 'item');
    const toolDir = path.join(root, 'tool');
    const toolScript = path.join(toolDir, 'mobile_mpkg.py');
    fs.mkdirSync(itemDir, { recursive: true });
    fs.mkdirSync(toolDir, { recursive: true });
    fs.writeFileSync(path.join(itemDir, 'scene.pkg'), 'pkg');
    fs.writeFileSync(path.join(itemDir, 'project.json'), '{}');
    fs.writeFileSync(path.join(itemDir, 'preview.jpg'), 'preview');
    fs.writeFileSync(toolScript, '# fake tool');

    let observedArgs = [];
    const service = createMpkgConversionService({
      toolDir,
      toolScript,
      ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
      commandExists: (cmd) => cmd === 'python3' ? '/fake/python3' : '',
      pythonDependencyStatus: () => ({ ok: true, executable: '/fake/python3' }),
      getTextureProfile: () => 'fast',
      findDownloadedItemPath: () => itemDir,
      runProcess: async (_bin, args) => {
        observedArgs = args.slice();
        fs.writeFileSync(args[args.indexOf('--output') + 1], Buffer.alloc(8));
      },
      safeName: (value) => String(value || ''),
      logger: { log() {}, warn() {} },
    });

    const prepared = await service.prepareDownloadFile('123', 'Demo', 'compact');
    const result = prepared.filePath;

    assert.equal(result, path.join(itemDir, 'Mpkg', '123.compact.mpkg'));
    const profileArgIndex = observedArgs.indexOf('--texture-profile');
    assert.deepEqual(observedArgs.slice(profileArgIndex, profileArgIndex + 2), ['--texture-profile', 'compact']);
    assert.equal(fs.existsSync(path.join(itemDir, 'Mpkg', '123.mpkg')), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MPKG conversion starts different items independently', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-mpkg-queue-'));
  try {
    const toolDir = path.join(root, 'tool');
    const toolScript = path.join(toolDir, 'mobile_mpkg.py');
    const firstItem = path.join(root, 'first');
    const secondItem = path.join(root, 'second');
    for (const itemDir of [firstItem, secondItem]) {
      fs.mkdirSync(itemDir, { recursive: true });
      fs.writeFileSync(path.join(itemDir, 'scene.pkg'), 'pkg');
      fs.writeFileSync(path.join(itemDir, 'project.json'), '{}');
      fs.writeFileSync(path.join(itemDir, 'preview.jpg'), 'preview');
    }
    fs.mkdirSync(toolDir, { recursive: true });
    fs.writeFileSync(toolScript, '# fake tool');

    let releaseFirst;
    let firstStarted;
    const firstRelease = new Promise((resolve) => { releaseFirst = resolve; });
    const firstStart = new Promise((resolve) => { firstStarted = resolve; });
    let active = 0;
    let peakActive = 0;
    let calls = 0;
    const service = createMpkgConversionService({
      toolDir,
      toolScript,
      ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
      commandExists: (cmd) => cmd === 'python3' ? '/fake/python3' : '',
      pythonDependencyStatus: () => ({ ok: true, executable: '/fake/python3' }),
      runProcess: async (_bin, args) => {
        calls += 1;
        active += 1;
        peakActive = Math.max(peakActive, active);
        if (calls === 1) {
          firstStarted();
          await firstRelease;
        }
        fs.writeFileSync(args[args.indexOf('--output') + 1], Buffer.alloc(8));
        active -= 1;
        return { out: '', err: '' };
      },
      safeName: (value) => String(value || ''),
      logger: { log() {}, warn() {} },
    });

    const first = service.ensureForItem(firstItem, '1', 'fast');
    await firstStart;
    const second = service.ensureForItem(secondItem, '2', 'fast');
    await Promise.resolve();

    assert.equal(calls, 2);
    assert.equal(peakActive, 2);
    releaseFirst();
    await Promise.all([first, second]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('MPKG capability reports compact unavailable when the selected Python lacks etcpak', () => {
  const service = createMpkgConversionService({
    commandExists: (command) => command === 'python3' ? '/fake/python3' : '',
    pythonDependencyStatus: () => ({ ok: true, executable: '/fake/python3', etcpakAvailable: false }),
    logger: { log() {}, warn() {} },
  });

  assert.deepEqual(service.getCapabilities(), {
    compactAvailable: false,
    compactUnavailableReason: '缺少 Python etcpak，无法使用紧凑档。请安装：pip install etcpak',
  });
});
