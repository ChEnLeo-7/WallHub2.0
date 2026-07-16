'use strict';

function pruneWorkshopCache(cache, options = {}) {
  if (!(cache instanceof Map)) return cache;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const ttlMs = Math.max(0, Number(options.ttlMs) || 0);
  const maxEntries = Math.max(1, Math.floor(Number(options.maxEntries) || 1));

  for (const [key, entry] of cache) {
    if (!entry || now - Number(entry.cachedAt || 0) > ttlMs) cache.delete(key);
  }

  if (cache.size <= maxEntries) return cache;
  const oldestFirst = [...cache.entries()]
    .sort(([, left], [, right]) => Number(left?.cachedAt || 0) - Number(right?.cachedAt || 0));
  for (const [key] of oldestFirst.slice(0, cache.size - maxEntries)) cache.delete(key);
  return cache;
}

module.exports = { pruneWorkshopCache };
