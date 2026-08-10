'use strict';

function createQrSession(options) {
  async function startQrSession() {
    if (options.effectiveDownloaderMode() !== 'steamkit') {
      const error = new Error('扫码登录仅支持 SteamKit / DepotDownloader 模式。');
      error.code = 'STEAMKIT_QR_UNSUPPORTED';
      error.statusCode = 400;
      throw error;
    }
    const executable = await options.ensureDepotDownloaderReady();
    options.ensureDir(options.configDir);
    const { command, argsPrefix } = options.depotCommandFor(executable);
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const session = {
      kind: 'qr',
      id,
      status: 'starting',
      output: '',
      username: '',
      message: '正在启动 Steam 扫码登录',
      error: '',
      done: false,
      updatedAt: Date.now(),
      cleanupTimer: null,
      processPromise: null,
    };
    options.sessions.set(id, session);

    const args = [
      ...argsPrefix,
      '-wallhub-cm-login',
      '-qr',
      '-remember-password',
      '-max-downloads', '1',
      '-loginid', options.makeDepotLoginId(`qr:${id}`),
    ];
    if (process.env.DEPOTDOWNLOADER_DEBUG === '1') args.push('-debug');

    const appendOutput = (chunk) => {
      const text = String(chunk || '');
      session.output = options.sanitizeQrOutput((session.output || '') + text);
      const parsedUser = options.parseQrUsername(session.output);
      if (parsedUser) session.username = parsedUser;
      if (/Use the Steam Mobile App to sign in with this QR code/i.test(session.output) || /QR code has changed/i.test(session.output)) {
        session.status = 'waiting';
        session.message = '请使用 Steam 手机 App 扫描二维码';
      } else if (/Logging in with QR code/i.test(session.output)) {
        session.status = 'waiting';
        session.message = '正在等待扫码确认';
      } else if (/Logging\s+['"].+['"]\s+into Steam3/i.test(session.output)) {
        session.status = 'validating';
        session.message = 'Steam 已确认，正在保存本地会话';
      }
      session.updatedAt = Date.now();
      options.refreshQrImage(session).catch(error => options.logger.warn('[SteamKit QR] QR image refresh failed:', error.message));
    };

    options.logger.log('[SteamKit QR] Starting DepotDownloader QR login session');
    const timeout = Math.max(60000, parseInt(process.env.WALLHUB_STEAMKIT_QR_TIMEOUT || '300000', 10) || 300000);
    const proc = options.runProcess(command, args, timeout, {
      cwd: options.configDir,
      closeStdin: true,
      env: options.buildDepotDotnetEnv(),
      steamAuth: true,
      onStdout: appendOutput,
      onStderr: appendOutput,
    });
    session.processPromise = proc;
    proc.then(() => {
      const username = session.username || options.parseQrUsername(session.output) || 'Steam QR 用户';
      options.setValidatedPersistentLogin(username, 'steamkit');
      options.logger.log(`[SteamKit QR] Login succeeded: ${username}`);
      options.finish(session, {
        status: 'success',
        username,
        message: 'Steam 扫码登录成功，会话已持久化',
        error: '',
      });
    }).catch((error) => {
      const message = String((error && error.message) || error || '扫码登录失败');
      const parsedUser = session.username || options.parseQrUsername(`${session.output}\n${message}`);
      if (parsedUser && options.isDepotLoginVerifiedDespiteCanceled(`${session.output}\n${message}`)) {
        options.setValidatedPersistentLogin(parsedUser, 'steamkit');
        options.finish(session, {
          status: 'success',
          username: parsedUser,
          message: 'Steam 扫码登录成功，会话已持久化',
          error: '',
        });
        return;
      }
      const normalized = options.normalizeSteamKitLoginError(error);
      options.logger.warn('[SteamKit QR] Login failed:', message);
      options.finish(session, {
        status: 'error',
        message: 'Steam 扫码登录失败',
        error: normalized.message || message,
      });
    });

    return options.snapshot(session);
  }

  function getQrSession(id) {
    const session = options.sessions.get(String(id || ''));
    if (!session || session.kind !== 'qr') return null;
    return options.snapshot(session);
  }

  function cancelQrSession(id) {
    const session = options.sessions.get(String(id || ''));
    if (!session) return false;
    try {
      if (session.processPromise && session.processPromise.kill) session.processPromise.kill();
    } catch {}
    options.finish(session, {
      status: 'cancelled',
      message: '已取消扫码登录',
      error: '',
    });
    return true;
  }

  return {
    startQrSession,
    getQrSession,
    cancelQrSession,
  };
}

module.exports = {
  createQrSession,
};
