'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { stripWallhubDiagnosticOutput } = require('./depotTools');
const {
  parsePositiveInt,
  isSteamKitContentStageKey,
  isSteamKitContentStageText,
  steamKitPreSpawnWarmupTimeoutMs,
  steamKitIdleTimeoutForStage,
  steamKitIdleWatchdogState,
} = require('./download/watchdog');

function parseWallhubCdnHostLine(text) {
  const match = String(text || '').match(/WALLHUB_DEPOT_CDN_HOST:(\{[^\r\n]+\})/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    const host = String(data.host || data.vhost || '').trim();
    if (!host) return null;
    return {
      host,
      vhost: String(data.vhost || '').trim(),
      port: Number(data.port || 0),
    };
  } catch {
    return null;
  }
}

function delay(ms, value) {
  return new Promise(resolve => setTimeout(() => resolve(value), Math.max(0, ms)));
}

const { classifySteamKitControlPlaneOutput } = require('./download/controlPlane');

function createSteamKitDownloadService(deps = {}) {
  const {
    STEAM_CREDENTIALS,
    DEPOT_CONFIG_DIR,
    STEAMKIT_CONFIG_DIR,
    ensureDir,
    hasFilesRecursive,
    copyDirContents,
    removePathWithRetry,
    getDownloadItemDir,
    finalizeWorkshopItem,
    deletePathIfInside,
    cleanupRuntimeDownloadResidues,
    runtimeResidueKeepIds,
    pickVideoFile,
    extFromPath,
    safeName,
    waitForStartupPreparationForDownload,
    warmupSteamAccessControlPlane = async () => null,
    markSteamAccessControlPlaneFailure = () => {},
    shouldRetrySteamLoginRequiredError,
    refreshPersistentSteamLoginForRetry,
    setValidatedPersistentLogin,
    depotDotnetMissingMessage,
    isDepotNetworkFailureMessage,
    isDepotAuthFailureMessage,
    isDepotLoginVerifiedDespiteCanceled,
    depotCommandFor,
    getSteamKitMaxDownloads,
    makeDepotLoginId,
    getSteamContentCellId,
    ensureDepotDownloaderReady,
    createWallhubDepotProgressReader,
    createWallhubDepotCdnLogReader,
    appendTaskProcessOutput,
    applyTaskByteProgress,
    runProcess,
    buildSteamContentEnv,
    buildDepotDotnetEnv,
    describeSteamCdnRouteStrategy,
    logger = console,
  } = deps;

  const activeDownloads = new Map();
  const activeLoginSlots = new Map();

  function codedError(message, code, statusCode) {
    const err = new Error(message);
    err.code = code;
    err.statusCode = statusCode || 500;
    if (code === 'STEAM_LOGIN_REQUIRED' || code === 'STEAM_GUARD_REQUIRED') err.requiresSteamLogin = true;
    if (code === 'STEAM_GUARD_REQUIRED') err.requiresSteamGuard = true;
    return err;
  }

  function steamKitNeedsOwnedAccount(appId) {
    if (String(process.env.WALLHUB_ALLOW_ANONYMOUS_DEPOTDOWNLOADER || '') === '1') return false;
    return parseInt(appId, 10) === 431960;
  }

  function makeLoginRequiredError() {
    return codedError(
      'SteamKit 下载 Wallpaper Engine 工坊需要登录拥有 Wallpaper Engine 的 Steam 账号。请先在设置中登录 Steam，然后重试下载。',
      'STEAM_LOGIN_REQUIRED',
      401
    );
  }

  function makeGuardRequiredError() {
    return codedError(
      '需要 Steam Guard 验证码或手机 Steam 确认，请在登录弹窗中输入验证码后重试。',
      'STEAM_GUARD_REQUIRED',
      401
    );
  }

  function makeLoginFailedError(message) {
    return codedError(message || 'Steam 登录失败，请检查账号或密码。', 'STEAM_LOGIN_FAILED', 401);
  }

  function makeNetworkError(message) {
    return codedError(
      message || '当前网络无法稳定连接 Steam，登录请求未完成或已超时，请检查网络、代理或稍后重试。',
      'STEAM_NETWORK_UNREACHABLE',
      504
    );
  }

  function makeCancelledError(stage) {
    const err = codedError(stage ? `Download cancelled during ${stage}` : 'Download cancelled', 'CANCELLED', 409);
    err.name = 'AbortError';
    return err;
  }

  function throwIfDownloadCancelled(options, stage) {
    const task = options && options.task;
    if ((options && options.signal && options.signal.aborted) || (task && task.status === 'cancelled')) {
      throw makeCancelledError(stage);
    }
    if (task && task.status === 'paused') {
      throw makeCancelledError(stage || 'pause');
    }
  }

  function resolveLogin() {
    const webUser = STEAM_CREDENTIALS.username;
    const webPass = STEAM_CREDENTIALS.password;
    const webGuard = STEAM_CREDENTIALS.steamGuardCode;
    const envUser = String(process.env.STEAM_USERNAME || '').trim();
    const envPass = String(process.env.STEAM_PASSWORD || '').trim();
    const user = webUser || envUser || '';
    const pass = webPass || envPass || '';
    const guard = webGuard || '';
    const source = webUser ? 'web' : (envUser ? 'env' : 'anonymous');
    const isPersistent = source === 'web' ? !!(STEAM_CREDENTIALS.username && (STEAM_CREDENTIALS.isPersistent || STEAM_CREDENTIALS.pendingPersistentUsername)) : false;
    return { user, pass, guard, source, isPersistent };
  }

  function canUseLogin(login) {
    return !!(login && login.user && (login.pass || login.isPersistent));
  }

  function makeJsonProgressRequiredError() {
    return codedError(
      '当前环境没有可运行的 SteamKit JSON 真实进度下载器。请安装 .NET 9 SDK 和 .NET 9 Runtime 后重启服务端，让 WallHub 在 SteamKit/DepotDownloader 中构建运行件。',
      'STEAMKIT_JSON_PROGRESS_REQUIRED',
      500
    );
  }
  function stableDepotLoginId(seed) {
    const input = String(seed || '');
    let hash = 2166136261;
    for (let index = 0; index < input.length; index++) {
      hash ^= input.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return String(hash >>> 0);
  }

  function loginSlotSeed(appId, user) {
    const account = String(user || '').trim().toLowerCase();
    if (!account) return '';
    return `download:${appId || 431960}:${account}`;
  }

  function acquireSteamKitLoginSlot(appId, user) {
    const seed = loginSlotSeed(appId, user);
    if (!seed) return null;
    let slots = activeLoginSlots.get(seed);
    if (!slots) {
      slots = new Set();
      activeLoginSlots.set(seed, slots);
    }
    let slot = 0;
    while (slots.has(slot)) slot += 1;
    slots.add(slot);
    return {
      seed,
      slot,
      loginId: stableDepotLoginId(`${seed}:slot:${slot}`),
    };
  }

  function releaseSteamKitLoginSlot(lease) {
    if (!lease || !lease.seed) return;
    const slots = activeLoginSlots.get(lease.seed);
    if (!slots) return;
    slots.delete(lease.slot);
    if (slots.size === 0) activeLoginSlots.delete(lease.seed);
  }

  function buildArgs(executable, publishedFileId, appId, tempRoot, rawRoot, options) {
    const { argsPrefix } = depotCommandFor(executable);
    const login = (options && options.depotLogin) || resolveLogin(appId);
    const user = login.user || '';
    const pass = login.pass || '';
    const guard = login.guard || '';
    const loginId = options && options.steamKitLoginId
      ? String(options.steamKitLoginId)
      : user
        ? stableDepotLoginId(`download:${appId}:${publishedFileId}:${user}`)
        : makeDepotLoginId(`download:${appId}:${publishedFileId}`);
    const args = [
      ...argsPrefix,
      '-app', String(appId),
      '-pubfile', String(publishedFileId),
      '-dir', rawRoot,
      '-max-downloads', String(getSteamKitMaxDownloads()),
      '-loginid', loginId,
    ];
    const cellId = getSteamContentCellId();
    if (cellId) args.push('-cellid', String(cellId));
    // DepotDownloader already supports manifest/chunk validation and reuse. Keep it on by
    // default so paused or restarted Wallpaper downloads resume from verified local chunks
    // instead of showing a misleading fresh 0% run; callers can opt out with validate=false.
    if (!(options && options.validate === false)) args.push('-validate');
    if (options && options.jsonProgress) args.push('-wallhub-json-progress');

    if (user) {
      args.push('-username', user, '-remember-password');
      if (pass) args.push('-password', pass);
      if (guard) args.push('-no-mobile');
    }
    if (process.env.DEPOTDOWNLOADER_DEBUG === '1') args.push('-debug');
    return { args, inputLines: guard ? [guard] : [] };
  }

  function redactDepotArgs(args = []) {
    const sensitive = new Set(['-password', '-username']);
    return args.map((value, index) => sensitive.has(String(args[index - 1] || '').toLowerCase()) ? '<redacted>' : value);
  }

  function resumeCheckpointPath(rawRoot) {
    return path.join(rawRoot, '.wallhub-resume.json');
  }

  function readTrustedResumeCheckpoint(rawRoot, appId, publishedFileId) {
    try {
      const file = resumeCheckpointPath(rawRoot);
      if (!fs.existsSync(file)) return null;
      const checkpoint = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (String(checkpoint.appId || '') !== String(appId || '')) return null;
      if (String(checkpoint.publishedFileId || '') !== String(publishedFileId || '')) return null;
      const downloaded = Math.max(0, Math.floor(Number(checkpoint.downloaded || 0)));
      const total = Math.max(0, Math.floor(Number(checkpoint.total || 0)));
      if (downloaded <= 0 || total <= 0 || downloaded >= total) return null;
      return { downloaded, total, updatedAt: Number(checkpoint.updatedAt || 0) || 0 };
    } catch {
      return null;
    }
  }

  function writeTrustedResumeCheckpoint(rawRoot, appId, publishedFileId, progress) {
    try {
      let downloaded = Math.max(0, Math.floor(Number(progress && progress.downloaded || 0)));
      let total = Math.max(0, Math.floor(Number(progress && progress.total || 0)));
      if (downloaded <= 0 || total <= 0 || downloaded >= total) return;
      const checkpoint = readTrustedResumeCheckpoint(rawRoot, appId, publishedFileId);
      if (checkpoint) {
        if (checkpoint.total > total) {
          total = checkpoint.total;
          downloaded = Math.max(downloaded, checkpoint.downloaded);
        } else if (checkpoint.total === total) {
          downloaded = Math.max(downloaded, checkpoint.downloaded);
        }
      }
      ensureDir(rawRoot);
      fs.writeFileSync(resumeCheckpointPath(rawRoot), JSON.stringify({
        version: 1,
        appId: String(appId || ''),
        publishedFileId: String(publishedFileId || ''),
        downloaded,
        total,
        updatedAt: Date.now(),
      }));
    } catch {}
  }

  function hasPartialResumeFiles(rawRoot) {
    try {
      if (!rawRoot || !fs.existsSync(rawRoot)) return false;
      const stack = [rawRoot];
      while (stack.length) {
        const current = stack.pop();
        let entries = [];
        try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
        for (const entry of entries) {
          const name = entry.name || '';
          if (!name || name === '.wallhub-resume.json' || name === 'Mpkg') continue;
          const full = path.join(current, name);
          if (entry.isDirectory()) {
            stack.push(full);
            continue;
          }
          if (entry.isFile()) return true;
        }
      }
      return false;
    } catch {
      return false;
    }
  }

  function seedTaskProgressFromTrustedCheckpoint(task, rawRoot, appId, publishedFileId) {
    if (!task) return { source: 'none', downloaded: 0, total: 0 };
    const checkpoint = readTrustedResumeCheckpoint(rawRoot, appId, publishedFileId);
    if (checkpoint) {
      const taskKnownTotal = Math.max(
        Math.floor(Number(task.total || 0)),
        Math.floor(Number(task.size || 0)),
        checkpoint.total
      );
      const total = taskKnownTotal > 0 ? taskKnownTotal : checkpoint.total;
      const downloaded = Math.min(total, Math.max(Math.floor(Number(task.downloaded || 0)), checkpoint.downloaded));
      task.downloaded = downloaded;
      task.total = total;
      task.progress = Math.max(task.progress || 0, Math.min(95, (downloaded / total) * 100));
      task.progressIndeterminate = false;
      task.progressStage = '已读取可信续传进度，SteamKit 正在校验本地文件';
      task.progressStageMode = 'loading';
      if (downloaded !== checkpoint.downloaded || total !== checkpoint.total) {
        writeTrustedResumeCheckpoint(rawRoot, appId, publishedFileId, { downloaded, total });
      }
      return { source: 'checkpoint', downloaded, total, updatedAt: checkpoint.updatedAt };
    }
    const knownTotal = Math.max(0, Math.floor(Number(task.total || 0)));
    if (!hasPartialResumeFiles(rawRoot)) return { source: 'none', downloaded: 0, total: knownTotal };
    task.downloaded = 0;
    task.progress = 0;
    if (knownTotal > 0) task.total = knownTotal;
    task.progressIndeterminate = true;
    task.progressStage = '已发现本地续传文件，SteamKit 正在校验有效分块';
    task.progressStageMode = 'loading';
    return { source: 'partial-files', downloaded: 0, total: knownTotal };
  }

  function isTrustedDepotProgress(rawRoot, appId, publishedFileId, progress) {
    if (!progress) return false;
    const downloaded = Math.max(0, Math.floor(Number(progress.downloaded || 0)));
    const total = Math.max(0, Math.floor(Number(progress.total || 0)));
    if (total <= 0 || downloaded < 0 || downloaded > total) return false;
    const networkDownloaded = Number(progress.networkDownloaded || 0);
    if (Number.isFinite(networkDownloaded) && networkDownloaded > 0) return true;
    const checkpoint = readTrustedResumeCheckpoint(rawRoot, appId, publishedFileId);
    return !!(checkpoint && downloaded <= checkpoint.downloaded && total === checkpoint.total);
  }

  function normalizeResumeDepotProgress(rawRoot, appId, publishedFileId, progress, resumeBaseline = null) {
    if (!progress) return progress;
    const downloaded = Math.max(0, Math.floor(Number(progress.downloaded || 0)));
    const reportedTotal = Math.max(0, Math.floor(Number(progress.total || 0)));
    const networkDownloaded = Math.max(0, Math.floor(Number(progress.networkDownloaded || 0)));
    const baseline = resumeBaseline && resumeBaseline.source !== 'none'
      ? resumeBaseline
      : null;
    if (!baseline) return progress;

    const baselineDownloaded = Math.max(0, Math.floor(Number(baseline.downloaded || 0)));
    const baselineTotal = Math.max(0, Math.floor(Number(baseline.total || 0)));
    const projectTotal = Math.max(baselineTotal, reportedTotal);
    if (projectTotal <= 0) return progress;

    if (networkDownloaded > 0) {
      return Object.assign({}, progress, {
        downloaded: Math.min(projectTotal, baselineDownloaded + networkDownloaded),
        total: projectTotal,
      });
    }

    if (baseline.source === 'checkpoint' && downloaded < baselineDownloaded) {
      return Object.assign({}, progress, {
        downloaded: baselineDownloaded,
        total: projectTotal,
      });
    }
    return progress;
  }

  function normalizeOutput(rawRoot, tempRoot, appId, publishedFileId) {
    const canonical = path.join(tempRoot, 'steamapps', 'workshop', 'content', String(appId), String(publishedFileId));
    if (hasFilesRecursive(canonical)) return canonical;
    const candidates = [
      path.join(rawRoot, 'steamapps', 'workshop', 'content', String(appId), String(publishedFileId)),
      path.join(rawRoot, 'workshop', 'content', String(appId), String(publishedFileId)),
      path.join(rawRoot, 'content', String(appId), String(publishedFileId)),
      path.join(rawRoot, String(publishedFileId)),
    ];
    const source = candidates.find(hasFilesRecursive) || (hasFilesRecursive(rawRoot) ? rawRoot : '');
    if (!source) throw new Error('DepotDownloader completed but no workshop files were found');
    if (path.resolve(source) !== path.resolve(canonical)) {
      if (fs.existsSync(canonical)) fs.rmSync(canonical, { recursive: true, force: true });
      copyDirContents(source, canonical);
    }
    return canonical;
  }

  function normalizeError(error, context = {}) {
    const rawMsg = String(error && error.message || error || '');
    const userMsg = stripWallhubDiagnosticOutput(rawMsg);
    const msg = userMsg || rawMsg;
    if (/\bWALLHUB_[A-Z0-9_]+:/i.test(rawMsg)) {
      const stage = String(context.lastStageText || '').trim();
      const contentStage = isSteamKitContentStageText(stage);
      if (contentStage && !userMsg) {
        return codedError(
          `SteamKit 下载器已进入“${stage || '文件内容下载'}”阶段后退出，但只返回了 WallHub 内部诊断日志，未返回具体 DepotDownloader 错误。这不是 Steam3 登录失效；请重试，或切换 Steam CDN/降低并发后再试。`,
          'STEAMKIT_CHILD_DIAGNOSTIC_ONLY',
          502
        );
      }
      const steam3LoginStage = context.hasSteam3LoginStarted || /登录\s*Steam3|Steam3\s*登录/i.test(stage);
      const steam3LoginProgress = /Logging\s+['"].+['"]\s+into Steam3\.\.\./i.test(msg) || /Logging\s+['"].+['"]\s+into Steam3\.\.\.\s*$/i.test(rawMsg);
      if (steam3LoginStage && (!userMsg || (steam3LoginProgress && !isDepotAuthFailureMessage(msg) && !isDepotNetworkFailureMessage(msg)))) {
        return makeLoginFailedError('SteamKit 已进入 Steam3 登录阶段，但 DepotDownloader 退出时只返回了 WallHub 内部诊断日志，未返回具体 Steam 错误。通常是本地 remembered session 已失效或登录交互未完成；请在设置中重新登录 Steam 后重试。');
      }
      if (!userMsg) {
        return codedError(
          `SteamKit 下载器在“${stage || '未知阶段'}”退出，但只返回了 WallHub 内部诊断日志，未返回具体 DepotDownloader 错误。请重试；若仍失败，请提供服务端 [SteamKit stage] 后续日志。`,
          'STEAMKIT_CHILD_DIAGNOSTIC_ONLY',
          502
        );
      }
    }
    if (/GC heap initialization failed|Failed to create CoreCLR|0x8007000E|CoreCLR/i.test(msg)) {
      return codedError(
        'DepotDownloader 的 .NET 运行时在当前 Linux/proot 环境启动失败，通常是 CoreCLR GC 初始化内存不足。已为 DepotDownloader 启用低内存兼容参数；如果仍失败，请尝试设置 WALLHUB_DEPOT_DOTNET_GC_HEAP_MB=128 后重启，或增加 proot/设备可用内存。',
        'DEPOT_DOTNET_GC_INIT_FAILED',
        500
      );
    }
    if (/Microsoft\.NETCore\.App|app-launch-failed|The following frameworks were found|Framework:.*version/i.test(msg)) {
      const required = (msg.match(/Microsoft\.NETCore\.App['"]?,\s*version\s+['"]?([0-9.]+)/i) || [])[1] || '';
      const installed = [];
      for (const match of msg.matchAll(/Microsoft\.NETCore\.App[^\r\n]*?([0-9]+\.[0-9]+\.[0-9]+)/gi)) {
        if (match[1] && match[1] !== required) installed.push(match[1]);
      }
      return new Error(depotDotnetMissingMessage(required, Array.from(new Set(installed))));
    }
    if (isDepotNetworkFailureMessage(msg)) return makeNetworkError();
    if (/timed? out|timeout|process timed out/i.test(msg)) {
      return codedError('SteamKit 登录验证超时，请检查网络、Steam Guard 或稍后重试。', 'STEAM_LOGIN_TIMEOUT', 504);
    }
    if (/No username given|anonymous account|not available from this account|requires.*(license|subscription)|no subscription|license.*missing/i.test(msg)) {
      return makeLoginRequiredError();
    }
    if (/two[- ]?factor|2fa|steam guard|authenticator|authentication code|mobile/i.test(msg)) return makeGuardRequiredError();
    if (isDepotAuthFailureMessage(msg)) return makeLoginFailedError('Steam 登录失败，请检查账号、密码或 Steam Guard 验证码。');
    return error instanceof Error ? error : new Error(msg);
  }

  async function downloadViaSteamKit(publishedFileId, appId, title, options = {}) {
    throwIfDownloadCancelled(options, 'start');
    const depotLogin = resolveLogin(appId);
    if (steamKitNeedsOwnedAccount(appId) && !canUseLogin(depotLogin)) throw makeLoginRequiredError();

    const executable = await ensureDepotDownloaderReady();
    throwIfDownloadCancelled(options, 'runtime preparation');
    if (options && options.task) options.task.progressStage = 'SteamKit 正在快速检查 Steam WebAPI 控制连接';
    try {
      const warmupStartedAt = Date.now();
      const warmupTimeoutMs = steamKitPreSpawnWarmupTimeoutMs();
      const warmupPromise = Promise.resolve(warmupSteamAccessControlPlane('steamkit-download', { forceRefresh: false }));
      const warmupRace = await Promise.race([
        warmupPromise.then(result => ({ type: 'result', result }), error => ({ type: 'error', error })),
        delay(warmupTimeoutMs, { type: 'timeout' }),
      ]);
      throwIfDownloadCancelled(options, 'Steam WebAPI route warmup');
      if (warmupRace.type === 'timeout') {
        logger.warn(`[SteamKit] Steam WebAPI control-plane warmup still running after ${warmupTimeoutMs}ms; spawning DepotDownloader and refreshing routes in background.`);
        warmupPromise.then((warmup) => {
          if (warmup && warmup.ok > 0) logger.log(`[SteamKit] Steam WebAPI control-plane routes warmed in background: ${warmup.ok}/${warmup.total || 0}`);
          else logger.warn('[SteamKit] Steam WebAPI control-plane background warmup returned no ready route');
        }).catch((error) => {
          logger.warn('[SteamKit] Steam WebAPI control-plane background warmup failed:', error.message);
        });
      } else if (warmupRace.type === 'error') {
        throw warmupRace.error;
      } else {
        const warmup = warmupRace.result;
        const elapsed = Date.now() - warmupStartedAt;
        if (warmup && warmup.ok > 0) logger.log(`[SteamKit] Steam WebAPI control-plane routes ready: ${warmup.ok}/${warmup.total || 0} (${elapsed}ms)`);
        else logger.warn(`[SteamKit] Steam WebAPI control-plane route warmup returned no ready route (${elapsed}ms)`);
      }
    } catch (error) {
      if (error && (error.code === 'CANCELLED' || error.name === 'AbortError')) throw error;
      logger.warn('[SteamKit] Steam WebAPI control-plane route warmup failed:', error.message);
    }
    throwIfDownloadCancelled(options, 'Steam WebAPI route warmup');
    ensureDir(DEPOT_CONFIG_DIR);

    const forceSharedDir = !!(options && options.forceSharedDir);
    const tempRoot = forceSharedDir || STEAM_CREDENTIALS.isPersistent
      ? STEAMKIT_CONFIG_DIR
      : fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-steamkit-'));
    ensureDir(tempRoot);

    const rawRoot = path.join(tempRoot, 'depotdownloader', 'downloads', String(appId), String(publishedFileId));
    ensureDir(rawRoot);

    const readDepotProgress = createWallhubDepotProgressReader();
    const readDepotCdnLog = createWallhubDepotCdnLogReader('[SteamKit CDN]', { source: 'download', mode: 'steamkit' });
    const resumeSeed = options && options.task
      ? seedTaskProgressFromTrustedCheckpoint(options.task, rawRoot, appId, publishedFileId)
      : { source: readTrustedResumeCheckpoint(rawRoot, appId, publishedFileId) ? 'checkpoint' : 'none', downloaded: 0, total: 0 };
    const resumeCheckpointAtStart = resumeSeed.source === 'checkpoint' || resumeSeed.source === 'partial-files';
    if (resumeSeed.source === 'checkpoint') {
      logger.log(`[SteamKit resume] item ${publishedFileId}: loaded checkpoint downloaded=${resumeSeed.downloaded} total=${resumeSeed.total} progress=${resumeSeed.total ? ((resumeSeed.downloaded / resumeSeed.total) * 100).toFixed(1) : '0.0'}%`);
    } else if (resumeSeed.source === 'partial-files') {
      logger.log(`[SteamKit resume] item ${publishedFileId}: partial files found; file sizes are untrusted and DepotDownloader validation will determine resumable chunks`);
    } else {
      logger.log(`[SteamKit resume] item ${publishedFileId}: no trusted checkpoint or partial files found at ${rawRoot}`);
    }
    if (options && options.task) {
      options.task.progressIndeterminate = options.task.progressIndeterminate !== false;
      options.task.progressStage = options.task.progressStage || 'SteamKit 正在连接 Steam3，等待下载器返回真实进度';
      options.task.progress = Math.max(0, Number(options.task.progress || 0));
      options.task.downloaded = Math.max(0, Number(options.task.downloaded || 0));
      options.task.speed = 0;
      options.task._depotIdleTimeout = false;
      options.task._depotIdleStage = '';
    }

    const { command } = depotCommandFor(executable);
    const loginSlotLease = acquireSteamKitLoginSlot(appId, depotLogin.user);
    const built = buildArgs(executable, publishedFileId, appId, tempRoot, rawRoot, Object.assign({}, options, {
      depotLogin,
      jsonProgress: true,
      steamKitLoginId: loginSlotLease && loginSlotLease.loginId,
    }));
    logger.log(`[SteamKit] DepotDownloader item ${publishedFileId} -> ${rawRoot}`);
    logger.log(`[SteamKit] Running JSON progress DepotDownloader: ${command} args=${JSON.stringify(redactDepotArgs(built.args))}`);
    logger.log(`[SteamKit] Downloader runtime: ${executable}`);
    logger.log(`[SteamKit] Steam CDN route: ${describeSteamCdnRouteStrategy()} · max ${getSteamKitMaxDownloads()}${getSteamContentCellId() ? ` · cell ${getSteamContentCellId()}` : ''}`);
    if (options && options.steam3ProtocolOverride) logger.log(`[SteamKit] Steam3 protocol retry: ${options.steam3ProtocolOverride}`);
    if (depotLogin.user) {
      logger.log(`[SteamKit] Using ${depotLogin.source} account: ${depotLogin.user}${depotLogin.pass ? ' (password supplied)' : ' (remembered session)'}`);
      if (loginSlotLease) logger.log(`[SteamKit] Reusing account-level login slot #${loginSlotLease.slot} for remembered SteamKit tokens`);
    }

    let lastSteamKitStageText = 'SteamKit 子进程尚未启动';
    let hasSteam3LoginStarted = false;
    try {
      const spawnStartedAt = Date.now();
      let lastOutputAt = spawnStartedAt;
      let lastStageKey = '';
      let lastStageText = 'SteamKit 子进程已启动，等待 Steam3 控制面输出';
      lastSteamKitStageText = lastStageText;
      let lastIdleLogAt = 0;
      let lastHandledLiveResumeAt = 0;
      let hasEnteredContent = false;
      let hasTrustedContentProgress = false;
      let hasPostContentReconnect = false;
      let watchdog = null;
      let lastResumeProgressLogAt = 0;
      const recordStage = (diagnostic) => {
        if (!diagnostic || !diagnostic.stage) return;
        if (diagnostic.event === 'api-connect-failed' && diagnostic.host && diagnostic.ip) {
          markSteamAccessControlPlaneFailure(diagnostic.host, diagnostic.ip, diagnostic.detail || 'depotdownloader-webapi-failed', {
            source: 'depotdownloader',
            stage: 'steamkit-webapi',
            port: diagnostic.port || 443,
          });
        }
        lastStageText = diagnostic.stage;
        lastSteamKitStageText = diagnostic.stage;
        if (diagnostic.key === 'steam3-login') hasSteam3LoginStarted = true;
        if (isSteamKitContentStageKey(diagnostic.key)) hasEnteredContent = true;
        if (hasTrustedContentProgress && (
          diagnostic.key === 'steam3-connect' ||
          diagnostic.key === 'steam3-login' ||
          diagnostic.key === 'steam3-licenses' ||
          diagnostic.key === 'api-broker-required:CMWebSocket'
        )) {
          hasPostContentReconnect = true;
        }
        if (options && options.task) {
          options.task.progressStage = diagnostic.stage;
          if (resumeCheckpointAtStart && options.task.progressStageMode !== 'progress') options.task.progressStageMode = 'loading';
        }
        if (diagnostic.key === lastStageKey) return;
        lastStageKey = diagnostic.key;
        const elapsed = Date.now() - spawnStartedAt;
        const detail = diagnostic.detail ? ` · ${diagnostic.detail}` : '';
        const line = `[SteamKit stage] +${elapsed}ms ${diagnostic.stage}${detail}`;
        if (diagnostic.level === 'warn' && logger.warn) logger.warn(line);
        else logger.log(line);
      };
      const onOutput = (chunk) => {
        readDepotCdnLog(chunk);
        lastOutputAt = Date.now();
        recordStage(classifySteamKitControlPlaneOutput(chunk));
        if (!(options && options.task)) return;
        appendTaskProcessOutput(options.task, chunk);
        const byteProgress = readDepotProgress(chunk);
        if (byteProgress) {
          if (!isTrustedDepotProgress(rawRoot, appId, publishedFileId, byteProgress)) {
            if (resumeSeed.source === 'checkpoint') {
              options.task.progressIndeterminate = false;
              options.task.progressStageMode = 'loading';
            } else {
              options.task.progressIndeterminate = true;
              if (resumeCheckpointAtStart) options.task.progressStageMode = 'loading';
            }
            options.task.progressStage = 'SteamKit 正在校验本地文件，等待真实下载进度';
            logger.log(`[SteamKit resume] item ${publishedFileId}: ignored untrusted progress downloaded=${Math.max(0, Math.floor(Number(byteProgress.downloaded || 0)))} total=${Math.max(0, Math.floor(Number(byteProgress.total || 0)))} networkSession=${Math.max(0, Math.floor(Number(byteProgress.networkDownloaded || 0)))}`);
            return;
          }
          hasEnteredContent = true;
          hasTrustedContentProgress = true;
          const visibleProgress = normalizeResumeDepotProgress(rawRoot, appId, publishedFileId, byteProgress, resumeSeed);
          writeTrustedResumeCheckpoint(rawRoot, appId, publishedFileId, visibleProgress);
          const now = Date.now();
          if (!lastResumeProgressLogAt || now - lastResumeProgressLogAt > 5000 || visibleProgress.downloaded >= visibleProgress.total) {
            lastResumeProgressLogAt = now;
            const percent = visibleProgress.total > 0 ? ((visibleProgress.downloaded / visibleProgress.total) * 100).toFixed(1) : '0.0';
            logger.log(`[SteamKit resume] item ${publishedFileId}: progress downloaded=${visibleProgress.downloaded} total=${visibleProgress.total} progress=${percent}% networkSession=${Math.max(0, Math.floor(Number(byteProgress.networkDownloaded || 0)))}`);
          }
          options.task.progressStageMode = 'progress';
          applyTaskByteProgress(options.task, visibleProgress.downloaded, visibleProgress.total, {
            stage: 'SteamKit 正在下载文件',
            stageMode: 'progress',
            speedBytes: byteProgress.networkDownloaded
          });
        }
      };
      const childEnv = buildSteamContentEnv(Object.assign({}, process.env, buildDepotDotnetEnv()));
      if (options && options.steam3ProtocolOverride) childEnv.WALLHUB_DEPOT_STEAM3_PROTOCOL = String(options.steam3ProtocolOverride);
      throwIfDownloadCancelled(options, 'before spawning DepotDownloader');
      const proc = runProcess(command, built.args, 0, {
        cwd: DEPOT_CONFIG_DIR,
        inputLines: built.inputLines,
        // DepotDownloader is driven non-interactively from WallHub. Always close stdin
        // after optional guard input so a stale remembered session cannot hang forever
        // waiting for password/Steam Guard input without producing output.
        closeStdin: true,
        env: childEnv,
        replaceEnv: true,
        preparedEnv: true,
        onStdout: onOutput,
        onStderr: onOutput,
        sanitizeErrorOutput: (text) => stripWallhubDiagnosticOutput(text)
      });
      if (options && options.task) options.task.processPromise = proc;
      let abortListener = null;
      if (options && options.signal && typeof options.signal.addEventListener === 'function' && proc && proc.kill) {
        abortListener = () => {
          if (options.task) options.task.progressStage = '任务已取消，正在停止 SteamKit 下载器';
          proc.kill();
        };
        if (options.signal.aborted) abortListener();
        else options.signal.addEventListener('abort', abortListener, { once: true });
      }
      if (options && options.task) {
        const baseIdleTimeout = steamKitIdleTimeoutForStage('', false);
        watchdog = setInterval(() => {
          const now = Date.now();
          const watchdogState = steamKitIdleWatchdogState({
            task: options.task,
            stageKey: lastStageKey,
            hasResumeCheckpoint: resumeCheckpointAtStart,
            hasEnteredContent,
            hasPostContentReconnect,
            lastOutputAt,
            lastHandledResumeAt: lastHandledLiveResumeAt,
            now,
          });
          lastOutputAt = watchdogState.lastOutputAt;
          lastHandledLiveResumeAt = watchdogState.lastHandledResumeAt;
          if (watchdogState.suspended) {
            lastIdleLogAt = now;
            return;
          }
          const idleMs = now - lastOutputAt;
          const idleLimit = watchdogState.idleLimit;
          const contentLikeIdle = idleLimit > baseIdleTimeout;
          if (idleMs > 15000 && now - lastIdleLogAt > 15000) {
            lastIdleLogAt = now;
            const seconds = Math.round(idleMs / 1000);
            const limitSeconds = Math.round(idleLimit / 1000);
            logger.warn(`[SteamKit idle] ${seconds}s without DepotDownloader output; last stage: ${lastStageText}; limit=${limitSeconds}s`);
            options.task.progressStage = contentLikeIdle
              ? `${lastStageText}，可能正在续传校验或等待 SteamPipe CDN，已 ${seconds}s 无新输出`
              : `${lastStageText}，已 ${seconds}s 无新输出`;
          }
          if (idleMs <= idleLimit) return;
          const idleStage = contentLikeIdle ? 'content' : 'control';
          options.task._depotIdleTimeout = true;
          options.task._depotIdleStage = idleStage;
          options.task.progressStage = contentLikeIdle
            ? `SteamPipe CDN/续传校验长时间没有输出，正在中止；最后阶段：${lastStageText}`
            : `SteamKit 下载器长时间没有输出，正在中止；最后阶段：${lastStageText}`;
          logger.warn(`[SteamKit idle] aborting after ${Math.round(idleMs / 1000)}s without output; idleStage=${idleStage}; last stage: ${lastStageText}`);
          if (proc && proc.kill) proc.kill();
        }, 5000);
      }
      try {
        await proc;
      } finally {
        if (abortListener && options && options.signal && typeof options.signal.removeEventListener === 'function') {
          options.signal.removeEventListener('abort', abortListener);
        }
        if (watchdog) clearInterval(watchdog);
      }
      throwIfDownloadCancelled(options, 'DepotDownloader');
      if (depotLogin.user && depotLogin.isPersistent) setValidatedPersistentLogin(depotLogin.user, 'steamkit');
      if (STEAM_CREDENTIALS.username && (STEAM_CREDENTIALS.password || STEAM_CREDENTIALS.steamGuardCode)) {
        STEAM_CREDENTIALS.password = '';
        STEAM_CREDENTIALS.steamGuardCode = '';
        STEAM_CREDENTIALS.isPersistent = true;
      }
    } catch (error) {
      if (isDepotLoginVerifiedDespiteCanceled(error && error.message || error)) {
        // A canceled helper can still leave a valid persisted account session.
      } else if (options && options.task && options.task._depotIdleTimeout) {
        if (options.task._depotIdleStage === 'content') {
          throw codedError(
            'SteamKit 已进入文件内容下载/续传校验阶段，但 SteamPipe CDN 长时间没有继续输出。已避免误判为 Steam3 登录超时；请稍后重试或在设置中切换 Steam CDN 路由/降低并发后重试。',
            'STEAM_CONTENT_STALLED',
            504
          );
        }
        throw makeNetworkError('DepotDownloader 卡在 Steam3 连接或下载器无输出超时。请检查 Steam3 网络连通性、代理设置，或在设置中切换 Steam CDN 路由后重试。');
      } else {
        throw normalizeError(error, { lastStageText: lastSteamKitStageText, hasSteam3LoginStarted });
      }
    } finally {
      releaseSteamKitLoginSlot(loginSlotLease);
      if (options && options.task) {
        options.task.speed = 0;
        delete options.task._depotIdleTimeout;
      }
    }

    throwIfDownloadCancelled(options, 'finalizing output');
    const itemDir = normalizeOutput(rawRoot, tempRoot, appId, publishedFileId);
    throwIfDownloadCancelled(options, 'finalizing output');
    if (options && options.task) {
      options.task.progressStage = '正在整理文件';
      options.task.progress = 96;
      options.task.progressIndeterminate = false;
    }
    const finalDir = finalizeWorkshopItem(itemDir, publishedFileId);
    throwIfDownloadCancelled(options, 'finalizing output');
    try { deletePathIfInside(rawRoot, [STEAMKIT_CONFIG_DIR, os.tmpdir()]); } catch {}
    cleanupRuntimeDownloadResidues(appId, runtimeResidueKeepIds(publishedFileId));
    if (options && options.videoOnly) {
      const videoPath = pickVideoFile(finalDir);
      if (videoPath) {
        const videoExt = extFromPath(videoPath, '.mp4');
        const videoName = `${safeName(title || `Wallpaper ${publishedFileId}`)}-${publishedFileId}${videoExt}`;
        return { kind: 'file', filePath: videoPath, fileName: videoName, tempRoot, useSharedDir: tempRoot === STEAMKIT_CONFIG_DIR, itemDir: finalDir };
      }
    }
    const folderName = `${safeName(title || `Wallpaper ${publishedFileId}`)}-${publishedFileId}`;
    return { kind: 'file', filePath: finalDir, fileName: folderName, tempRoot, useSharedDir: tempRoot === STEAMKIT_CONFIG_DIR, itemDir: finalDir };
  }

  async function downloadWorkshopItem(publishedFileId, appId, title, options = {}) {
    throwIfDownloadCancelled(options, 'startup preparation');
    await waitForStartupPreparationForDownload(options && options.task);
    throwIfDownloadCancelled(options, 'startup preparation');
    const activeKey = `${appId || 431960}:${publishedFileId}`;
    const existing = activeDownloads.get(activeKey);
    if (existing) {
      if (options && options.task) {
        options.task.progressIndeterminate = true;
        options.task.progressStage = '同一项目已在下载，正在复用当前 DepotDownloader 任务';
      }
      return existing;
    }
    const promise = (async () => {
      try {
        throwIfDownloadCancelled(options, 'before SteamKit download');
        return await downloadViaSteamKit(publishedFileId, appId, title, options);
      } catch (error) {
        const err = normalizeError(error);
        if (!options._steamContentAutoRetry && err.code === 'STEAM_CONTENT_STALLED') {
          if (options && options.task) {
            options.task.progressIndeterminate = true;
            options.task.progressStage = 'SteamPipe CDN 已停滞，正在保留可信进度并快速校验续传';
            options.task.progressStageMode = 'loading';
            options.task.speed = 0;
          }
          logger.warn(`[SteamKit] Download ${publishedFileId} content stream stalled; restarting once from the trusted checkpoint.`);
          return downloadViaSteamKit(publishedFileId, appId, title, Object.assign({}, options, { _steamContentAutoRetry: true }));
        }
        const configuredSteam3Protocol = String(process.env.WALLHUB_DEPOT_STEAM3_PROTOCOL || process.env.WALLHUB_STEAM3_PROTOCOL || '').trim();
        if (!options._steam3WebsocketRetry && !configuredSteam3Protocol && err.code === 'STEAM_NETWORK_UNREACHABLE') {
          if (options && options.task) {
            options.task.progressIndeterminate = true;
            options.task.progressStage = 'Steam3 直连超时，正在使用 websocket 重试';
            options.task.speed = 0;
          }
          logger.warn(`[SteamKit] Download ${publishedFileId} Steam3 connection timed out; retrying once with websocket protocol.`);
          return downloadViaSteamKit(publishedFileId, appId, title, Object.assign({}, options, {
            _steam3WebsocketRetry: true,
            steam3ProtocolOverride: 'websocket',
          }));
        }
        if (!options._steamLoginAutoRetry && shouldRetrySteamLoginRequiredError(err)) {
          if (options && options.task) {
            options.task.progressIndeterminate = true;
            options.task.progressStage = 'SteamKit saved session needs a retry; validating local login';
            options.task.speed = 0;
          }
          logger.warn(`[SteamKit] Download ${publishedFileId} reported login required despite cached account; retrying once.`);
          const refreshed = await refreshPersistentSteamLoginForRetry(`download:${publishedFileId}`);
          if (refreshed) {
            return downloadViaSteamKit(publishedFileId, appId, title, Object.assign({}, options, { _steamLoginAutoRetry: true }));
          }
        }
        throw err;
      }
    })();
    activeDownloads.set(activeKey, promise);
    try {
      return await promise;
    } finally {
      if (activeDownloads.get(activeKey) === promise) activeDownloads.delete(activeKey);
    }
  }

  return {
    codedError,
    steamKitNeedsOwnedAccount,
    makeLoginRequiredError,
    makeGuardRequiredError,
    makeLoginFailedError,
    makeNetworkError,
    resolveLogin,
    canUseLogin,
    makeJsonProgressRequiredError,
    buildArgs,
    redactDepotArgs,
    normalizeOutput,
    normalizeError,
    downloadViaSteamKit,
    downloadWorkshopItem,
  };
}

module.exports = {
  createSteamKitDownloadService,
  classifySteamKitControlPlaneOutput,
  isSteamKitContentStageKey,
  steamKitIdleTimeoutForStage,
  steamKitIdleWatchdogState,
  steamKitPreSpawnWarmupTimeoutMs,
};
