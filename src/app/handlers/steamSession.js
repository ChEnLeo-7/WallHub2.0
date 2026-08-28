'use strict';

function createSteamSessionHandlers(options = {}) {
  const {
    jsonRes,
    readBody,
    credentials,
    getOwnership,
    setOwnership,
    getSettings,
    saveSettings,
    verifyLogin,
    startPasswordSession,
    getPasswordSession,
    startQrSession,
    getQrSession,
    cancelQrSession,
    normalizeError,
    stopQueryBridge,
    clearAuth,
    getRuntimeSetupStatus,
    effectiveDownloaderMode,
    getDownloaderMode,
    logger = console,
    debugLogger = logger,
  } = options;

  async function handleSteamKitLogin(res, payload) {
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    const steamGuardCode = String(payload.steamGuardCode || '').trim();
    const isRetry = !!payload.isRetry;
    if (!username || !password) return jsonRes(res, 400, { error: '用户名和密码不能为空' });

    try {
      await verifyLogin(username, password, steamGuardCode);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error || 'Steam 登录失败'));
      logger.warn(`[Steam Login] failed user=${username} code=${normalized.code || 'STEAM_LOGIN_FAILED'} error=${normalized.message}`);
      if (normalized.code === 'STEAM_GUARD_REQUIRED' && !steamGuardCode && !isRetry) {
        return jsonRes(res, 202, {
          error: normalized.message,
          code: normalized.code,
          needsSteamGuard: true,
          requiresSteamLogin: true,
          requiresSteamGuard: true,
        });
      }
      return jsonRes(res, normalized.statusCode || 500, {
        error: normalized.message,
        code: normalized.code || '',
        needsSteamGuard: !!normalized.requiresSteamGuard,
        requiresSteamLogin: !!normalized.requiresSteamLogin,
        requiresSteamGuard: !!normalized.requiresSteamGuard,
      });
    }

    credentials.username = username;
    credentials.password = '';
    credentials.steamGuardCode = '';
    credentials.isPersistent = true;
    credentials.pendingPersistentUsername = '';
    const settings = getSettings();
    settings.steamUsername = username;
    settings.steamIsPersistent = true;
    settings.authBackend = 'steamkit';
    saveSettings();
    logger.log(`[Steam Login] success user=${username} persistent=true backend=steamkit`);

    jsonRes(res, 200, {
      success: true,
      message: 'SteamKit 登录验证成功，DepotDownloader 会话已持久化',
      username,
      hasSteamGuard: false,
      isPersistent: true,
      backend: 'steamkit',
    });
  }

  async function handleSteamLogin(req, res) {
    let payload;
    try { payload = JSON.parse(await readBody(req)); }
    catch { return jsonRes(res, 400, { error: 'Bad JSON' }); }
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    const steamGuardCode = String(payload.steamGuardCode || '').trim();
    const isRetry = payload.isRetry || false;
    if (!username || !password) return jsonRes(res, 400, { error: '用户名和密码不能为空' });
    debugLogger.log(`[Steam Login] Attempting SteamKit login for user: ${username}, SteamGuard: ${steamGuardCode ? 'Yes' : 'No'}, Retry: ${isRetry}`);
    return handleSteamKitLogin(res, payload);
  }

  async function handleSteamPasswordLoginStart(req, res) {
    let payload;
    try { payload = JSON.parse(await readBody(req)); }
    catch { return jsonRes(res, 400, { error: 'Bad JSON' }); }
    const username = String(payload.username || '').trim();
    const password = String(payload.password || '');
    if (!username || !password) return jsonRes(res, 400, { error: '用户名和密码不能为空' });
    try {
      debugLogger.log(`[Steam Login] Starting tracked SteamKit login for user: ${username}`);
      return jsonRes(res, 200, startPasswordSession(payload));
    } catch (error) {
      const normalized = normalizeError(error);
      return jsonRes(res, normalized.statusCode || 500, {
        error: normalized.message || 'Steam 登录失败',
        code: normalized.code || '',
        requiresSteamLogin: !!normalized.requiresSteamLogin,
        requiresSteamGuard: !!normalized.requiresSteamGuard,
      });
    }
  }

  async function handleSteamPasswordLoginStatus(req, res) {
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const session = getPasswordSession(id);
    if (!session) return jsonRes(res, 404, { error: '账号登录会话不存在或已过期' });
    return jsonRes(res, 200, session);
  }

  async function handleSteamQrLoginStart(_req, res) {
    try {
      jsonRes(res, 200, await startQrSession());
    } catch (error) {
      const normalized = normalizeError(error);
      jsonRes(res, normalized.statusCode || 500, {
        error: normalized.message,
        code: normalized.code || '',
        requiresSteamLogin: !!normalized.requiresSteamLogin,
        requiresSteamGuard: !!normalized.requiresSteamGuard,
      });
    }
  }

  async function handleSteamQrLoginStatus(req, res) {
    const id = new URL(req.url, 'http://x').searchParams.get('id');
    const session = getQrSession(id);
    if (!session) return jsonRes(res, 404, { error: '扫码登录会话不存在或已过期' });
    jsonRes(res, 200, session);
  }

  async function handleSteamQrLoginCancel(req, res) {
    let id = new URL(req.url, 'http://x').searchParams.get('id') || '';
    if (!id) {
      try { id = String(JSON.parse(await readBody(req)).id || ''); } catch {}
    }
    const ok = cancelQrSession(id);
    jsonRes(res, ok ? 200 : 404, ok ? { success: true } : { error: '扫码登录会话不存在或已过期' });
  }

  async function handleSteamLogout(_req, res) {
    stopQueryBridge('Steam account logged out');
    credentials.username = '';
    credentials.password = '';
    credentials.steamGuardCode = '';
    credentials.isPersistent = false;
    credentials.pendingPersistentUsername = '';
    setOwnership({ username: '', status: 'unknown', checkedAt: 0, error: '' });
    const settings = getSettings();
    settings.steamUsername = '';
    settings.steamIsPersistent = false;
    settings.authBackend = '';
    saveSettings();
    clearAuth();
    logger.log('[Steam Logout] Credentials cleared');
    jsonRes(res, 200, { success: true, message: '已退出登录' });
  }

  async function handleSteamStatus(_req, res) {
    const pendingUser = String(credentials.pendingPersistentUsername || '').trim();
    const isLoggedIn = !!(credentials.username && (credentials.password || credentials.isPersistent));
    const pendingCanBeTreatedAsLogin = !!pendingUser && ['idle', 'checking', 'installing', 'validating-login'].includes(String(getRuntimeSetupStatus() || ''));
    const displayUser = isLoggedIn ? credentials.username : (pendingCanBeTreatedAsLogin ? pendingUser : '');
    const ownership = getOwnership();
    jsonRes(res, 200, {
      loggedIn: isLoggedIn || pendingCanBeTreatedAsLogin,
      username: displayUser || null,
      isPersistent: credentials.isPersistent || false,
      pendingValidation: !!pendingUser,
      pendingUsername: pendingUser,
      wallpaperEngineAccess: displayUser && ownership.username === displayUser ? ownership.status : 'unknown',
      backend: effectiveDownloaderMode(),
      requestedBackend: getDownloaderMode(),
    });
  }

  return {
    handleSteamQrLoginStart,
    handleSteamQrLoginStatus,
    handleSteamQrLoginCancel,
    handleSteamPasswordLoginStart,
    handleSteamPasswordLoginStatus,
    handleSteamLogin,
    handleSteamLogout,
    handleSteamStatus,
  };
}

module.exports = { createSteamSessionHandlers };
