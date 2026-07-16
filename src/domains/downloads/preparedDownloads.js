'use strict';

const fs = require('fs');

function createPreparedDownloadStore(options = {}) {
  const entries = new Map();
  const ttlMs = Math.max(60000, options.ttlMs || 10 * 60 * 1000);
  const now = typeof options.now === 'function' ? options.now : () => Date.now();
  const setTimer = typeof options.setTimeoutFn === 'function' ? options.setTimeoutFn : setTimeout;
  const clearTimer = typeof options.clearTimeoutFn === 'function' ? options.clearTimeoutFn : clearTimeout;
  let cleanupTimer = null;

  function scheduleCleanup() {
    if (cleanupTimer) {
      clearTimer(cleanupTimer);
      cleanupTimer = null;
    }
    let nextExpiry = 0;
    for (const entry of entries.values()) {
      const expiresAt = Number(entry && entry.expiresAt || 0);
      if (!expiresAt || (nextExpiry && expiresAt >= nextExpiry)) continue;
      nextExpiry = expiresAt;
    }
    if (!nextExpiry) return;
    cleanupTimer = setTimer(() => {
      cleanupTimer = null;
      cleanup();
    }, Math.max(1000, nextExpiry - now()));
    cleanupTimer?.unref?.();
  }

  function cleanup() {
    const current = now();
    for (const [token, entry] of entries) {
      if (!entry || entry.expiresAt > current) continue;
      entries.delete(token);
      if (entry.deleteAfterSend && entry.filePath) {
        try { fs.rmSync(entry.filePath, { force: true }); } catch {}
      }
    }
    scheduleCleanup();
  }

  function create(filePath, fileName, createOptions = {}) {
    cleanup();
    if (!filePath || !fs.existsSync(filePath)) throw new Error('Prepared download file not found');
    const token = `${now().toString(36)}-${Math.random().toString(36).slice(2, 12)}-${Math.random().toString(36).slice(2, 8)}`;
    entries.set(token, {
      filePath,
      fileName,
      deleteAfterSend: !!createOptions.deleteAfterSend,
      expiresAt: now() + Math.max(60000, createOptions.ttlMs || ttlMs)
    });
    scheduleCleanup();
    return token;
  }

  function consume(token) {
    cleanup();
    const key = String(token || '');
    const entry = entries.get(key);
    if (!entry || !entry.filePath || !fs.existsSync(entry.filePath)) {
      entries.delete(key);
      scheduleCleanup();
      return null;
    }
    scheduleCleanup();
    return entry;
  }

  function dispose() {
    if (cleanupTimer) clearTimer(cleanupTimer);
    cleanupTimer = null;
  }

  return {
    entries,
    cleanup,
    create,
    consume,
    dispose,
  };
}

module.exports = {
  createPreparedDownloadStore,
};
