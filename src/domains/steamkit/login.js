'use strict';

const fs = require('fs');

const { createLoginErrorNormalizer } = require('./login/errorHelpers');
const { createOwnershipCheck } = require('./login/ownershipCheck');
const { createPasswordSession } = require('./login/passwordSession');
const { createQrCodec } = require('./login/qrCodec');
const { createQrSession } = require('./login/qrSession');
const { createLoginSessionState } = require('./login/sessionState');
const { createWebSession } = require('./login/webSession');

function createSteamKitLoginService(options = {}) {
  const ensureDepotDownloaderReady = options.ensureDepotDownloaderReady;
  const ensureDir = options.ensureDir;
  const depotCommandFor = options.depotCommandFor;
  const runProcess = options.runProcess;
  const buildDepotDotnetEnv = options.buildDepotDotnetEnv;
  const makeDepotLoginId = options.makeDepotLoginId;
  const isDepotLoginVerifiedDespiteCanceled = options.isDepotLoginVerifiedDespiteCanceled;
  const setValidatedPersistentLogin = options.setValidatedPersistentLogin;
  const effectiveDownloaderMode = options.effectiveDownloaderMode;
  const configDir = options.configDir;
  const logger = options.logger || console;

  const normalizeSteamKitLoginError = createLoginErrorNormalizer(options.normalizeDepotError);
  const qrCodec = createQrCodec({
    getQrCodeModule: options.getQrCodeModule,
    getJsQrModule: options.getJsQrModule,
    logger,
  });
  const sessionState = createLoginSessionState({
    fs,
    sanitizeQrOutput: qrCodec.sanitizeQrOutput,
  });
  const sharedSessionOptions = {
    sessions: sessionState.sessions,
    snapshot: sessionState.snapshot,
    finish: sessionState.finish,
    ensureDepotDownloaderReady,
    ensureDir,
    depotCommandFor,
    runProcess,
    buildDepotDotnetEnv,
    makeDepotLoginId,
    isDepotLoginVerifiedDespiteCanceled,
    setValidatedPersistentLogin,
    normalizeSteamKitLoginError,
    configDir,
    logger,
  };
  const passwordSession = createPasswordSession(sharedSessionOptions);
  const qrSession = createQrSession({
    ...sharedSessionOptions,
    effectiveDownloaderMode,
    sanitizeQrOutput: qrCodec.sanitizeQrOutput,
    parseQrUsername: qrCodec.parseQrUsername,
    refreshQrImage: qrCodec.refreshQrImage,
  });
  const checkAppOwnership = createOwnershipCheck({
    ensureDepotDownloaderReady,
    depotCommandFor,
    runProcess,
    buildDepotDotnetEnv,
    makeDepotLoginId,
    isDepotLoginVerifiedDespiteCanceled,
    normalizeSteamKitLoginError,
    configDir,
    logger,
  });
  const webSession = createWebSession({
    ensureDepotDownloaderReady,
    ensureDir,
    depotCommandFor,
    runProcess,
    buildDepotDotnetEnv,
    makeDepotLoginId,
    configDir,
    logger,
  });

  function getPasswordSession(id) {
    const session = sessionState.sessions.get(String(id || ''));
    if (!session || session.kind !== 'password') return null;
    return sessionState.snapshot(session);
  }

  function clearDepotDownloaderAuth() {
    webSession.clearWebSessionCache();
    try {
      if (fs.existsSync(configDir)) {
        fs.rmSync(configDir, { recursive: true, force: true });
      }
    } catch (error) {
      logger.warn('[SteamKit Logout] Failed to clear DepotDownloader auth:', error.message);
    }
  }

  return {
    sessions: sessionState.sessions,
    sanitizeQrOutput: qrCodec.sanitizeQrOutput,
    extractQrAsciiLines: qrCodec.extractQrAsciiLines,
    asciiQrToMatrix: qrCodec.asciiQrToMatrix,
    asciiQrToSvgDataUrl: qrCodec.asciiQrToSvgDataUrl,
    decodeAsciiQrChallengeUrl: qrCodec.decodeAsciiQrChallengeUrl,
    refreshQrImage: qrCodec.refreshQrImage,
    parseQrUsername: qrCodec.parseQrUsername,
    snapshot: sessionState.snapshot,
    normalizeSteamCommunityCookie: webSession.normalizeSteamCommunityCookie,
    parseWebSessionCookieOutput: webSession.parseWebSessionCookieOutput,
    clearWebSessionCache: webSession.clearWebSessionCache,
    verifyLogin: passwordSession.verifyLogin,
    startPasswordSession: passwordSession.startPasswordSession,
    verifyRememberedSession: passwordSession.verifyRememberedSession,
    checkAppOwnership,
    getWebSessionCookie: webSession.getWebSessionCookie,
    startQrSession: qrSession.startQrSession,
    getQrSession: qrSession.getQrSession,
    getPasswordSession,
    cancelQrSession: qrSession.cancelQrSession,
    clearDepotDownloaderAuth,
  };
}

module.exports = {
  createSteamKitLoginService,
};
