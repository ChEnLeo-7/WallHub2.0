'use strict';

const WEB_SESSION_MARKER = 'WALLHUB_STEAM_WEB_SESSION:';

function createWebSession(options) {
  const debugLogger = options.debugLogger || options.logger;
  const webSessionCache = { username: '', cookie: '', expiresAt: 0, pending: null, pendingUsername: '' };
  const webSessionTtlMs = Math.max(60000, parseInt(process.env.WALLHUB_STEAMKIT_WEB_SESSION_TTL_MS || '600000', 10) || 600000);

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
      const executable = await options.ensureDepotDownloaderReady();
      options.ensureDir(options.configDir);
      const { command, argsPrefix } = options.depotCommandFor(executable);
      const args = [
        ...argsPrefix,
        '-wallhub-web-session',
        '-username', user,
        '-remember-password',
        '-max-downloads', '1',
        '-loginid', options.makeDepotLoginId(`web:${user}`),
      ];
      if (process.env.DEPOTDOWNLOADER_DEBUG === '1') args.push('-debug');
      const timeout = Math.max(15000, parseInt(process.env.WALLHUB_STEAMKIT_WEB_SESSION_TIMEOUT || '60000', 10) || 60000);
      debugLogger.log(`[SteamKit Web] Generating Steam community web session for: ${user}`);
      const result = await options.runProcess(command, args, timeout, {
        cwd: options.configDir,
        closeStdin: true,
        env: options.buildDepotDotnetEnv(),
        steamAuth: true,
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
      debugLogger.log(`[SteamKit Web] Steam community web session ready for: ${user}`);
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

  return {
    normalizeSteamCommunityCookie,
    parseWebSessionCookieOutput,
    clearWebSessionCache,
    getWebSessionCookie,
  };
}

module.exports = {
  createWebSession,
};
