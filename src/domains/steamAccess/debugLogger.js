'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_LOG_FILE = 'steam-access-debug.log';
const DEFAULT_MAX_BYTES = 5 * 1024 * 1024;

function formatLogValue(value) {
  if (value instanceof Error) return value.stack || value.message;
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function createSteamAccessDebugLogger(options = {}) {
  const baseLogger = options.logger || console;
  const enabled = typeof options.enabled === 'function' ? options.enabled : () => !!options.enabled;
  const configDir = options.configDir || process.cwd();
  const filePath = options.filePath || path.join(configDir, DEFAULT_LOG_FILE);
  const maxBytes = Math.max(256 * 1024, Number(options.maxBytes || process.env.WALLHUB_STEAM_ACCESS_DEBUG_LOG_MAX_BYTES || DEFAULT_MAX_BYTES));
  let writeChain = Promise.resolve();
  let truncateChain = Promise.resolve();

  function rotateIfNeeded() {
    truncateChain = truncateChain.then(async () => {
      try {
        const stat = await fs.promises.stat(filePath).catch(() => null);
        if (!stat || stat.size <= maxBytes) return;
        const rotatedPath = `${filePath}.1`;
        await fs.promises.rm(rotatedPath, { force: true }).catch(() => {});
        await fs.promises.rename(filePath, rotatedPath).catch(() => {});
      } catch {}
    });
    return truncateChain;
  }

  function append(level, args) {
    if (!enabled()) return;
    const line = `[${new Date().toISOString()}] [${String(level || 'log').toUpperCase()}] ${args.map(formatLogValue).join(' ')}\n`;
    writeChain = writeChain.then(async () => {
      await rotateIfNeeded();
      await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
      await fs.promises.appendFile(filePath, line, 'utf8');
    }).catch(() => {});
  }

  function log(...args) {
    baseLogger.log?.(...args);
    append('log', args);
  }

  function warn(...args) {
    baseLogger.warn?.(...args);
    append('warn', args);
  }

  function error(...args) {
    baseLogger.error?.(...args);
    append('error', args);
  }

  function network(...args) {
    append('net', args);
  }

  async function flush() {
    await writeChain;
    await truncateChain;
  }

  return {
    log,
    warn,
    error,
    network,
    flush,
    enabled,
    filePath,
    snapshot: () => ({ enabled: !!enabled(), filePath, maxBytes }),
  };
}

module.exports = {
  DEFAULT_LOG_FILE,
  createSteamAccessDebugLogger,
  formatLogValue,
};
