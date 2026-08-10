'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const {
  createSteamKitDownloadService,
  classifySteamKitControlPlaneOutput,
  isSteamKitContentStageKey,
  steamKitIdleTimeoutForStage,
  steamKitIdleWatchdogState,
  steamKitPreSpawnWarmupTimeoutMs,
} = require('./download');
const {
  createWallhubDepotProgressReader,
  isDepotGuardRequiredMessage,
} = require('./depotTools');

function createService(root, hooks = {}) {
  const configDir = path.join(root, 'account');
  return createSteamKitDownloadService({
    STEAM_CREDENTIALS: hooks.STEAM_CREDENTIALS || { username: 'tester', password: '', steamGuardCode: '', isPersistent: true, pendingPersistentUsername: '' },
    DEPOT_CONFIG_DIR: configDir,
    STEAMKIT_CONFIG_DIR: configDir,
    ensureDir: (dir) => fs.mkdirSync(dir, { recursive: true }),
    hasFilesRecursive: (dir) => fs.existsSync(dir),
    copyDirContents() {},
    removePathWithRetry: hooks.removePathWithRetry || (() => {}),
    getDownloadItemDir: (id) => path.join(root, 'Downloads', String(id)),
    finalizeWorkshopItem: (sourceDir, id) => path.join(root, 'Downloads', String(id)),
    deletePathIfInside() {},
    cleanupRuntimeDownloadResidues() {},
    runtimeResidueKeepIds: () => [],
    pickVideoFile: () => '',
    extFromPath: () => '.dat',
    safeName: (value) => String(value || ''),
    waitForStartupPreparationForDownload: async () => {},
    warmupSteamAccessControlPlane: hooks.warmupSteamAccessControlPlane || (async () => ({ ok: 1, total: 2 })),
    markSteamAccessControlPlaneFailure: hooks.markSteamAccessControlPlaneFailure || (() => {}),
    shouldRetrySteamLoginRequiredError: () => false,
    refreshPersistentSteamLoginForRetry: async () => false,
    setValidatedPersistentLogin() {},
    depotDotnetMissingMessage: () => 'missing dotnet',
    isDepotNetworkFailureMessage: hooks.isDepotNetworkFailureMessage || (() => false),
    isDepotAuthFailureMessage: () => false,
    isDepotGuardRequiredMessage: hooks.isDepotGuardRequiredMessage || isDepotGuardRequiredMessage,
    isDepotLoginVerifiedDespiteCanceled: () => false,
    depotCommandFor: () => ({ command: 'dotnet', argsPrefix: ['/tmp/DepotDownloader.dll'] }),
    getSteamKitMaxDownloads: () => 8,
    makeDepotLoginId: () => '1234',
    getSteamContentCellId: () => '',
    ensureDepotDownloaderReady: async () => '/tmp/DepotDownloader.dll',
    createWallhubDepotProgressReader: hooks.createWallhubDepotProgressReader || (() => () => null),
    createWallhubDepotCdnLogReader: () => () => {},
    appendTaskProcessOutput() {},
    applyTaskByteProgress: hooks.applyTaskByteProgress || (() => {}),
    runProcess: hooks.runProcess || (async () => {}),
    buildSteamContentEnv: (env) => env,
    buildDepotDotnetEnv: () => ({}),
    describeSteamCdnRouteStrategy: () => 'direct',
    logger: hooks.logger || { log() {}, warn() {}, error() {} },
  });
}

function rejectedProcess(message = 'Task canceled or paused') {
  const promise = Promise.reject(Object.assign(new Error(message), { code: 'CANCELLED' }));
  promise.kill = () => {};
  return promise;
}

test('SteamKit build args enable DepotDownloader checksum validation by default for chunk resume', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-validate-'));
  try {
    const service = createService(root);
    const built = service.buildArgs('/tmp/DepotDownloader.dll', '123456', 431960, path.join(root, 'temp'), path.join(root, 'raw'), { jsonProgress: true });
    assert.equal(built.args.includes('-validate'), true);

    const optOut = service.buildArgs('/tmp/DepotDownloader.dll', '123456', 431960, path.join(root, 'temp'), path.join(root, 'raw'), { validate: false });
    assert.equal(optOut.args.includes('-validate'), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('SteamKit idle timeout treats content and resume stages as long-running CDN/checkpoint work', () => {
  assert.equal(isSteamKitContentStageKey('content-download'), true);
  assert.equal(isSteamKitContentStageKey('resume-validation'), true);
  assert.equal(isSteamKitContentStageKey('cdn:dl.steam.clngaa.com:80'), true);
  assert.equal(isSteamKitContentStageKey('steam3-login'), false);
  const validation = classifySteamKitControlPlaneOutput('Validating file "scene.pkg"...');
  assert.equal(validation.key, 'resume-validation');
  assert.match(validation.stage, /校验/);
  const env = {
    WALLHUB_DEPOT_IDLE_TIMEOUT: '30000',
    WALLHUB_DEPOT_CONTENT_IDLE_TIMEOUT: '180000',
    WALLHUB_STEAMKIT_PRESPAWN_WARMUP_TIMEOUT: '750',
  };
  assert.equal(steamKitIdleTimeoutForStage('steam3-login', false, env), 30000);
  assert.equal(steamKitIdleTimeoutForStage('content-download', false, env), 180000);
  assert.equal(steamKitIdleTimeoutForStage('steam3-login', true, env), 180000);
  assert.equal(steamKitPreSpawnWarmupTimeoutMs(env), 750);
});

test('SteamKit watchdog suspends during live pause and retains content budget after same-runner resume', () => {
  const env = {
    WALLHUB_DEPOT_IDLE_TIMEOUT: '60000',
    WALLHUB_DEPOT_CONTENT_IDLE_TIMEOUT: '300000',
  };
  const task = { livePaused: true, _livePauseResumedAt: 0 };
  const paused = steamKitIdleWatchdogState({
    task,
    stageKey: 'steam3-licenses',
    hasResumeCheckpoint: false,
    hasEnteredContent: true,
    lastOutputAt: 1_000,
    lastHandledResumeAt: 0,
    now: 90_000,
    env,
  });
  assert.equal(paused.suspended, true);
  assert.equal(paused.idleLimit, 300000);

  task.livePaused = false;
  task._livePauseResumedAt = 90_000;
  const resumed = steamKitIdleWatchdogState({
    task,
    stageKey: 'steam3-licenses',
    hasResumeCheckpoint: false,
    hasEnteredContent: true,
    lastOutputAt: 1_000,
    lastHandledResumeAt: 0,
    now: 90_000,
    env,
  });
  assert.equal(resumed.suspended, false);
  assert.equal(resumed.lastOutputAt, 90_000);
  assert.equal(resumed.lastHandledResumeAt, 90_000);
  assert.equal(resumed.idleLimit, 300000);

  const reconnecting = steamKitIdleWatchdogState({
    task: { livePaused: false },
    stageKey: 'steam3-login',
    hasResumeCheckpoint: true,
    hasEnteredContent: true,
    hasPostContentReconnect: true,
    lastOutputAt: 90_000,
    lastHandledResumeAt: 0,
    now: 150_000,
    env: Object.assign({}, env, { WALLHUB_DEPOT_RECOVERY_IDLE_TIMEOUT: '75000' }),
  });
  assert.equal(reconnecting.idleLimit, 75000);
});

test('SteamKit automatically retries one trusted-checkpoint resume after content watchdog abort', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-content-retry-'));
  try {
    const task = { status: 'downloading', total: 10240, downloaded: 5120, progress: 50 };
    const logs = [];
    let spawns = 0;
    const service = createService(root, {
      logger: { log() {}, warn: (message) => logs.push(String(message)), error() {} },
      runProcess: () => {
        spawns += 1;
        if (spawns === 1) {
          task._depotIdleTimeout = true;
          task._depotIdleStage = 'content';
        }
        return rejectedProcess();
      },
    });

    await assert.rejects(() => service.downloadWorkshopItem('123456', 431960, 'resume me', { task, forceSharedDir: true }));

    assert.equal(spawns, 2);
    assert.ok(logs.some(line => /content stream stalled; restarting once/.test(line)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit download seeds resumed task progress from trusted checkpoint', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-resume-'));
  try {
    const rawRoot = path.join(root, 'account', 'depotdownloader', 'downloads', '431960', '123456');
    fs.mkdirSync(rawRoot, { recursive: true });
    fs.writeFileSync(path.join(rawRoot, '.wallhub-resume.json'), JSON.stringify({
      version: 1,
      appId: '431960',
      publishedFileId: '123456',
      downloaded: 5120,
      total: 10240,
    }));
    const task = { status: 'downloading', total: 10240, downloaded: 0, progress: 0 };
    let observedDownloaded = 0;
    let observedProgress = 0;
    const service = createService(root, {
      runProcess: () => {
        observedDownloaded = task.downloaded;
        observedProgress = task.progress;
        task.status = 'paused';
        return rejectedProcess();
      },
    });

    await assert.rejects(() => service.downloadViaSteamKit('123456', 431960, 'resume me', { task, forceSharedDir: true }));

    assert.equal(observedDownloaded, 5120);
    assert.equal(Math.round(observedProgress), 50);
    assert.equal(fs.existsSync(rawRoot), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit download does not infer trusted resume progress from preallocated partial file sizes', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-resume-scan-'));
  try {
    const rawRoot = path.join(root, 'account', 'depotdownloader', 'downloads', '431960', '123456');
    const partialDir = path.join(rawRoot, 'steamapps', 'workshop', 'content', '431960', '123456');
    fs.mkdirSync(partialDir, { recursive: true });
    fs.writeFileSync(path.join(partialDir, 'partial.bin'), Buffer.alloc(4096));
    fs.writeFileSync(path.join(partialDir, '.wallhub-resume.json'), Buffer.alloc(2048));
    const logs = [];
    const task = { status: 'downloading', total: 16384, downloaded: 0, progress: 0 };
    let observedDownloaded = -1;
    let observedProgress = -1;
    let observedStage = '';
    let observedStageMode = '';
    let observedIndeterminate = false;
    const service = createService(root, {
      logger: { log: (msg) => logs.push(String(msg)), warn: (msg) => logs.push(String(msg)), error() {} },
      runProcess: () => {
        observedDownloaded = task.downloaded;
        observedProgress = task.progress;
        observedStage = task.progressStage;
        observedStageMode = task.progressStageMode;
        observedIndeterminate = task.progressIndeterminate;
        task.status = 'paused';
        return rejectedProcess();
      },
    });

    await assert.rejects(() => service.downloadViaSteamKit('123456', 431960, 'resume me', { task, forceSharedDir: true }));

    assert.equal(observedDownloaded, 0);
    assert.equal(Math.round(observedProgress), 0);
    assert.match(observedStage, /校验/);
    assert.equal(observedStageMode, 'loading');
    assert.equal(observedIndeterminate, true);
    assert.ok(logs.some(line => line.includes('[SteamKit resume]') && line.includes('partial files')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit resumed progress merges trusted checkpoint when child restarts counters', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-resume-regression-'));
  try {
    const rawRoot = path.join(root, 'account', 'depotdownloader', 'downloads', '431960', '123456');
    fs.mkdirSync(rawRoot, { recursive: true });
    fs.writeFileSync(path.join(rawRoot, '.wallhub-resume.json'), JSON.stringify({
      version: 1,
      appId: '431960',
      publishedFileId: '123456',
      downloaded: 5120,
      total: 10240,
    }));
    const task = { status: 'downloading', total: 10240, downloaded: 0, progress: 0 };
    let observedStageModeBeforeProgress = '';
    let observedProgressBeforeProgress = 0;
    let observedDownloadedBeforeProgress = 0;
    let observedApplyStageMode = '';
    const service = createService(root, {
      createWallhubDepotProgressReader: () => createWallhubDepotProgressReader(),
      applyTaskByteProgress: (target, downloaded, total) => {
        observedApplyStageMode = target.progressStageMode;
        target.downloaded = downloaded;
        target.total = total;
        target.progress = (downloaded / total) * 100;
      },
      runProcess: (command, args, timeout, options) => {
        options.onStdout('WALLHUB_STEAM3_API_BROKER_REQUIRED:CMWebSocket\n');
        observedStageModeBeforeProgress = task.progressStageMode;
        observedProgressBeforeProgress = task.progress;
        observedDownloadedBeforeProgress = task.downloaded;
        options.onStdout('WALLHUB_DEPOT_JSON_PROGRESS:{"downloaded":0,"total":10240,"networkDownloaded":1024,"percent":0,"speed":1024}\n');
        task.status = 'paused';
        return rejectedProcess();
      },
    });

    await assert.rejects(() => service.downloadViaSteamKit('123456', 431960, 'resume me', { task, forceSharedDir: true }));

    const checkpoint = JSON.parse(fs.readFileSync(path.join(rawRoot, '.wallhub-resume.json'), 'utf8'));
    assert.equal(observedStageModeBeforeProgress, 'loading');
    assert.equal(observedDownloadedBeforeProgress, 5120);
    assert.equal(Math.round(observedProgressBeforeProgress), 50);
    assert.equal(observedApplyStageMode, 'progress');
    assert.equal(task.downloaded, 6144);
    assert.equal(task.total, 10240);
    assert.equal(Math.round(task.progress), 60);
    assert.equal(checkpoint.downloaded, 6144);
    assert.equal(checkpoint.total, 10240);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit resumed progress keeps original project total when checkpoint stores remaining-session total', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-resume-original-total-'));
  try {
    const rawRoot = path.join(root, 'account', 'depotdownloader', 'downloads', '431960', '123456');
    fs.mkdirSync(rawRoot, { recursive: true });
    fs.writeFileSync(path.join(rawRoot, '.wallhub-resume.json'), JSON.stringify({
      version: 1,
      appId: '431960',
      publishedFileId: '123456',
      downloaded: 200,
      total: 1400,
    }));
    const task = { status: 'downloading', total: 1600, downloaded: 200, progress: 12.5 };
    let observedDownloaded = 0;
    let observedTotal = 0;
    let observedProgress = 0;
    const service = createService(root, {
      createWallhubDepotProgressReader: () => createWallhubDepotProgressReader(),
      applyTaskByteProgress: (target, downloaded, total) => {
        observedDownloaded = downloaded;
        observedTotal = total;
        target.downloaded = downloaded;
        target.total = total;
        target.progress = (downloaded / total) * 100;
        observedProgress = target.progress;
      },
      runProcess: (command, args, timeout, options) => {
        options.onStdout('WALLHUB_STEAM3_API_BROKER_REQUIRED:CMWebSocket\n');
        options.onStdout('WALLHUB_DEPOT_JSON_PROGRESS:{"downloaded":0,"total":1400,"networkDownloaded":92,"percent":0,"speed":1024}\n');
        task.status = 'paused';
        return rejectedProcess();
      },
    });

    await assert.rejects(() => service.downloadViaSteamKit('123456', 431960, 'resume full total', { task, forceSharedDir: true }));

    const checkpoint = JSON.parse(fs.readFileSync(path.join(rawRoot, '.wallhub-resume.json'), 'utf8'));
    assert.equal(observedDownloaded, 292);
    assert.equal(observedTotal, 1600);
    assert.equal(Math.round(observedProgress), 18);
    assert.equal(task.total, 1600);
    assert.equal(checkpoint.downloaded, 292);
    assert.equal(checkpoint.total, 1600);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit resumed progress never rewrites a larger checkpoint total to a smaller session total', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-resume-no-regress-'));
  try {
    const rawRoot = path.join(root, 'account', 'depotdownloader', 'downloads', '431960', '123456');
    fs.mkdirSync(rawRoot, { recursive: true });
    fs.writeFileSync(path.join(rawRoot, '.wallhub-resume.json'), JSON.stringify({
      version: 1,
      appId: '431960',
      publishedFileId: '123456',
      downloaded: 160432128,
      total: 1705932663,
    }));
    const task = { status: 'downloading', total: 1705932663, downloaded: 160432128, progress: 9.4 };
    const service = createService(root, {
      createWallhubDepotProgressReader: () => createWallhubDepotProgressReader(),
      applyTaskByteProgress: (target, downloaded, total) => {
        target.downloaded = downloaded;
        target.total = total;
        target.progress = (downloaded / total) * 100;
      },
      runProcess: (command, args, timeout, options) => {
        options.onStdout('WALLHUB_DEPOT_JSON_PROGRESS:{"downloaded":2097630,"total":1545500536,"networkDownloaded":3479,"percent":0.1,"speed":1024}\n');
        task.status = 'paused';
        return rejectedProcess();
      },
    });

    await assert.rejects(() => service.downloadViaSteamKit('123456', 431960, 'resume no regress', { task, forceSharedDir: true }));

    const checkpoint = JSON.parse(fs.readFileSync(path.join(rawRoot, '.wallhub-resume.json'), 'utf8'));
    assert.equal(checkpoint.total, 1705932663);
    assert.ok(checkpoint.downloaded >= 160432128);
    assert.equal(task.total, 1705932663);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit resumed progress ignores premature child full-progress while process is still running', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-resume-no-premature-full-'));
  try {
    const rawRoot = path.join(root, 'account', 'depotdownloader', 'downloads', '431960', '123456');
    fs.mkdirSync(rawRoot, { recursive: true });
    fs.writeFileSync(path.join(rawRoot, '.wallhub-resume.json'), JSON.stringify({
      version: 1,
      appId: '431960',
      publishedFileId: '123456',
      downloaded: 242084201,
      total: 1705932663,
    }));
    const task = { status: 'downloading', total: 1705932663, downloaded: 242084201, progress: 14.2 };
    let observedDownloaded = 0;
    let observedTotal = 0;
    let observedProgress = 0;
    const service = createService(root, {
      createWallhubDepotProgressReader: () => createWallhubDepotProgressReader(),
      applyTaskByteProgress: (target, downloaded, total) => {
        observedDownloaded = downloaded;
        observedTotal = total;
        target.downloaded = downloaded;
        target.total = total;
        target.progress = (downloaded / total) * 100;
        observedProgress = target.progress;
      },
      runProcess: (command, args, timeout, options) => {
        options.onStdout('WALLHUB_DEPOT_JSON_PROGRESS:{"downloaded":1705932663,"total":1705932663,"networkDownloaded":53936069,"percent":100,"speed":1024}\n');
        task.status = 'paused';
        return rejectedProcess();
      },
    });

    await assert.rejects(() => service.downloadViaSteamKit('123456', 431960, 'resume premature full', { task, forceSharedDir: true }));

    const expected = 242084201 + 53936069;
    const checkpoint = JSON.parse(fs.readFileSync(path.join(rawRoot, '.wallhub-resume.json'), 'utf8'));
    assert.equal(observedDownloaded, expected);
    assert.equal(observedTotal, 1705932663);
    assert.ok(observedProgress > 17 && observedProgress < 18);
    assert.equal(checkpoint.downloaded, expected);
    assert.equal(checkpoint.total, 1705932663);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit resumed progress keeps one immutable baseline across repeated premature full reports', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-resume-stable-baseline-'));
  try {
    const rawRoot = path.join(root, 'account', 'depotdownloader', 'downloads', '431960', '123456');
    fs.mkdirSync(rawRoot, { recursive: true });
    fs.writeFileSync(path.join(rawRoot, '.wallhub-resume.json'), JSON.stringify({
      version: 1,
      appId: '431960',
      publishedFileId: '123456',
      downloaded: 242084201,
      total: 1705932663,
    }));
    const observed = [];
    const task = { status: 'downloading', total: 1705932663, downloaded: 242084201, progress: 14.2 };
    const service = createService(root, {
      createWallhubDepotProgressReader: () => createWallhubDepotProgressReader(),
      applyTaskByteProgress: (target, downloaded, total) => {
        observed.push(downloaded);
        target.downloaded = downloaded;
        target.total = total;
        target.progress = (downloaded / total) * 100;
      },
      runProcess: (command, args, timeout, options) => {
        options.onStdout('WALLHUB_DEPOT_JSON_PROGRESS:{"downloaded":1705932663,"total":1705932663,"networkDownloaded":53936069,"percent":100,"speed":1024}\n');
        options.onStdout('WALLHUB_DEPOT_JSON_PROGRESS:{"downloaded":1705932663,"total":1705932663,"networkDownloaded":60000000,"percent":100,"speed":1024}\n');
        task.status = 'paused';
        return rejectedProcess();
      },
    });

    await assert.rejects(() => service.downloadViaSteamKit('123456', 431960, 'stable resume baseline', { task, forceSharedDir: true }));

    assert.deepEqual(observed, [242084201 + 53936069, 242084201 + 60000000]);
    const checkpoint = JSON.parse(fs.readFileSync(path.join(rawRoot, '.wallhub-resume.json'), 'utf8'));
    assert.equal(checkpoint.downloaded, 242084201 + 60000000);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit ignores a poisoned 100 percent resume checkpoint when partial files still need validation', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-resume-poisoned-checkpoint-'));
  try {
    const rawRoot = path.join(root, 'account', 'depotdownloader', 'downloads', '431960', '123456');
    const partialDir = path.join(rawRoot, 'steamapps', 'workshop', 'content', '431960', '123456');
    fs.mkdirSync(partialDir, { recursive: true });
    fs.writeFileSync(path.join(partialDir, 'scene.pkg'), Buffer.alloc(8192));
    fs.writeFileSync(path.join(rawRoot, '.wallhub-resume.json'), JSON.stringify({
      version: 1,
      appId: '431960',
      publishedFileId: '123456',
      downloaded: 16384,
      total: 16384,
    }));
    const task = { status: 'downloading', total: 16384, downloaded: 0, progress: 0 };
    let observedDownloaded = -1;
    let observedIndeterminate = false;
    const service = createService(root, {
      runProcess: () => {
        observedDownloaded = task.downloaded;
        observedIndeterminate = task.progressIndeterminate;
        task.status = 'paused';
        return rejectedProcess();
      },
    });

    await assert.rejects(() => service.downloadViaSteamKit('123456', 431960, 'poisoned checkpoint', { task, forceSharedDir: true }));

    assert.equal(observedDownloaded, 0);
    assert.equal(observedIndeterminate, true);
    assert.match(task.progressStage, /校验/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit parallel downloads lease separate account-level login slots for remembered sessions', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-login-slots-'));
  try {
    const loginIds = [];
    const pending = [];
    let releaseAll;
    const allSpawned = new Promise((resolve) => { releaseAll = resolve; });
    const service = createService(root, {
      runProcess: (command, args) => {
        const publishedFileId = args[args.indexOf('-pubfile') + 1];
        loginIds.push(args[args.indexOf('-loginid') + 1]);
        const itemDir = path.join(args[args.indexOf('-dir') + 1], 'steamapps', 'workshop', 'content', '431960', publishedFileId);
        fs.mkdirSync(itemDir, { recursive: true });
        fs.writeFileSync(path.join(itemDir, 'scene.pkg'), Buffer.alloc(10));
        const promise = new Promise((resolve) => pending.push(resolve));
        promise.kill = () => {};
        if (loginIds.length === 2) releaseAll();
        return promise;
      },
    });

    const first = service.downloadViaSteamKit('123456', 431960, 'first', { forceSharedDir: true });
    const second = service.downloadViaSteamKit('654321', 431960, 'second', { forceSharedDir: true });
    await allSpawned;
    assert.equal(loginIds.length, 2);
    assert.notEqual(loginIds[0], loginIds[1]);
    assert.equal(loginIds.includes('1234'), false);
    pending.splice(0).forEach(resolve => resolve({ out: '', err: '' }));
    await Promise.all([first, second]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit download checks cached WebAPI control-plane routes before spawning DepotDownloader', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-control-plane-'));
  try {
    const events = [];
    const service = createService(root, {
      warmupSteamAccessControlPlane: async (reason, options) => {
        events.push(['warmup', reason, options && options.forceRefresh]);
        return { ok: 2, total: 2 };
      },
      runProcess: () => {
        events.push(['spawn']);
        return Promise.resolve();
      },
    });

    await service.downloadViaSteamKit('123456', 431960, 'control plane', { forceSharedDir: true, task: {} });

    assert.deepEqual(events.slice(0, 2), [['warmup', 'steamkit-download', false], ['spawn']]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit download does not block DepotDownloader spawn on slow control-plane refresh', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-control-plane-timeout-'));
  const previous = process.env.WALLHUB_STEAMKIT_PRESPAWN_WARMUP_TIMEOUT;
  process.env.WALLHUB_STEAMKIT_PRESPAWN_WARMUP_TIMEOUT = '0';
  try {
    const events = [];
    let resolveWarmup;
    const service = createService(root, {
      warmupSteamAccessControlPlane: async (reason, options) => {
        events.push(['warmup', reason, options && options.forceRefresh]);
        await new Promise(resolve => { resolveWarmup = resolve; });
        events.push(['warmup-done']);
        return { ok: 2, total: 2 };
      },
      runProcess: () => {
        events.push(['spawn']);
        return Promise.resolve();
      },
    });

    const promise = service.downloadViaSteamKit('123456', 431960, 'control plane timeout', { forceSharedDir: true, task: {} });
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.deepEqual(events.slice(0, 2), [['warmup', 'steamkit-download', false], ['spawn']]);
    resolveWarmup();
    await promise;
    await new Promise(resolve => setTimeout(resolve, 0));
    assert.equal(events.some(item => item && item[0] === 'warmup-done'), true);
  } finally {
    if (previous === undefined) delete process.env.WALLHUB_STEAMKIT_PRESPAWN_WARMUP_TIMEOUT;
    else process.env.WALLHUB_STEAMKIT_PRESPAWN_WARMUP_TIMEOUT = previous;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit download closes DepotDownloader stdin even for remembered sessions without guard input', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-stdin-'));
  try {
    let observedOptions = null;
    let observedArgs = null;
    const service = createService(root, {
      runProcess: (command, args, timeout, options) => {
        observedArgs = args;
        observedOptions = options;
        return Promise.resolve();
      },
    });

    await service.downloadViaSteamKit('123456', 431960, 'noninteractive', { forceSharedDir: true, task: {} });

    assert.equal(observedArgs.includes('-remember-password'), true);
    assert.deepEqual(observedOptions.inputLines, []);
    assert.equal(observedOptions.closeStdin, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit download converts diagnostic-only child failure into login guidance', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-diagnostic-only-'));
  try {
    const service = createService(root, {
      runProcess: (command, args, timeout, options) => {
        options.onStderr('WALLHUB_DEPOT_BOOTSTRAP:main\n');
        options.onStdout("Logging 'tester' into Steam3...\n");
        options.onStderr('WALLHUB_STEAM3_API_BROKER_REQUIRED:WebAPI\nWALLHUB_STEAM3_API_BROKER:api.steampowered.com:/ISteamDirectory/GetCMListForConnect/v1/?format=vdf&cellid=0 WALLHUB_STEAM3_API_BROKER_REQUIRED:CMWebSocket\n');
        return Promise.reject(new Error('WALLHUB_DEPOT_BOOTSTRAP:main\nWALLHUB_STEAM3_API_BROKER_REQUIRED:WebAPI\nWALLHUB_STEAM3_API_BROKER:api.steampowered.com:/ISteamDirectory/GetCMListForConnect/v1/?format=vdf&cellid=0 WALLHUB_STEAM3_API_BROKER_REQUIRED:CMWebSocket'));
      },
    });

    await assert.rejects(
      () => service.downloadViaSteamKit('123456', 431960, 'diagnostic only', { forceSharedDir: true, task: {} }),
      (error) => {
        assert.equal(error.code, 'STEAM_LOGIN_FAILED');
        assert.equal(/WALLHUB_/.test(error.message), false);
        assert.match(error.message, /重新登录 Steam/);
        return true;
      }
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit content-stage diagnostic-only child failure is not reported as remembered-session login failure', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-content-diagnostic-'));
  try {
    const service = createService(root);
    const error = service.normalizeError(
      new Error('WALLHUB_DEPOT_BOOTSTRAP:main\nWALLHUB_STEAM3_API_BROKER_REQUIRED:WebAPI'),
      {
        lastStageText: 'SteamKit 已获取 SteamPipe CDN，正在连接 st.dl.eccdnx.com:80',
        hasSteam3LoginStarted: true,
      }
    );

    assert.notEqual(error.code, 'STEAM_LOGIN_FAILED');
    assert.equal(/重新登录 Steam/.test(error.message), false);
    assert.equal(error.code, 'STEAMKIT_CHILD_DIAGNOSTIC_ONLY');
    assert.match(error.message, /SteamPipe CDN|文件内容|下载/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit error normalization prioritizes a network failure over mixed auth hints', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-network-auth-'));
  try {
    const service = createService(root, {
      isDepotNetworkFailureMessage: (message) => /NoConnection/i.test(message),
    });
    const error = service.normalizeError(new Error('Login failed: NoConnection; mobile authenticator may be required'));

    assert.equal(error.code, 'STEAM_NETWORK_UNREACHABLE');
    assert.equal(error.statusCode, 504);
    assert.equal(error.requiresSteamGuard, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit error normalization does not infer Guard from a vague mobile hint', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-vague-guard-'));
  try {
    const service = createService(root);
    const error = service.normalizeError(new Error('Login failed; mobile authenticator may be required'));

    assert.notEqual(error.code, 'STEAM_GUARD_REQUIRED');
    assert.equal(error.requiresSteamGuard, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit error normalization keeps explicit Steam Guard challenges', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-explicit-guard-'));
  try {
    const service = createService(root);
    const error = service.normalizeError(new Error('STEAM GUARD! Please enter your 2-factor auth code'));

    assert.equal(error.code, 'STEAM_GUARD_REQUIRED');
    assert.equal(error.requiresSteamGuard, true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit error normalization reads preserved stderr before a noisy stdout tail', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-stderr-network-'));
  try {
    const service = createService(root, {
      isDepotNetworkFailureMessage: (message) => /NoConnection/i.test(message),
    });
    const processError = Object.assign(new Error('Error: InitializeSteam failed'), {
      stderr: 'Failed to authenticate with Steam: NoConnection',
      stdout: 'mobile authenticator may be required\n' + 'x'.repeat(2000),
      exitCode: 1,
    });
    const error = service.normalizeError(processError);

    assert.equal(error.code, 'STEAM_NETWORK_UNREACHABLE');
    assert.equal(error.requiresSteamGuard, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit download is cancelled before DepotDownloader spawn when task is deleted during warmup', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-cancelled-'));
  try {
    let warmupResolve;
    const warmupStarted = new Promise((resolve) => {
      warmupResolve = resolve;
    });
    let spawnCalled = false;
    const service = createService(root, {
      warmupSteamAccessControlPlane: async () => {
        warmupResolve();
        await new Promise((resolve) => setTimeout(resolve, 10));
        return { ok: 1, total: 2 };
      },
      runProcess: () => {
        spawnCalled = true;
        return Promise.resolve();
      },
    });

    const task = { status: 'downloading' };
    const controller = new AbortController();
    const promise = service.downloadViaSteamKit('123456', 431960, 'cancel me', { task, forceSharedDir: true, signal: controller.signal });
    await warmupStarted;
    controller.abort();

    await assert.rejects(promise, (error) => error && error.code === 'CANCELLED');
    assert.equal(spawnCalled, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit control-plane output is classified into explicit diagnostic stages', () => {
  assert.deepEqual(classifySteamKitControlPlaneOutput('WALLHUB_DEPOT_BOOTSTRAP:main\n'), {
    key: 'depot-bootstrap:main',
    stage: 'SteamKit 下载器进程已进入 DepotDownloader Main',
    detail: 'main',
  });
  assert.deepEqual(classifySteamKitControlPlaneOutput('WALLHUB_STEAM3_RESOLVE:api.steampowered.com->23.36.106.129,23.36.106.130 source=wallhub-api\n'), {
    key: 'api-resolve:api.steampowered.com',
    stage: 'SteamKit 已获取 Steam WebAPI 路由：api.steampowered.com',
    detail: '2 个候选 IP',
  });
  assert.deepEqual(classifySteamKitControlPlaneOutput('WALLHUB_STEAM3_API_CONNECT:api.steampowered.com->23.36.106.129:443\n'), {
    key: 'api-connect:api.steampowered.com:23.36.106.129:443',
    stage: 'SteamKit 正在连接 Steam WebAPI：api.steampowered.com -> 23.36.106.129:443',
  });
  assert.deepEqual(classifySteamKitControlPlaneOutput('WALLHUB_DEPOT_CDN_HOST:{"host":"xz.pphimalayanrt.com","vhost":"","port":80}\n'), {
    key: 'cdn:xz.pphimalayanrt.com:80',
    stage: 'SteamKit 已获取 SteamPipe CDN，正在连接 xz.pphimalayanrt.com:80',
  });
  assert.deepEqual(classifySteamKitControlPlaneOutput('WALLHUB_STEAM3_API_CONNECT_FAILED:api.steampowered.com->23.36.106.129:443:The operation was canceled.\n'), {
    key: 'api-connect-failed:api.steampowered.com:23.36.106.129:443',
    stage: 'SteamKit WebAPI 连接失败：api.steampowered.com -> 23.36.106.129:443',
    detail: 'The operation was canceled.',
    level: 'warn',
    event: 'api-connect-failed',
    host: 'api.steampowered.com',
    ip: '23.36.106.129',
    port: 443,
  });
  assert.deepEqual(classifySteamKitControlPlaneOutput('WALLHUB_STEAM3_RESOLVER_BRIDGE_FAILED:api.steampowered.com:The operation was canceled.\n'), {
    key: 'resolver-bridge-failed:api.steampowered.com',
    stage: 'SteamKit WebAPI 路由桥失败：api.steampowered.com',
    detail: 'The operation was canceled.',
    level: 'warn',
  });
  assert.deepEqual(classifySteamKitControlPlaneOutput('WALLHUB_STEAM3_API_BROKER_REQUIRED:WebAPI\n'), {
    key: 'api-broker-required:WebAPI',
    stage: 'SteamKit 已启用 WallHub WebAPI 优质连接代理',
    detail: 'WebAPI',
  });
  assert.deepEqual(classifySteamKitControlPlaneOutput('WALLHUB_STEAM3_API_BROKER_DISABLED:WebAPI\n'), {
    key: 'api-broker-disabled:WebAPI',
    stage: 'SteamKit WallHub WebAPI 优质连接代理未启用，正在回退直连',
    detail: 'WebAPI',
    level: 'warn',
  });
  assert.deepEqual(classifySteamKitControlPlaneOutput('WALLHUB_STEAM3_API_BROKER:api.steampowered.com:/ISteamWebAPIUtil/GetSupportedAPIList/v1/?format=json\n'), {
    key: 'api-broker:api.steampowered.com',
    stage: 'SteamKit 正在通过 WallHub 优质连接访问 Steam WebAPI：api.steampowered.com',
    detail: '/ISteamWebAPIUtil/GetSupportedAPIList/v1/?format=json',
  });
  assert.deepEqual(classifySteamKitControlPlaneOutput('WALLHUB_STEAM3_API_BROKER_FAILED:api.steampowered.com:The operation was canceled.\n'), {
    key: 'api-broker-failed:api.steampowered.com',
    stage: 'SteamKit WallHub WebAPI 优质连接代理失败：api.steampowered.com',
    detail: 'The operation was canceled.',
    level: 'warn',
  });
});

test('SteamKit download logs explicit control-plane stages from DepotDownloader output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-stage-log-'));
  try {
    const logs = [];
    const task = { status: 'downloading' };
    const service = createService(root, {
      logger: {
        log: (line) => logs.push(['log', line]),
        warn: (line) => logs.push(['warn', line]),
        error: (line) => logs.push(['error', line]),
      },
      runProcess: (command, args, timeout, options) => {
        options.onStdout('Connecting to Steam3...\n');
        options.onStderr('WALLHUB_STEAM3_API_CONNECT:api.steampowered.com->23.36.106.129:443\n');
        options.onStdout('WALLHUB_DEPOT_CDN_HOST:{"host":"xz.pphimalayanrt.com","vhost":"","port":80}\n');
        const itemDir = path.join(args[args.indexOf('-dir') + 1], 'steamapps', 'workshop', 'content', '431960', '123456');
        fs.mkdirSync(itemDir, { recursive: true });
        fs.writeFileSync(path.join(itemDir, 'scene.pkg'), Buffer.alloc(10));
        return Promise.resolve({ out: '', err: '' });
      },
    });

    await service.downloadViaSteamKit('123456', 431960, 'stage log', { forceSharedDir: true, task });

    const stageLogs = logs.map(item => item[1]).filter(line => /\[SteamKit stage\]/.test(line));
    assert.equal(stageLogs.some(line => /正在连接 Steam3 CM/.test(line)), true);
    assert.equal(stageLogs.some(line => /正在连接 Steam WebAPI：api\.steampowered\.com -> 23\.36\.106\.129:443/.test(line)), true);
    assert.equal(stageLogs.some(line => /已获取 SteamPipe CDN，正在连接 xz\.pphimalayanrt\.com:80/.test(line)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('SteamKit download cools down DepotDownloader WebAPI IP failures reported by child output', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-download-route-failure-'));
  try {
    const failures = [];
    const service = createService(root, {
      markSteamAccessControlPlaneFailure: (host, ip, error, meta) => failures.push({ host, ip, error, meta }),
      runProcess: (command, args, timeout, options) => {
        options.onStderr('WALLHUB_STEAM3_API_CONNECT_FAILED:api.steampowered.com->23.65.19.99:443:The operation was canceled.\n');
        const itemDir = path.join(args[args.indexOf('-dir') + 1], 'steamapps', 'workshop', 'content', '431960', '123456');
        fs.mkdirSync(itemDir, { recursive: true });
        fs.writeFileSync(path.join(itemDir, 'scene.pkg'), Buffer.alloc(10));
        return Promise.resolve({ out: '', err: '' });
      },
    });

    await service.downloadViaSteamKit('123456', 431960, 'route failure', { forceSharedDir: true, task: { status: 'downloading' } });

    assert.deepEqual(failures, [{
      host: 'api.steampowered.com',
      ip: '23.65.19.99',
      error: 'The operation was canceled.',
      meta: { source: 'depotdownloader', stage: 'steamkit-webapi', port: 443 },
    }]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
