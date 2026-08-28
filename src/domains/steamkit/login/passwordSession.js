'use strict';

function createPasswordSession(options) {
  const debugLogger = options.debugLogger || options.logger;
  function buildValidationArgs(executable, username, password, steamGuardCode, loginIdSeed) {
    const { argsPrefix } = options.depotCommandFor(executable);
    const args = [
      ...argsPrefix,
      '-wallhub-cm-login',
      '-wallhub-password-stdin',
      '-username', username,
      '-remember-password',
      '-max-downloads', '1',
      '-loginid', options.makeDepotLoginId(loginIdSeed || `login:${username}`),
    ];
    if (steamGuardCode) args.push('-no-mobile');
    if (process.env.DEPOTDOWNLOADER_DEBUG === '1') args.push('-debug');
    return { args, inputLines: steamGuardCode ? [password, steamGuardCode] : [password] };
  }

  function buildLoginEnv() {
    const env = options.buildDepotDotnetEnv();
    if (!env.WALLHUB_DEPOT_STEAM3_PROTOCOL) env.WALLHUB_DEPOT_STEAM3_PROTOCOL = 'websocket';
    return env;
  }

  async function verifyLogin(username, password, steamGuardCode, progress = {}) {
    const reportProgress = typeof progress.onProgress === 'function' ? progress.onProgress : () => {};
    const reportOutput = typeof progress.onOutput === 'function' ? progress.onOutput : () => {};
    reportProgress({ status: 'starting', message: '正在准备 Steam 登录组件' });
    const executable = await options.ensureDepotDownloaderReady();
    options.ensureDir(options.configDir);
    try {
      const { command } = options.depotCommandFor(executable);
      const built = buildValidationArgs(executable, username, password, steamGuardCode, `login:${username}`);
      const timeout = Math.max(30000, parseInt(process.env.WALLHUB_STEAMKIT_LOGIN_TIMEOUT || '120000', 10) || 120000);
      debugLogger.log(`[SteamKit Login] Verifying Steam account through a dedicated Steam CM session: ${username}`);
      reportProgress({ status: 'validating', message: '正在向 Steam 验证账号' });
      await options.runProcess(command, built.args, timeout, {
        cwd: options.configDir,
        inputLines: built.inputLines,
        closeStdin: true,
        env: buildLoginEnv(),
        steamAuth: true,
        onStdout: reportOutput,
        onStderr: reportOutput,
      });
      options.logger.log(`[SteamKit Login] DepotDownloader session persisted for: ${username}`);
      debugLogger.log('[SteamKit Login] Remembered session is managed by DepotDownloader/.NET isolated storage.');
      reportProgress({ status: 'success', message: 'Steam 登录验证完成，正在保存本地会话' });
    } catch (error) {
      if (options.isDepotLoginVerifiedDespiteCanceled(error && error.message || error)) {
        options.logger.warn('[SteamKit Login] DepotDownloader canceled after successful Steam3 login; treating account verification as successful.');
        return;
      }
      throw options.normalizeSteamKitLoginError(error);
    }
  }

  function passwordLoginNeedsPhoneConfirmation(output) {
    const text = String(output || '');
    return /(?:steam\s*(?:mobile|guard).*?(?:confirm|approval|approve)|(?:confirm|approval|approve).*?steam\s*(?:mobile|app|guard)|(?:check|open|view).*?steam\s*(?:mobile|app)|手机.*(?:确认|批准|放行)|(?:确认|批准|放行).*?手机)/i.test(text);
  }

  function startPasswordSession(username, password, steamGuardCode = '') {
    const user = String(username || '').trim();
    const secret = String(password || '');
    const guard = String(steamGuardCode || '').trim();
    if (!user || !secret) {
      const error = new Error('用户名和密码不能为空');
      error.statusCode = 400;
      throw error;
    }

    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const session = {
      kind: 'password',
      id,
      status: 'starting',
      output: '',
      username: user,
      message: '正在准备 Steam 登录组件',
      error: '',
      code: '',
      needsSteamGuard: false,
      requiresPhoneConfirmation: false,
      tempRoot: '',
      done: false,
      updatedAt: Date.now(),
      cleanupTimer: null,
      processPromise: null,
    };
    options.sessions.set(id, session);

    const update = (patch) => {
      if (session.done) return;
      Object.assign(session, patch, { updatedAt: Date.now() });
    };
    const appendOutput = (chunk) => {
      session.output = String(`${session.output || ''}${String(chunk || '')}`).slice(-6000);
      if (passwordLoginNeedsPhoneConfirmation(session.output)) {
        update({
          status: 'waiting-phone',
          message: '需要在 Steam 手机 App 中确认本次登录，请查看手机',
          requiresPhoneConfirmation: true,
        });
      }
    };

    session.processPromise = verifyLogin(user, secret, guard, {
      onProgress: ({ status, message }) => {
        if (status === 'success') return;
        update({ status, message });
      },
      onOutput: appendOutput,
    }).then(() => {
      options.setValidatedPersistentLogin(user, 'steamkit');
      options.finish(session, {
        status: 'success',
        message: 'Steam 登录成功，会话已持久化',
        error: '',
        code: '',
        requiresPhoneConfirmation: false,
      });
    }).catch((error) => {
      const normalized = options.normalizeSteamKitLoginError(error);
      const networkFailure = normalized.code === 'STEAM_NETWORK_UNREACHABLE' || normalized.code === 'STEAM_LOGIN_TIMEOUT';
      if (session.requiresPhoneConfirmation && normalized.code === 'STEAM_LOGIN_FAILED') {
        options.finish(session, {
          status: 'error',
          message: 'Steam 手机确认未完成',
          error: 'Steam 手机确认未完成或已过期，请重新登录并及时在 Steam 手机 App 中批准本次登录。',
          code: 'STEAM_PHONE_CONFIRMATION_REQUIRED',
          needsSteamGuard: false,
          requiresPhoneConfirmation: true,
        });
        return;
      }
      const needsSteamGuard = !networkFailure && (normalized.code === 'STEAM_GUARD_REQUIRED' || !!normalized.requiresSteamGuard);
      options.finish(session, {
        status: needsSteamGuard ? 'needs-guard' : 'error',
        message: needsSteamGuard ? '需要 Steam Guard 验证码' : 'Steam 登录失败',
        error: normalized.message || String(error || 'Steam 登录失败'),
        code: normalized.code || '',
        needsSteamGuard,
        requiresPhoneConfirmation: false,
      });
    });

    return options.snapshot(session);
  }

  async function verifyRememberedSession(username) {
    const user = String(username || '').trim();
    if (!user) throw new Error('cached username is empty');
    const executable = await options.ensureDepotDownloaderReady();
    try {
      const { command, argsPrefix } = options.depotCommandFor(executable);
      const args = [
        ...argsPrefix,
        '-wallhub-cm-login',
        '-username', user,
        '-remember-password',
        '-max-downloads', '1',
        '-loginid', options.makeDepotLoginId(`session:${user}`),
      ];
      const timeout = Math.max(30000, parseInt(process.env.WALLHUB_STEAMKIT_LOGIN_TIMEOUT || '120000', 10) || 120000);
      debugLogger.log(`[SteamKit Login] Validating remembered session via DepotDownloader: ${user}`);
      await options.runProcess(command, args, timeout, {
        cwd: options.configDir,
        closeStdin: true,
        env: buildLoginEnv(),
        steamAuth: true,
      });
    } catch (error) {
      if (options.isDepotLoginVerifiedDespiteCanceled(error && error.message || error)) {
        options.logger.warn('[SteamKit Login] DepotDownloader canceled after validating remembered Steam3 login; keeping cached session.');
        return;
      }
      throw options.normalizeSteamKitLoginError(error);
    }
  }

  return {
    verifyLogin,
    startPasswordSession,
    verifyRememberedSession,
  };
}

module.exports = {
  createPasswordSession,
};
