'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function headerValue(headers, name) {
  const target = String(name || '').toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (String(key || '').toLowerCase() === target) return value;
  }
  return '';
}

function createSteamProxyCache(options = {}) {
  const cacheDir = options.cacheDir;
  const version = options.version || 1;
  const maxBytes = Math.max(16 * 1024 * 1024, Number(options.maxBytes || 256 * 1024 * 1024));
  const entryMaxBytes = Math.max(256 * 1024, Number(options.entryMaxBytes || 24 * 1024 * 1024));
  const ttlMs = Math.max(60 * 1000, Number(options.ttlMs || 7 * 24 * 60 * 60 * 1000));
  const steamResourceContentType = typeof options.steamResourceContentType === 'function'
    ? options.steamResourceContentType
    : () => 'application/octet-stream';
  const shouldCacheTarget = typeof options.shouldCacheTarget === 'function'
    ? options.shouldCacheTarget
    : () => false;
  const indexPath = path.join(cacheDir, `.wallhub-cache-index-v${version}.json`);
  let cleanupAt = 0;
  let cacheIndex = null;
  let cacheIndexPromise = null;
  let cacheIndexWriteTimer = null;

  function pathsFor(target) {
    const key = crypto.createHash('sha1').update(target.toString()).digest('hex');
    const dir = path.join(cacheDir, key.slice(0, 2));
    return {
      key,
      dir,
      bodyPath: path.join(dir, `${key}.body`),
      metaPath: path.join(dir, `${key}.json`),
    };
  }

  function pathsForKey(key) {
    const normalized = String(key || '');
    if (!/^[a-f0-9]{40}$/i.test(normalized)) return null;
    const dir = path.join(cacheDir, normalized.slice(0, 2));
    return {
      key: normalized,
      dir,
      bodyPath: path.join(dir, `${normalized}.body`),
      metaPath: path.join(dir, `${normalized}.json`),
    };
  }

  function scheduleIndexWrite() {
    if (!cacheIndex || cacheIndexWriteTimer) return;
    cacheIndexWriteTimer = setTimeout(() => {
      cacheIndexWriteTimer = null;
      const snapshot = cacheIndex;
      if (!snapshot) return;
      const entries = Object.fromEntries(snapshot);
      fs.promises.mkdir(cacheDir, { recursive: true })
        .then(() => fs.promises.writeFile(indexPath, JSON.stringify({ version, entries })))
        .catch((error) => console.warn(`[UrlProxy] cache index write failed: ${error.message}`));
    }, 1500);
    cacheIndexWriteTimer.unref?.();
  }

  function setIndexEntry(key, entry) {
    if (!cacheIndex || !key) return;
    cacheIndex.set(String(key), Object.assign({}, entry));
    scheduleIndexWrite();
  }

  function removeIndexEntry(key) {
    if (!cacheIndex || !cacheIndex.delete(String(key))) return;
    scheduleIndexWrite();
  }

  async function rebuildCacheIndex() {
    const next = new Map();
    try {
      const buckets = await fs.promises.readdir(cacheDir, { withFileTypes: true });
      for (const bucket of buckets) {
        if (!bucket.isDirectory()) continue;
        const dir = path.join(cacheDir, bucket.name);
        const files = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
        for (const file of files) {
          if (!file.isFile() || !file.name.endsWith('.body')) continue;
          const key = file.name.slice(0, -'.body'.length);
          const paths = pathsForKey(key);
          if (!paths) continue;
          const stat = await fs.promises.stat(paths.bodyPath).catch(() => null);
          if (!stat) continue;
          let expiresAt = 0;
          try {
            const meta = JSON.parse(await fs.promises.readFile(paths.metaPath, 'utf8'));
            expiresAt = Number(meta && meta.expiresAt || 0);
          } catch {}
          next.set(key, {
            bytes: stat.size,
            accessAt: stat.mtimeMs,
            expiresAt,
          });
        }
      }
    } catch {}
    cacheIndex = next;
    scheduleIndexWrite();
    return cacheIndex;
  }

  async function ensureCacheIndex() {
    if (cacheIndex) return cacheIndex;
    if (cacheIndexPromise) return cacheIndexPromise;
    cacheIndexPromise = (async () => {
      try {
        const parsed = JSON.parse(await fs.promises.readFile(indexPath, 'utf8'));
        if (parsed && parsed.version === version && parsed.entries && typeof parsed.entries === 'object') {
          cacheIndex = new Map(Object.entries(parsed.entries)
            .filter(([key, entry]) => !!pathsForKey(key) && entry && Number(entry.bytes) >= 0)
            .map(([key, entry]) => [key, {
              bytes: Math.max(0, Number(entry.bytes) || 0),
              accessAt: Math.max(0, Number(entry.accessAt) || 0),
              expiresAt: Math.max(0, Number(entry.expiresAt) || 0),
            }]));
          return cacheIndex;
        }
      } catch {}
      return rebuildCacheIndex();
    })().finally(() => { cacheIndexPromise = null; });
    return cacheIndexPromise;
  }

  async function read(target, method, reqHeaders = {}) {
    if (String(method || 'GET').toUpperCase() !== 'GET' && String(method || 'GET').toUpperCase() !== 'HEAD') return null;
    if (headerValue(reqHeaders, 'range')) return null;
    const paths = pathsFor(target);
    try {
      const meta = JSON.parse(await fs.promises.readFile(paths.metaPath, 'utf8'));
      if (!meta || meta.version !== version || meta.url !== target.toString() || Number(meta.expiresAt || 0) <= Date.now()) return null;
      const body = String(method || 'GET').toUpperCase() === 'HEAD'
        ? Buffer.alloc(0)
        : await fs.promises.readFile(paths.bodyPath);
      fs.promises.utimes(paths.bodyPath, new Date(), new Date()).catch(() => {});
      if (cacheIndex) {
        setIndexEntry(paths.key, {
          bytes: Number(meta.bytes || body.length || 0),
          accessAt: Date.now(),
          expiresAt: Number(meta.expiresAt || 0),
        });
      }
      return {
        statusCode: meta.statusCode || 200,
        headers: meta.headers || {},
        body,
        fromCache: true,
      };
    } catch {
      return null;
    }
  }

  async function write(target, response) {
    if (!response || !Buffer.isBuffer(response.body)) return;
    if (response.body.length <= 0 || response.body.length > entryMaxBytes) return;
    const statusCode = response.statusCode || 200;
    if (statusCode !== 200) return;
    const paths = pathsFor(target);
    const headers = response.headers || {};
    const encoding = String(headerValue(headers, 'content-encoding') || '').trim().toLowerCase();
    if (encoding && encoding !== 'identity') return;
    if (headerValue(headers, 'set-cookie')) return;
    const meta = {
      version,
      url: target.toString(),
      statusCode,
      headers: {
        'content-type': headers['content-type'] || steamResourceContentType(target.toString()),
        'cache-control': headers['cache-control'] || 'public, max-age=604800',
        'last-modified': headers['last-modified'] || '',
      },
      createdAt: Date.now(),
      expiresAt: Date.now() + ttlMs,
      bytes: response.body.length,
    };
    try {
      await fs.promises.mkdir(paths.dir, { recursive: true });
      await Promise.all([
        fs.promises.writeFile(paths.bodyPath, response.body),
        fs.promises.writeFile(paths.metaPath, JSON.stringify(meta)),
      ]);
      if (cacheIndex) {
        setIndexEntry(paths.key, {
          bytes: response.body.length,
          accessAt: Date.now(),
          expiresAt: meta.expiresAt,
        });
      }
      cleanupSoon();
    } catch (e) {
      console.warn(`[UrlProxy] cache write failed ${target.hostname}: ${e.message}`);
    }
  }

  function cleanupSoon() {
    const now = Date.now();
    if (now - cleanupAt < 60 * 1000) return;
    cleanupAt = now;
    setTimeout(() => cleanup().catch((e) => console.warn('[UrlProxy] cache cleanup failed:', e.message)), 1500).unref?.();
  }

  async function cleanup() {
    const index = await ensureCacheIndex();
    let entries = Array.from(index.entries()).map(([key, entry]) => Object.assign({ key }, entry));
    const now = Date.now();
    for (const entry of entries.filter(item => item.expiresAt && item.expiresAt <= now)) {
      const paths = pathsForKey(entry.key);
      if (!paths) continue;
      await Promise.all([
        fs.promises.rm(paths.bodyPath, { force: true }).catch(() => {}),
        fs.promises.rm(paths.metaPath, { force: true }).catch(() => {}),
      ]);
      removeIndexEntry(entry.key);
    }
    entries = entries.filter(item => !item.expiresAt || item.expiresAt > now);
    let total = entries.reduce((sum, item) => sum + item.bytes, 0);
    if (total <= maxBytes) return;
    entries.sort((a, b) => a.accessAt - b.accessAt);
    const target = Math.floor(maxBytes * 0.8);
    for (const entry of entries) {
      const paths = pathsForKey(entry.key);
      if (!paths) continue;
      await Promise.all([
        fs.promises.rm(paths.bodyPath, { force: true }).catch(() => {}),
        fs.promises.rm(paths.metaPath, { force: true }).catch(() => {}),
      ]);
      removeIndexEntry(entry.key);
      total -= entry.bytes;
      if (total <= target) break;
    }
  }

  async function readIfCacheable(target, method, reqHeaders = {}) {
    return read(target, method, reqHeaders);
  }

  function writeIfCacheable(target, method, reqHeaders, contentType, response) {
    if (!shouldCacheTarget(target, method, reqHeaders, contentType)) return;
    write(target, response).catch(() => {});
  }

  return {
    headerValue,
    pathsFor,
    pathsForKey,
    read,
    write,
    ensureCacheIndex,
    cleanupSoon,
    cleanup,
    readIfCacheable,
    writeIfCacheable,
  };
}

module.exports = {
  headerValue,
  createSteamProxyCache,
};
