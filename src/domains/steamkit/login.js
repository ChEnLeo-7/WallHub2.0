'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function createSteamKitLoginService(options = {}) {
  const sessions = new Map();
  const ensureDepotDownloaderReady = options.ensureDepotDownloaderReady;
  const ensureDir = options.ensureDir;
  const depotCommandFor = options.depotCommandFor;
  const runProcess = options.runProcess;
  const buildDepotDotnetEnv = options.buildDepotDotnetEnv;
  const makeDepotLoginId = options.makeDepotLoginId;
  const normalizeDepotError = options.normalizeDepotError;
  const isDepotLoginVerifiedDespiteCanceled = options.isDepotLoginVerifiedDespiteCanceled;
  const setValidatedPersistentLogin = options.setValidatedPersistentLogin;
  const getQrCodeModule = options.getQrCodeModule;
  const getJsQrModule = options.getJsQrModule;
  const effectiveDownloaderMode = options.effectiveDownloaderMode;
  const configDir = options.configDir;
  const logger = options.logger || console;
  const webSessionCache = { username: '', cookie: '', expiresAt: 0, pending: null, pendingUsername: '' };
  const webSessionTtlMs = Math.max(60000, parseInt(process.env.WALLHUB_STEAMKIT_WEB_SESSION_TTL_MS || '600000', 10) || 600000);
  const WEB_SESSION_MARKER = 'WALLHUB_STEAM_WEB_SESSION:';

  function sanitizeQrOutput(text) {
    return String(text || '')
      .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
      .split(/\r?\n/)
      .filter(line => !/RefreshToken|AccessToken|LoginTokens|account\.config/i.test(line))
      .join('\n')
      .slice(-14000);
  }

  function extractQrAsciiLines(text) {
    const source = sanitizeQrOutput(text || '');
    const markerMatches = Array.from(source.matchAll(/Use the Steam Mobile App to sign in with this QR code:|The QR code has changed:/gi));
    if (!markerMatches.length) return [];
    const start = markerMatches[markerMatches.length - 1].index + markerMatches[markerMatches.length - 1][0].length;
    const lines = source.slice(start).split(/\r?\n/);
    const qrLines = [];
    let started = false;
    for (const line of lines) {
      const raw = String(line || '').replace(/\r/g, '');
      const trimmed = raw.trim();
      if (!trimmed) {
        if (started && qrLines.length > 10) break;
        continue;
      }
      const hasText = /[A-Za-z0-9:;,.!?'"`/\\()[\]{}<>]/.test(trimmed);
      const nonSpace = raw.replace(/\s/g, '').length;
      const looksLikeQr = raw.length >= 20 && nonSpace >= 6 && !hasText;
      if (!looksLikeQr) {
        if (started && qrLines.length > 10) break;
        continue;
      }
      started = true;
      qrLines.push(raw);
    }
    return qrLines;
  }

  function asciiQrToMatrix(text) {
    const lines = extractQrAsciiLines(text);
    if (lines.length < 10) return null;

    const gcd = (a, b) => {
      a = Math.abs(a); b = Math.abs(b);
      while (b) [a, b] = [b, a % b];
      return a || 0;
    };
    let darkTokenWidth = 0;
    for (const line of lines) {
      const runs = String(line || '').match(/\S+/g) || [];
      for (const run of runs) {
        darkTokenWidth = gcd(darkTokenWidth, Array.from(run).length);
      }
    }
    if (!darkTokenWidth || darkTokenWidth > 8) darkTokenWidth = 2;

    const decodeLine = (line) => {
      const chars = Array.from(String(line || '').replace(/\r/g, ''));
      const row = [];
      for (let i = 0; i < chars.length;) {
        const current = chars[i] || '';
        if (/\s/.test(current)) {
          let j = i;
          while (j < chars.length && /\s/.test(chars[j] || '')) j += 1;
          const modules = Math.max(1, Math.round((j - i) / 2));
          for (let k = 0; k < modules; k++) row.push(false);
          i = j;
          continue;
        }
        let j = i;
        while (j < chars.length && !/\s/.test(chars[j] || '')) j += 1;
        const modules = Math.max(1, Math.round((j - i) / darkTokenWidth));
        for (let k = 0; k < modules; k++) row.push(true);
        i = j;
      }
      return row;
    };

    const rows = lines.map(decodeLine);
    const maxWidth = Math.max(...rows.map(row => row.length));
    for (const row of rows) {
      while (row.length < maxWidth) row.push(false);
    }

    while (rows.length && rows[0].every(v => !v)) rows.shift();
    while (rows.length && rows[rows.length - 1].every(v => !v)) rows.pop();
    if (!rows.length) return null;

    let left = Infinity;
    let right = -1;
    for (const row of rows) {
      for (let i = 0; i < row.length; i++) {
        if (!row[i]) continue;
        left = Math.min(left, i);
        right = Math.max(right, i);
      }
    }
    if (!Number.isFinite(left) || right < left) return null;
    return rows.map(row => row.slice(left, right + 1));
  }

  function asciiQrToSvgDataUrl(text) {
    const trimmedRows = asciiQrToMatrix(text);
    if (!trimmedRows || trimmedRows.length < 10) return '';
    const quiet = 4;
    const width = Math.max(...trimmedRows.map(row => row.length)) + quiet * 2;
    const height = trimmedRows.length + quiet * 2;
    const rects = [];
    for (let y = 0; y < trimmedRows.length; y++) {
      for (let x = 0; x < trimmedRows[y].length; x++) {
        if (trimmedRows[y][x]) rects.push(`<rect x="${x + quiet}" y="${y + quiet}" width="1" height="1"/>`);
      }
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><g fill="#000">${rects.join('')}</g></svg>`;
    return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`;
  }

  function decodeAsciiQrChallengeUrl(text) {
    const matrix = asciiQrToMatrix(text);
    if (!matrix || matrix.length < 10) return '';
    const moduleSize = 8;
    const quiet = 4;
    const modulesW = Math.max(...matrix.map(row => row.length));
    const modulesH = matrix.length;
    const width = (modulesW + quiet * 2) * moduleSize;
    const height = (modulesH + quiet * 2) * moduleSize;
    const data = new Uint8ClampedArray(width * height * 4);
    data.fill(255);
    for (let y = 0; y < modulesH; y++) {
      const row = matrix[y] || [];
      for (let x = 0; x < modulesW; x++) {
        if (!row[x]) continue;
        const startX = (x + quiet) * moduleSize;
        const startY = (y + quiet) * moduleSize;
        for (let py = 0; py < moduleSize; py++) {
          for (let px = 0; px < moduleSize; px++) {
            const idx = ((startY + py) * width + startX + px) * 4;
            data[idx] = 0;
            data[idx + 1] = 0;
            data[idx + 2] = 0;
            data[idx + 3] = 255;
          }
        }
      }
    }
    for (let i = 3; i < data.length; i += 4) data[i] = 255;
    try {
      const jsQR = getJsQrModule();
      const decoded = jsQR(data, width, height, { inversionAttempts: 'dontInvert' });
      return decoded && decoded.data ? String(decoded.data) : '';
    } catch {
      return '';
    }
  }

  async function refreshQrImage(session) {
    if (!session || session.qrImageKind === 'standard') return;
    const challengeUrl = decodeAsciiQrChallengeUrl(session.output || '');
    if (challengeUrl) {
      session.qrChallengeUrl = challengeUrl;
      try {
        const QRCode = getQrCodeModule();
        session.qrImage = await QRCode.toDataURL(challengeUrl, {
          errorCorrectionLevel: 'M',
          margin: 2,
          width: 180,
          color: { dark: '#000000', light: '#ffffff' }
        });
        session.qrImageKind = 'standard';
        session.updatedAt = Date.now();
        return;
      } catch (error) {
        logger.warn('[SteamKit QR] Failed to render QR challenge URL:', error.message);
      }
    }
    const fallback = process.env.WALLHUB_QR_ASCII_FALLBACK === '1' ? asciiQrToSvgDataUrl(session.output || '') : '';
    if (fallback) {
      session.qrImage = fallback;
      session.qrImageKind = 'fallback';
      session.updatedAt = Date.now();
    }
  }

  function parseQrUsername(text) {
    const source = String(text || '');
    const match = source.match(/Next time you can login with -username\s+([^\s]+)\s+-remember-password/i) ||
      source.match(/Logging\s+['"]([^'"]+)['"]\s+into Steam3/i);
    return match ? String(match[1] || '').trim() : '';
  }

  function snapshot(session) {
    const result = {
      id: session.id,
      status: session.status,
      username: session.username || '',
      message: session.message || '',
      error: session.error || '',
      updatedAt: session.updatedAt || Date.now()
    };
    if (session.kind === 'qr') {
      result.output = sanitizeQrOutput(session.output || '');
      result.qrImage = session.qrImage || '';
      result.qrChallengeUrl = session.qrChallengeUrl || '';
    }
    if (session.requiresPhoneConfirmation) result.requiresPhoneConfirmation = true;
    if (session.needsSteamGuard) result.needsSteamGuard = true;
    if (session.code) result.code = session.code;
    return result;
  }

  function normalizeSteamCommunityCookie(cookie) {
    return String(cookie || '')
      .split(';')
      .map(part => part.trim())
      .filter(Boolean)
      .filter(part => /^(steamLoginSecure|sessionid|clientsessionid)=/i.test(part))
      .join('; ');
  }

  function parseWebSessionCookieOutput(text) {
    const source = String(text || '');
    const markerIndex = source.lastIndexOf(WEB_SESSION_MARKER);
    if (markerIndex < 0) return '';
    const line = source.slice(markerIndex + WEB_SESSION_MARKER.length).split(/\r?\n/)[0].trim();
    if (!line) return '';
    try {
      const parsed = JSON.parse(line);
      const fromCookie = normalizeSteamCommunityCookie(parsed && parsed.cookie);
      if (fromCookie) return fromCookie;
      const fromArray = Array.isArray(parsed && parsed.cookies)
        ? normalizeSteamCommunityCookie(parsed.cookies.join('; '))
        : '';
      return fromArray;
    } catch {
      return '';
    }
  }

  function clearWebSessionCache() {
    webSessionCache.username = '';
    webSessionCache.cookie = '';
    webSessionCache.expiresAt = 0;
    webSessionCache.pending = null;
    webSessionCache.pendingUsername = '';
  }

  function normalizeSteamKitLoginError(error) {
    const err = normalizeDepotError(error);
    if (err && ['STEAM_NETWORK_UNREACHABLE', 'STEAM_LOGIN_TIMEOUT'].includes(err.code)) {
      const hint = 'Wallhub 内置连接增强只作用于 Wallhub 网页代理和服务端 HTTP 请求；SteamKit 登录/扫码仍需要本机网络或 HTTP(S) 代理能直连 Steam 登录服务。';
      if (!String(err.message || '').includes('Wallhub 内置连接增强')) {
        err.message = `${err.message || 'Steam 登录网络请求失败'}（${hint}）`;
      }
    }
    return err;
  }

  function finish(session, patch) {
    if (!session || session.done) return;
    Object.assign(session, patch || {}, { done: true, updatedAt: Date.now() });
    if (session.cleanupTimer) clearTimeout(session.cleanupTimer);
    session.cleanupTimer = setTimeout(() => {
      const current = sessions.get(session.id);
      if (current === session) sessions.delete(session.id);
      if (session.tempRoot) {
        try { fs.rmSync(session.tempRoot, { recursive: true, force: true }); } catch {}
      }
    }, 5 * 60 * 1000);
    session.cleanupTimer.unref?.();
  }

  function buildValidationArgs(executable, username, password, steamGuardCode, tempRoot, loginIdSeed) {
    const { argsPrefix } = depotCommandFor(executable);
    const loginAppId = parseInt(process.env.WALLHUB_STEAMKIT_LOGIN_APPID || '431960', 10) || 431960;
    const args = [
      ...argsPrefix,
      '-app', String(loginAppId),
      '-manifest-only',
      '-dir', tempRoot,
      '-username', username,
      '-password', password,
      '-remember-password',
      '-max-downloads', '1',
      '-loginid', makeDepotLoginId(loginIdSeed || `login:${username}`),
    ];
    if (steamGuardCode) args.push('-no-mobile');
    if (process.env.DEPOTDOWNLOADER_DEBUG === '1') args.push('-debug');
    return { args, inputLines: steamGuardCode ? [steamGuardCode] : [] };
  }

  async function verifyLogin(username, password, steamGuardCode, progress = {}) {
    const reportProgress = typeof progress.onProgress === 'function' ? progress.onProgress : () => {};
    const reportOutput = typeof progress.onOutput === 'function' ? progress.onOutput : () => {};
    reportProgress({ status: 'starting', message: '正在准备 Steam 登录组件' });
    const executable = await ensureDepotDownloaderReady();
    ensureDir(configDir);
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-steamkit-login-'));
    try {
      const { command } = depotCommandFor(executable);
      const built = buildValidationArgs(executable, username, password, steamGuardCode, tempRoot, `login:${username}`);
      const timeout = Math.max(30000, parseInt(process.env.WALLHUB_STEAMKIT_LOGIN_TIMEOUT || '120000', 10) || 120000);
      logger.log(`[SteamKit Login] Verifying Steam account via DepotDownloader: ${username}`);
      reportProgress({ status: 'validating', message: '正在向 Steam 验证账号' });
      await runProcess(command, built.args, timeout, {
        cwd: configDir,
        inputLines: built.inputLines,
        closeStdin: true,
        env: buildDepotDotnetEnv(),
        steamAuth: true,
        onStdout: reportOutput,
        onStderr: reportOutput,
      });
      logger.log(`[SteamKit Login] DepotDownloader session persisted for: ${username}`);
      logger.log('[SteamKit Login] Remembered session is managed by DepotDownloader/.NET isolated storage.');
      reportProgress({ status: 'success', message: 'Steam 登录验证完成，正在保存本地会话' });
    } catch (error) {
      if (isDepotLoginVerifiedDespiteCanceled(error && error.message || error)) {
        logger.warn('[SteamKit Login] DepotDownloader canceled after successful Steam3 login; treating account verification as successful.');
        return;
      }
      throw normalizeSteamKitLoginError(error);
    } finally {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    }
  }

  function passwordLoginNeedsPhoneConfirmation(output) {
    const text = String(output || '');
    return /(?:steam\s*(?:mobile|guard).*?(?:confirm|approval|approve)|(?:confirm|approval|approve).*?steam\s*(?:mobile|app|guard)|(?:check|open|view).*?steam\s*(?:mobile|app)|手机.*(?:确认|批准|放行)|(?:确认|批准|放行).*?手机)/i.test(text);
  }

  function startPasswordSession(username, password, steamGuardCode = '') {
    const user = String(username || '').trim();
    const secret = String(password || '').trim();
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
    sessions.set(id, session);

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
      setValidatedPersistentLogin(user, 'steamkit');
      finish(session, {
        status: 'success',
        message: 'Steam 登录成功，会话已持久化',
        error: '',
        code: '',
        requiresPhoneConfirmation: false,
      });
    }).catch((error) => {
      const normalized = normalizeSteamKitLoginError(error);
      const needsSteamGuard = normalized.code === 'STEAM_GUARD_REQUIRED' || !!normalized.requiresSteamGuard;
      finish(session, {
        status: needsSteamGuard ? 'needs-guard' : 'error',
        message: needsSteamGuard ? '需要 Steam Guard 验证码' : 'Steam 登录失败',
        error: normalized.message || String(error || 'Steam 登录失败'),
        code: normalized.code || '',
        needsSteamGuard,
      });
    });

    return snapshot(session);
  }

  async function verifyRememberedSession(username) {
    const user = String(username || '').trim();
    if (!user) throw new Error('cached username is empty');
    const executable = await ensureDepotDownloaderReady();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-steamkit-session-'));
    try {
      const { command, argsPrefix } = depotCommandFor(executable);
      const loginAppId = parseInt(process.env.WALLHUB_STEAMKIT_LOGIN_APPID || '431960', 10) || 431960;
      const args = [
        ...argsPrefix,
        '-app', String(loginAppId),
        '-manifest-only',
        '-dir', tempRoot,
        '-username', user,
        '-remember-password',
        '-max-downloads', '1',
        '-loginid', makeDepotLoginId(`session:${user}`),
      ];
      const timeout = Math.max(30000, parseInt(process.env.WALLHUB_STEAMKIT_LOGIN_TIMEOUT || '120000', 10) || 120000);
      logger.log(`[SteamKit Login] Validating remembered session via DepotDownloader: ${user}`);
      await runProcess(command, args, timeout, {
        cwd: configDir,
        closeStdin: true,
        env: buildDepotDotnetEnv(),
        steamAuth: true
      });
    } catch (error) {
      if (isDepotLoginVerifiedDespiteCanceled(error && error.message || error)) {
        logger.warn('[SteamKit Login] DepotDownloader canceled after validating remembered Steam3 login; keeping cached session.');
        return;
      }
      throw normalizeSteamKitLoginError(error);
    } finally {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    }
  }

  async function getWebSessionCookie(username) {
    const user = String(username || '').trim();
    if (!user) return '';
    const now = Date.now();
    if (webSessionCache.username === user && webSessionCache.cookie && webSessionCache.expiresAt > now) {
      return webSessionCache.cookie;
    }
    if (webSessionCache.pending && webSessionCache.pendingUsername === user) return webSessionCache.pending;

    webSessionCache.pendingUsername = user;
    const pending = (async () => {
      const executable = await ensureDepotDownloaderReady();
      ensureDir(configDir);
      const { command, argsPrefix } = depotCommandFor(executable);
      const args = [
        ...argsPrefix,
        '-wallhub-web-session',
        '-username', user,
        '-remember-password',
        '-max-downloads', '1',
        '-loginid', makeDepotLoginId(`web:${user}`),
      ];
      if (process.env.DEPOTDOWNLOADER_DEBUG === '1') args.push('-debug');
      const timeout = Math.max(15000, parseInt(process.env.WALLHUB_STEAMKIT_WEB_SESSION_TIMEOUT || '60000', 10) || 60000);
      logger.log(`[SteamKit Web] Generating Steam community web session for: ${user}`);
      const result = await runProcess(command, args, timeout, {
        cwd: configDir,
        closeStdin: true,
        env: buildDepotDotnetEnv(),
        steamAuth: true
      });
      const cookie = parseWebSessionCookieOutput(`${result && result.out || ''}\n${result && result.err || ''}`);
      if (!cookie) {
        const error = new Error('SteamKit did not return a Steam community web session cookie');
        error.code = 'STEAM_WEB_SESSION_UNAVAILABLE';
        error.requiresSteamLogin = true;
        throw error;
      }
      webSessionCache.username = user;
      webSessionCache.cookie = cookie;
      webSessionCache.expiresAt = Date.now() + webSessionTtlMs;
      logger.log(`[SteamKit Web] Steam community web session ready for: ${user}`);
      return cookie;
    })();
    const tracked = pending.finally(() => {
      if (webSessionCache.pending === tracked) {
        webSessionCache.pending = null;
        webSessionCache.pendingUsername = '';
      }
    });
    webSessionCache.pending = tracked;

    return webSessionCache.pending;
  }

  async function startQrSession() {
    if (effectiveDownloaderMode() !== 'steamkit') {
      const error = new Error('扫码登录仅支持 SteamKit / DepotDownloader 模式。');
      error.code = 'STEAMKIT_QR_UNSUPPORTED';
      error.statusCode = 400;
      throw error;
    }
    const executable = await ensureDepotDownloaderReady();
    ensureDir(configDir);
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-steamkit-qr-'));
    const { command, argsPrefix } = depotCommandFor(executable);
    const loginAppId = parseInt(process.env.WALLHUB_STEAMKIT_LOGIN_APPID || '431960', 10) || 431960;
    const id = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const session = {
      kind: 'qr',
      id,
      status: 'starting',
      output: '',
      username: '',
      message: '正在启动 Steam 扫码登录',
      error: '',
      tempRoot,
      done: false,
      updatedAt: Date.now(),
      cleanupTimer: null,
      processPromise: null
    };
    sessions.set(id, session);

    const args = [
      ...argsPrefix,
      '-app', String(loginAppId),
      '-manifest-only',
      '-dir', tempRoot,
      '-qr',
      '-remember-password',
      '-max-downloads', '1',
      '-loginid', makeDepotLoginId(`qr:${id}`)
    ];
    if (process.env.DEPOTDOWNLOADER_DEBUG === '1') args.push('-debug');

    const appendOutput = (chunk) => {
      const text = String(chunk || '');
      session.output = sanitizeQrOutput((session.output || '') + text);
      const parsedUser = parseQrUsername(session.output);
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
      refreshQrImage(session).catch(error => logger.warn('[SteamKit QR] QR image refresh failed:', error.message));
    };

    logger.log('[SteamKit QR] Starting DepotDownloader QR login session');
    const timeout = Math.max(60000, parseInt(process.env.WALLHUB_STEAMKIT_QR_TIMEOUT || '300000', 10) || 300000);
    const proc = runProcess(command, args, timeout, {
      cwd: configDir,
      closeStdin: true,
      env: buildDepotDotnetEnv(),
      steamAuth: true,
      onStdout: appendOutput,
      onStderr: appendOutput
    });
    session.processPromise = proc;
    proc.then(() => {
      const username = session.username || parseQrUsername(session.output) || 'Steam QR 用户';
      setValidatedPersistentLogin(username, 'steamkit');
      logger.log(`[SteamKit QR] Login succeeded: ${username}`);
      finish(session, {
        status: 'success',
        username,
        message: 'Steam 扫码登录成功，会话已持久化',
        error: ''
      });
    }).catch((error) => {
      const message = String((error && error.message) || error || '扫码登录失败');
      const parsedUser = session.username || parseQrUsername(`${session.output}\n${message}`);
      if (parsedUser && isDepotLoginVerifiedDespiteCanceled(`${session.output}\n${message}`)) {
        setValidatedPersistentLogin(parsedUser, 'steamkit');
        finish(session, {
          status: 'success',
          username: parsedUser,
          message: 'Steam 扫码登录成功，会话已持久化',
          error: ''
        });
        return;
      }
      const normalized = normalizeSteamKitLoginError(error);
      logger.warn('[SteamKit QR] Login failed:', message);
      finish(session, {
        status: 'error',
        message: 'Steam 扫码登录失败',
        error: normalized.message || message
      });
    }).finally(() => {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    });

    return snapshot(session);
  }

  function getQrSession(id) {
    const session = sessions.get(String(id || ''));
    if (!session || session.kind !== 'qr') return null;
    return snapshot(session);
  }

  function getPasswordSession(id) {
    const session = sessions.get(String(id || ''));
    if (!session || session.kind !== 'password') return null;
    return snapshot(session);
  }

  function cancelQrSession(id) {
    const session = sessions.get(String(id || ''));
    if (!session) return false;
    try {
      if (session.processPromise && session.processPromise.kill) session.processPromise.kill();
    } catch {}
    finish(session, {
      status: 'cancelled',
      message: '已取消扫码登录',
      error: ''
    });
    return true;
  }

  function clearDepotDownloaderAuth() {
    clearWebSessionCache();
    try {
      if (fs.existsSync(configDir)) {
        fs.rmSync(configDir, { recursive: true, force: true });
      }
    } catch (error) {
      logger.warn('[SteamKit Logout] Failed to clear DepotDownloader auth:', error.message);
    }
  }

  return {
    sessions,
    sanitizeQrOutput,
    extractQrAsciiLines,
    asciiQrToMatrix,
    asciiQrToSvgDataUrl,
    decodeAsciiQrChallengeUrl,
    refreshQrImage,
    parseQrUsername,
    snapshot,
    normalizeSteamCommunityCookie,
    parseWebSessionCookieOutput,
    clearWebSessionCache,
    verifyLogin,
    startPasswordSession,
    verifyRememberedSession,
    getWebSessionCookie,
    startQrSession,
    getQrSession,
    getPasswordSession,
    cancelQrSession,
    clearDepotDownloaderAuth,
  };
}

module.exports = {
  createSteamKitLoginService,
};
