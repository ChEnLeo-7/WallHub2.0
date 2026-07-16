'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSteamKitRuntimeBuildService } = require('./runtimeBuild');

function withEnv(patch, fn) {
  const old = {};
  for (const key of Object.keys(patch)) {
    old[key] = process.env[key];
    if (patch[key] === undefined) delete process.env[key];
    else process.env[key] = patch[key];
  }
  try {
    return fn();
  } finally {
    for (const key of Object.keys(patch)) {
      if (old[key] === undefined) delete process.env[key];
      else process.env[key] = old[key];
    }
  }
}

function createService(overrides = {}) {
  const env = Object.assign({ PREFIX: '/data/data/com.termux/files/usr' }, overrides.env || {});
  return createSteamKitRuntimeBuildService(Object.assign({
    env,
    logger: { log() {}, warn() {} },
    STEAMKIT_ROOT: '/tmp/wallhub/SteamKit',
    STEAMKIT_CONFIG_DIR: '/tmp/wallhub/SteamKit/account',
    DOWNLOADS_DIR: '/tmp/wallhub/Downloads',
    DEPOT_DOWNLOADER_DIR: '/tmp/wallhub/SteamKit/DepotDownloader',
    DEPOT_STREAM_DOWNLOADER_DIR: '/tmp/wallhub/SteamKit/DepotDownloaderStream',
    DEPOT_JSON_PROGRESS_DIR: '/tmp/wallhub/SteamKit/DepotDownloader',
    DEPOT_JSON_PROGRESS_SOURCE_ZIP: 'https://example.invalid/source.zip',
    DEPOT_JSON_PROGRESS_PATCH_VERSION: 'test-json',
    DEPOT_STREAM_PATCH_VERSION: 'test-stream',
    DEPOT_CONFIG_DIR: '/tmp/wallhub/SteamKit/account',
    DEPOT_HOME_DIR: '/tmp/wallhub/SteamKit/home',
    DEPOT_DOTNET_CLI_HOME_DIR: '/tmp/wallhub/SteamKit/dotnet-home',
    DEPOT_XDG_DATA_HOME_DIR: '/tmp/wallhub/SteamKit/xdg-data',
    DEPOT_XDG_CONFIG_HOME_DIR: '/tmp/wallhub/SteamKit/xdg-config',
    DEPOT_LOCALAPPDATA_DIR: '/tmp/wallhub/SteamKit/localappdata',
    DEPOT_APPDATA_DIR: '/tmp/wallhub/SteamKit/appdata',
    GITHUB_ACCELERATOR_MODE: 'direct',
    UA: 'WallHubTest',
    GET: async () => Buffer.alloc(0),
    ensureDir() {},
    runProcess: async () => {},
    psQuote: value => String(value),
    updateRuntimeSetup() {},
    runtimeSetupSnapshot: () => ({}),
    effectiveDownloaderMode: () => 'steamkit',
    startupDownloaderMode: () => 'steamkit',
    ensureSteamConfigDir() {},
    reconcileCachedSteamLogin: async () => {},
    VIDEO_CACHE_SETTINGS: {},
    makeSteamKitJsonProgressRequiredError: () => new Error('required'),
    isTermuxLikeEnv: () => true,
    isAndroidHostLikeEnv: () => true,
    shouldRejectDepotAppHostForAndroid: () => true,
  }, overrides));
}

test('Termux DepotDownloader publish args disable unstable build servers and parallelism', () => withEnv({ TERMUX_VERSION: 'test' }, () => {
  const service = createService();
  assert.equal(typeof service.buildDepotPublishArgs, 'function');

  const args = service.buildDepotPublishArgs('/tmp/src/DepotDownloader.csproj', '/tmp/out');

  assert.deepEqual(args.slice(0, 5), ['publish', '/tmp/src/DepotDownloader.csproj', '-c', 'Release', '-o']);
  assert.ok(args.includes('/tmp/out'));
  assert.ok(args.includes('--self-contained'));
  assert.ok(args.includes('false'));
  assert.ok(args.includes('--disable-build-servers'));
  assert.ok(args.includes('-p:UseAppHost=false'));
  assert.ok(args.includes('-p:UseSharedCompilation=false'));
  assert.ok(args.includes('-p:BuildInParallel=false'));
  assert.ok(args.includes('-nodeReuse:false'));
  assert.ok(args.includes('-m:1'));
}));

test('Termux DepotDownloader build env disables server-style dotnet features', () => withEnv({ TERMUX_VERSION: 'test' }, () => {
  const service = createService();
  const env = service.buildDepotDotnetBuildEnv();

  assert.equal(env.MSBUILDDISABLENODEREUSE, '1');
  assert.equal(env.DOTNET_MULTILEVEL_LOOKUP, '0');
  assert.equal(env.DOTNET_CLI_USE_MSBUILD_SERVER, '0');
  assert.equal(env.DOTNET_SYSTEM_NET_SOCKETS_INLINE_COMPLETIONS, '1');
  assert.equal(env.DOTNET_SYSTEM_NET_SOCKETS_THREAD_COUNT, '1');
  assert.equal(env.COMPlus_gcServer, '0');
  assert.equal(env.DOTNET_gcServer, '0');
}));

test('Termux DepotDownloader build recovery copies framework DLL after native post-build SIGSEGV', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-depot-recover-'));
  try {
    const sourceOut = path.join(root, 'DepotDownloader-master', 'DepotDownloader', 'bin', 'Release', 'net9.0');
    const runtimeOut = path.join(root, 'runtime');
    fs.mkdirSync(sourceOut, { recursive: true });
    fs.writeFileSync(path.join(sourceOut, 'DepotDownloader.dll'), 'dll');
    fs.writeFileSync(path.join(sourceOut, 'DepotDownloader.deps.json'), '{}');
    fs.writeFileSync(path.join(sourceOut, 'DepotDownloader.runtimeconfig.json'), '{}');
    fs.writeFileSync(path.join(sourceOut, 'SteamKit2.dll'), 'dep');

    const service = createService({
      ensureDir: dir => fs.mkdirSync(dir, { recursive: true }),
    });

    assert.equal(service.isRecoverableDotnetPostBuildCrash(new Error('Native Crash Reporting\nGot a SIGSEGV while executing native code')), true);
    assert.equal(service.findRecoverableDepotBuildOutput(root), sourceOut);
    const recovered = service.recoverDepotRuntimeFromBuildOutput(root, runtimeOut);

    assert.equal(recovered, path.join(runtimeOut, 'DepotDownloader.dll'));
    assert.equal(fs.readFileSync(path.join(runtimeOut, 'DepotDownloader.dll'), 'utf8'), 'dll');
    assert.equal(fs.readFileSync(path.join(runtimeOut, 'SteamKit2.dll'), 'utf8'), 'dep');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('enabling SteamKit chunk streaming after service creation starts runtime warmup immediately', async () => {
  const logs = [];
  let settings = { steamKitDepotStreaming: false };
  const service = createService({
    logger: {
      log: (line) => logs.push(String(line)),
      warn: () => {},
    },
    VIDEO_CACHE_SETTINGS: settings,
    getVideoCacheSettings: () => settings,
  });

  settings = { steamKitDepotStreaming: true };
  service.warmupDepotStreamDownloader('settings-enabled');
  await new Promise(resolve => setTimeout(resolve, 0));

  assert.equal(logs.some(line => line.includes('Warming up SteamKit 分块在线播放下载器') && line.includes('settings-enabled')), true);
});
test('SteamKit source download pings Google once and uses direct GitHub when reachable', async () => {
  let pingCount = 0;
  const service = createService({
    GITHUB_ACCELERATOR_MODE: 'auto',
    runProcess: async (command, args, timeoutMs) => {
      assert.equal(command, 'ping');
      assert.equal(args.includes('www.google.com'), true);
      assert.equal(timeoutMs, 5000);
      pingCount += 1;
    },
  });
  const url = 'https://github.com/SteamRE/DepotDownloader/archive/refs/heads/master.zip';

  const firstRoutes = await service.chooseGithubDownloadRoutes(url);
  const secondRoutes = await service.chooseGithubDownloadRoutes(url);

  assert.deepEqual(firstRoutes, [{ name: 'direct', url }]);
  assert.deepEqual(secondRoutes, [{ name: 'direct', url }]);
  assert.equal(pingCount, 1);
});
test('SteamKit source download uses GitHub accelerators when Google ping fails', async () => {
  const service = createService({
    GITHUB_ACCELERATOR_MODE: 'auto',
    runProcess: async () => {
      throw new Error('unreachable');
    },
  });
  const url = 'https://github.com/SteamRE/DepotDownloader/archive/refs/heads/master.zip';

  const routes = await service.chooseGithubDownloadRoutes(url);

  assert.equal(routes[0].name, 'https://gh-proxy.com/');
  assert.equal(routes[0].url, `https://gh-proxy.com/${url}`);
  assert.deepEqual(routes.at(-1), { name: 'direct', url });
});
