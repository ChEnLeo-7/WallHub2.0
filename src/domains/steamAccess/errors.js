'use strict';

function createSteamAccessError(message, meta = {}) {
  const error = new Error(message || 'Steam access request failed');
  return Object.assign(error, {
    stage: meta.stage || 'request',
    host: meta.host || '',
    ip: meta.ip || '',
    family: meta.family || 0,
    sniStrategy: meta.sniStrategy || '',
    protocol: meta.protocol || 'h1',
    elapsedMs: meta.elapsedMs || 0,
  });
}

module.exports = { createSteamAccessError };
