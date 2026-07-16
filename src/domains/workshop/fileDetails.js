'use strict';

const { URL } = require('url');

function parsePositiveInt(value, fallback, min, max) {
  const n = parseInt(String(value || '').trim(), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

function createPublishedFileDetailsService(options = {}) {
  const post = options.post;
  const logger = options.logger || console;
  const getSteamWebApiBaseUrl = typeof options.getSteamWebApiBaseUrl === 'function'
    ? options.getSteamWebApiBaseUrl
    : () => 'https://api.steampowered.com';
  const getSteamApiKey = typeof options.getSteamApiKey === 'function'
    ? options.getSteamApiKey
    : () => '';
  if (typeof post !== 'function') {
    throw new Error('Published file details POST dependency missing');
  }

  const batchSize = parsePositiveInt(process.env.WALLHUB_FILEDETAILS_BATCH_SIZE, 50, 2, 50);
  const maxConcurrency = parsePositiveInt(process.env.WALLHUB_FILEDETAILS_CONCURRENCY, 3, 1, 6);
  const retryCount = parsePositiveInt(process.env.WALLHUB_FILEDETAILS_RETRIES, 1, 0, 3);
  const baseTimeoutMs = parsePositiveInt(process.env.WALLHUB_FILEDETAILS_TIMEOUT_MS, 18000, 5000, 45000);
  const singleTimeoutMs = parsePositiveInt(process.env.WALLHUB_FILEDETAILS_SINGLE_TIMEOUT_MS, 22000, 5000, 45000);
  const safeTotalBudgetMs = parsePositiveInt(process.env.WALLHUB_FILEDETAILS_SAFE_BUDGET_MS, 9000, 3000, 30000);
  const safeChunkTimeoutMs = parsePositiveInt(process.env.WALLHUB_FILEDETAILS_SAFE_CHUNK_TIMEOUT_MS, 6000, 2000, 15000);
  const safeRetryCount = parsePositiveInt(process.env.WALLHUB_FILEDETAILS_SAFE_RETRIES, 1, 1, 3) - 1;
  const failureCooldownMs = parsePositiveInt(process.env.WALLHUB_FILEDETAILS_FAILURE_COOLDOWN_MS, 90000, 10000, 600000);
  const detailCacheTtlMs = parsePositiveInt(process.env.WALLHUB_FILEDETAILS_CACHE_TTL_MS, 600000, 30000, 3600000);
  const detailCacheLimit = parsePositiveInt(process.env.WALLHUB_FILEDETAILS_CACHE_LIMIT, 2000, 100, 20000);

  const detailCache = new Map();
  let failureCooldownUntil = 0;
  let backgroundRefreshPromise = null;

  function now() {
    return Date.now();
  }

  function normalizeIds(ids) {
    return Array.from(new Set((ids || []).map(value => String(value).trim()).filter(Boolean)));
  }

  function cacheDetail(detail) {
    const id = String(detail && detail.publishedfileid || '').trim();
    if (!id) return;
    detailCache.set(id, { detail, expiresAt: now() + detailCacheTtlMs, updatedAt: now() });
    while (detailCache.size > detailCacheLimit) {
      const oldest = detailCache.keys().next().value;
      if (oldest === undefined) break;
      detailCache.delete(oldest);
    }
  }

  function cachedDetails(ids) {
    const out = [];
    const missing = [];
    const ts = now();
    for (const id of ids) {
      const entry = detailCache.get(id);
      if (entry && entry.expiresAt > ts) {
        out.push(entry.detail);
        continue;
      }
      if (entry) detailCache.delete(id);
      missing.push(id);
    }
    return { cached: out, missing };
  }

  function rememberSuccess(list) {
    for (const detail of list || []) cacheDetail(detail);
    if (Array.isArray(list) && list.length) failureCooldownUntil = 0;
  }

  function rememberFailure(reason) {
    failureCooldownUntil = now() + failureCooldownMs;
    logger.warn(`[FileDetails] API cooldown ${Math.round(failureCooldownMs / 1000)}s${reason ? `: ${reason}` : ''}`);
  }

  function throwIfAborted(signal) {
    if (signal && signal.aborted) throw Object.assign(new Error('Request aborted'), { code: 'ABORT_ERR' });
  }

  async function get(ids, timeoutMs, signal) {
    if (!ids.length) return [];
    throwIfAborted(signal);
    const parts = [`itemcount=${ids.length}`];
    const apiKey = String(getSteamApiKey() || '').trim();
    if (apiKey) parts.push(`key=${encodeURIComponent(apiKey)}`);
    ids.forEach((id, i) => parts.push(`publishedfileids%5B${i}%5D=${id}`));

    logger.log(`[FileDetails] POST for ${ids.length} ids: ${ids.slice(0, 3).join(',')}...`);

    const effectiveTimeout = timeoutMs || (ids.length <= 1 ? singleTimeoutMs : baseTimeoutMs);
    const baseUrl = String(getSteamWebApiBaseUrl() || 'https://api.steampowered.com').replace(/\/+$/, '');
    const buf = await post(
      `${baseUrl}/ISteamRemoteStorage/GetPublishedFileDetails/v1/`,
      parts.join('&'),
      effectiveTimeout,
      signal ? { signal } : undefined
    );
    const data = JSON.parse(buf.toString('utf8'));
    const list = (data.response && data.response.publishedfiledetails) || [];
    rememberSuccess(list);

    const withThumb = list.filter(detail => detail.preview_url).length;
    logger.log(`[FileDetails] Got ${list.length} records, ${withThumb} with preview_url`);
    if (list[0]) {
      logger.log(`[FileDetails] Sample[0]: title="${list[0].title}", preview="${list[0].preview_url ? list[0].preview_url.substring(0, 60) + '...' : 'NONE'}"`);
      if (ids.length === 1) {
        const detail = list[0];
        const fileUrl = String(detail.file_url || '').trim();
        const hcontent = String(detail.hcontent_file || detail.hcontent_file_id || '').trim();
        let fileHost = '';
        try { fileHost = fileUrl ? new URL(fileUrl).hostname : ''; } catch {}
        logger.log(`[FileDetails] Source id=${detail.publishedfileid || ids[0]} file_url=${fileUrl ? `YES host=${fileHost || 'unknown'}` : 'NO'} hcontent=${hcontent || 'none'} filename="${detail.filename || ''}"`);
      }
    }

    return list;
  }

  async function getChunkWithRetry(ids, chunkIndex, runOptions = {}) {
    let lastError = null;
    const retries = Number.isFinite(runOptions.retryCount) ? runOptions.retryCount : retryCount;
    for (let attempt = 0; attempt <= retries; attempt += 1) {
      try {
        throwIfAborted(runOptions.signal);
        const timeout = runOptions.timeoutMs || (ids.length <= 1 ? singleTimeoutMs : baseTimeoutMs + attempt * 5000);
        if (attempt > 0) logger.log(`[FileDetails] Retry chunk ${chunkIndex + 1} attempt ${attempt + 1}/${retries + 1}`);
        return await get(ids, timeout, runOptions.signal);
      } catch (e) {
        lastError = e;
        if (e && e.code === 'ABORT_ERR') throw e;
        logger.warn(`[FileDetails] Chunk ${chunkIndex + 1} failed attempt ${attempt + 1}/${retries + 1}:`, e.message);
        if (attempt < retries) await sleep(250 * (attempt + 1));
      }
    }
    logger.warn(`[FileDetails] Chunk ${chunkIndex + 1} gave up:`, lastError ? lastError.message : 'unknown error');
    return [];
  }

  async function getSafe(ids, optionsForRun = {}) {
    const uniqIds = normalizeIds(ids);
    if (!uniqIds.length) return [];
    throwIfAborted(optionsForRun.signal);

    const fromCache = cachedDetails(uniqIds);
    if (!fromCache.missing.length) {
      logger.log(`[FileDetails] Cache hit ${fromCache.cached.length}/${uniqIds.length} records`);
      return fromCache.cached;
    }

    if (failureCooldownUntil > now() && !optionsForRun.ignoreCooldown) {
      logger.warn(`[FileDetails] Skip API during cooldown, using cached ${fromCache.cached.length}/${uniqIds.length} records`);
      return fromCache.cached;
    }

    const safeMode = optionsForRun.safe !== false;
    const totalBudgetMs = Number(optionsForRun.totalBudgetMs || (safeMode ? safeTotalBudgetMs : 0));
    const startedAt = now();
    const deadline = totalBudgetMs > 0 ? startedAt + totalBudgetMs : 0;
    const chunks = chunkArray(fromCache.missing, batchSize);
    const concurrency = safeMode ? Math.min(maxConcurrency, 3) : maxConcurrency;
    const retries = safeMode ? safeRetryCount : retryCount;
    const out = fromCache.cached.slice();
    let failures = 0;

    if (chunks.length === 1) {
      const timeout = safeMode ? Math.min(safeChunkTimeoutMs, Math.max(1000, deadline ? deadline - now() : safeChunkTimeoutMs)) : undefined;
      const list = await getChunkWithRetry(chunks[0], 0, { retryCount: retries, timeoutMs: timeout, signal: optionsForRun.signal });
      if (!list.length && chunks[0].length) failures += 1;
      out.push(...list);
      if (failures && !list.length) rememberFailure('single chunk failed');
      return out;
    }

    logger.log(`[FileDetails] Split ${fromCache.missing.length} missing ids into ${chunks.length} chunks (size=${batchSize}, concurrency=${concurrency}, cached=${fromCache.cached.length}, budget=${safeMode ? totalBudgetMs : 'full'}ms)`);
    let nextIndex = 0;
    async function worker() {
      while (nextIndex < chunks.length) {
        throwIfAborted(optionsForRun.signal);
        if (deadline && now() >= deadline) break;
        const index = nextIndex;
        nextIndex += 1;
        const remaining = deadline ? Math.max(1000, deadline - now()) : 0;
        const timeout = safeMode ? Math.min(safeChunkTimeoutMs, remaining) : undefined;
        const list = await getChunkWithRetry(chunks[index], index, { retryCount: retries, timeoutMs: timeout, signal: optionsForRun.signal });
        if (!list.length && chunks[index].length) failures += 1;
        out.push(...list);
      }
    }
    const workers = Array.from({ length: Math.min(concurrency, chunks.length) }, () => worker());
    await Promise.all(workers);

    const gotFresh = out.length - fromCache.cached.length;
    if (failures && gotFresh === 0) rememberFailure(`${failures}/${chunks.length} chunks failed`);
    logger.log(`[FileDetails] Safe result ${out.length}/${uniqIds.length} records from ${chunks.length} chunks (cached=${fromCache.cached.length})`);
    return out;
  }

  function refreshInBackground(ids) {
    const uniqIds = normalizeIds(ids);
    if (!uniqIds.length || backgroundRefreshPromise) return;
    const missing = cachedDetails(uniqIds).missing;
    if (!missing.length || failureCooldownUntil > now()) return;
    backgroundRefreshPromise = getSafe(missing, { safe: true, totalBudgetMs: safeTotalBudgetMs, ignoreCooldown: false })
      .catch(err => logger.warn('[FileDetails] background refresh failed:', err.message))
      .finally(() => { backgroundRefreshPromise = null; });
  }

  return {
    get,
    getSafe,
    refreshInBackground,
  };
}

module.exports = {
  createPublishedFileDetailsService,
};
