'use strict';

// Centralized runtime tuning constants. These used to be scattered as inline
// `parseInt(process.env.X || ...)` expressions in server.js. Co-locating them
// makes the knobs discoverable and the defaults easy to audit.

const { parsePositiveInt } = require('../shared/number');

const MB = 1024 * 1024;

function parseEnvInt(name, fallback) {
  return parsePositiveInt(process.env[name], fallback);
}

function parseEnvFloat(name, fallback) {
  const parsed = Number.parseFloat(String(process.env[name] || '').trim());
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseEnvBool(name, fallback) {
  const value = String(process.env[name] || '').trim();
  if (!value) return fallback;
  return /^(?:1|true|yes|on)$/i.test(value);
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

const URL_PROXY_CACHE = {
  maxBytes: Math.max(16 * MB, parseEnvInt('WALLHUB_URL_PROXY_CACHE_MAX_BYTES', 256 * MB)),
  entryMaxBytes: Math.max(256 * 1024, parseEnvInt('WALLHUB_URL_PROXY_CACHE_ENTRY_MAX_BYTES', 24 * MB)),
  ttlMs: Math.max(60 * 1000, parseEnvInt('WALLHUB_URL_PROXY_CACHE_TTL_MS', 7 * 24 * 60 * 60 * 1000)),
  version: 3,
};

const DEPOT_STREAM = {
  // Extents stay large enough for Steam chunk concurrency without making the
  // browser wait on a 32 MiB disk round trip before every uncached response.
  maxRangeBytes: Math.max(256 * 1024, parseEnvInt('WALLHUB_DEPOT_STREAM_MAX_RANGE_BYTES', 16 * MB)),
  firstRangeBytes: Math.max(256 * 1024, parseEnvInt('WALLHUB_DEPOT_STREAM_FIRST_RANGE_BYTES', 2 * MB)),
  tailBytes: Math.max(512 * 1024, parseEnvInt('WALLHUB_DEPOT_STREAM_TAIL_BYTES', 8 * MB)),
  initialBufferBytes: Math.max(1024 * 1024, parseEnvInt('WALLHUB_DEPOT_STREAM_INITIAL_BUFFER_BYTES', 16 * MB)),
  aheadBytes: Math.max(0, parseEnvInt('WALLHUB_DEPOT_STREAM_AHEAD_BYTES', 256 * MB)),
  chunkBufferBytes: clamp(parseEnvInt('WALLHUB_DEPOT_STREAM_CHUNK_BUFFER_BYTES', 64 * MB), 8 * MB, 512 * MB),
  readThrough: parseEnvBool('WALLHUB_DEPOT_STREAM_READ_THROUGH', true),
  readWindowBytes: Math.max(64 * 1024, parseEnvInt('WALLHUB_DEPOT_STREAM_READ_WINDOW_BYTES', 512 * 1024)),
  readyTimeoutMs: Math.max(1000, parseEnvInt('WALLHUB_DEPOT_STREAM_READY_TIMEOUT_MS', 12000)),
  workerIdleMs: Math.max(30000, parseEnvInt('WALLHUB_DEPOT_STREAM_WORKER_IDLE_MS', 10 * 60 * 1000)),
  cleanupHighWatermark: clamp(parseEnvFloat('WALLHUB_DEPOT_STREAM_CACHE_HIGH_WATERMARK', 0.85), 0.5, 0.98),
  cleanupTarget: clamp(parseEnvFloat('WALLHUB_DEPOT_STREAM_CACHE_TARGET_WATERMARK', 0.7), 0.35, 0.9),
  cleanupDebounceMs: Math.max(1000, parseEnvInt('WALLHUB_DEPOT_STREAM_CACHE_CLEANUP_DEBOUNCE_MS', 45000)),
};

const PROXY = {
  // Limit how fast the download progress UI can report (env in MB/s).
  maxDisplaySpeedBytes: (() => {
    const mbps = Number.parseFloat(String(process.env.WALLHUB_MAX_DISPLAY_SPEED_MBPS || '512'));
    if (!Number.isFinite(mbps) || mbps <= 0) return Number.POSITIVE_INFINITY;
    return mbps * MB;
  })(),
};

const STEAM_CDN_RECENT_LIMIT = 8;

module.exports = {
  MB,
  URL_PROXY_CACHE,
  DEPOT_STREAM,
  PROXY,
  STEAM_CDN_RECENT_LIMIT,
};
