'use strict';

const { stripWallhubDiagnosticOutput } = require('../depotTools');
const { isSteamKitContentStageText } = require('./watchdog');

function createDownloadAuth(deps = {}) {
  const {
    STEAM_CREDENTIALS,
    depotDotnetMissingMessage,
    isDepotNetworkFailureMessage,
    isDepotAuthFailureMessage,
    isDepotGuardRequiredMessage,
    depotCommandFor,
    getSteamKitMaxDownloads,
    makeDepotLoginId,
    getSteamContentCellId,
  } = deps;
  const guardRequired = typeof isDepotGuardRequiredMessage === 'function'
    ? isDepotGuardRequiredMessage
    : () => false;
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
    const isPersistent = source === 'web'
      ? !!(STEAM_CREDENTIALS.username && (STEAM_CREDENTIALS.isPersistent || STEAM_CREDENTIALS.pendingPersistentUsername))
      : false;
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

  function acquireSteamKitLoginSlot(appId, user) {
    const account = String(user || '').trim().toLowerCase();
    if (!account) return null;
    const seed = `download:${appId || 431960}:${account}`;
    let slots = activeLoginSlots.get(seed);
    if (!slots) {
      slots = new Set();
      activeLoginSlots.set(seed, slots);
    }
    let slot = 0;
    while (slots.has(slot)) slot += 1;
    slots.add(slot);
    return { seed, slot, loginId: stableDepotLoginId(`${seed}:slot:${slot}`) };
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

  function normalizeError(error, context = {}) {
    const rawMsg = [
      error && error.stderr,
      error && error.stdout,
      error && error.message || error,
    ].filter(Boolean).map(String).join('\n');
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
    if (guardRequired(msg)) return makeGuardRequiredError();
    if (isDepotAuthFailureMessage(msg)) return makeLoginFailedError('Steam 登录失败，请检查账号、密码或 Steam Guard 验证码。');
    return error instanceof Error ? error : new Error(msg);
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
    acquireSteamKitLoginSlot,
    releaseSteamKitLoginSlot,
    buildArgs,
    redactDepotArgs,
    normalizeError,
  };
}

module.exports = { createDownloadAuth };
