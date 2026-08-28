'use strict';

function createRememberedSessionValidation(options = {}) {
  const verify = options.verify;
  const isCurrent = options.isCurrent;
  if (typeof verify !== 'function') throw new Error('Remembered Steam session verifier missing');

  let active = null;

  function validate(username) {
    const user = String(username || '').trim();
    if (!user) return Promise.reject(new Error('cached username is empty'));
    if (active && active.username === user) return active.promise;

    const entry = { username: user, promise: null };
    entry.promise = (async () => {
      await verify(user);
      if (typeof isCurrent === 'function' && !isCurrent(user)) {
        const error = new Error('Steam account changed during remembered-session validation');
        error.code = 'STEAM_SESSION_CHANGED';
        throw error;
      }
      return true;
    })().finally(() => {
      if (active === entry) active = null;
    });
    active = entry;
    return entry.promise;
  }

  return { validate };
}

module.exports = { createRememberedSessionValidation };
