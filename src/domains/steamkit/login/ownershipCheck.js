'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

function createOwnershipCheck(options) {
  return async function checkAppOwnership(username, appId = 431960) {
    const user = String(username || '').trim();
    const targetAppId = Math.max(1, parseInt(appId, 10) || 431960);
    if (!user) {
      const error = new Error('Steam 账号尚未登录');
      error.code = 'STEAM_LOGIN_REQUIRED';
      error.requiresSteamLogin = true;
      throw error;
    }
    const executable = await options.ensureDepotDownloaderReady();
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-steamkit-ownership-'));
    try {
      const { command, argsPrefix } = options.depotCommandFor(executable);
      const args = [
        ...argsPrefix,
        '-app', String(targetAppId),
        '-manifest-only',
        '-dir', tempRoot,
        '-username', user,
        '-remember-password',
        '-max-downloads', '1',
        '-loginid', options.makeDepotLoginId(`ownership:${user}:${targetAppId}`),
      ];
      const timeout = Math.max(30000, parseInt(process.env.WALLHUB_STEAMKIT_LOGIN_TIMEOUT || '120000', 10) || 120000);
      options.logger.log(`[SteamKit Ownership] Checking app ${targetAppId} access for: ${user}`);
      await options.runProcess(command, args, timeout, {
        cwd: options.configDir,
        closeStdin: true,
        env: options.buildDepotDotnetEnv(),
        steamAuth: true,
      });
      return { status: 'owned', appId: targetAppId };
    } catch (error) {
      const message = String(error && error.message || error || '');
      if (options.isDepotLoginVerifiedDespiteCanceled(message)) return { status: 'owned', appId: targetAppId };
      if (/not available from this account|requires.*(?:license|subscription)|no subscription|license.*missing/i.test(message)) {
        return { status: 'not-owned', appId: targetAppId };
      }
      throw options.normalizeSteamKitLoginError(error);
    } finally {
      try { fs.rmSync(tempRoot, { recursive: true, force: true }); } catch {}
    }
  };
}

module.exports = {
  createOwnershipCheck,
};
