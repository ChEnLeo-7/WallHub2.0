'use strict';

function createLoginSessionState(options) {
  const fs = options.fs;
  const sanitizeQrOutput = options.sanitizeQrOutput;
  const sessions = new Map();

  function snapshot(session) {
    const result = {
      id: session.id,
      status: session.status,
      username: session.username || '',
      message: session.message || '',
      error: session.error || '',
      updatedAt: session.updatedAt || Date.now(),
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

  return {
    sessions,
    snapshot,
    finish,
  };
}

module.exports = {
  createLoginSessionState,
};
