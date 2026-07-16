'use strict';

function createInFlightCoalescer(options = {}) {
  const execute = options.execute;
  const label = options.label || '[InFlight]';
  const logger = options.logger || console;
  if (typeof execute !== 'function') {
    throw new TypeError('createInFlightCoalescer requires options.execute');
  }

  const map = new Map();
  const cache = new Map();
  const resultTtlMs = Math.max(0, Number(options.resultTtlMs || 0));
  const configuredCacheLimit = Number(options.resultCacheMaxEntries);
  const resultCacheMaxEntries = Number.isFinite(configuredCacheLimit)
    ? Math.max(1, Math.floor(configuredCacheLimit))
    : Infinity;
  let generation = 0;

  function normalizeRunOptions(runOptions) {
    if (typeof runOptions === 'boolean') return { forceRefresh: runOptions };
    return runOptions || {};
  }

  function log(message) {
    if (logger && typeof logger.log === 'function') logger.log(message);
  }

  function abortError() {
    const error = new Error('Operation aborted');
    error.name = 'AbortError';
    error.code = 'ABORT_ERR';
    return error;
  }

  function promiseForCaller(entry, externalSignal) {
    if (!externalSignal) return entry.promise;
    if (externalSignal.aborted) return Promise.reject(abortError());
    if (typeof externalSignal.addEventListener !== 'function') return entry.promise;
    return new Promise((resolve, reject) => {
      let settled = false;
      const cleanup = () => {
        if (settled) return;
        settled = true;
        externalSignal.removeEventListener('abort', onAbort);
      };
      const onAbort = () => {
        cleanup();
        reject(abortError());
      };
      externalSignal.addEventListener('abort', onAbort, { once: true });
      entry.promise.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        }
      );
    });
  }

  function run(key, runOptions) {
    const optionsForRun = normalizeRunOptions(runOptions);
    const externalSignal = optionsForRun.signal;
    const currentGeneration = generation;
    if (!optionsForRun.forceRefresh && resultTtlMs > 0) {
      const cached = cache.get(key);
      if (cached && cached.generation === currentGeneration) {
        if (cached.expiresAt > Date.now()) {
          log(`${label} Using cached result for ${key}`);
          // Map insertion order is the LRU order. Promote a hit before
          // returning it so recently viewed pages survive capacity pruning.
          cache.delete(key);
          cache.set(key, cached);
          return externalSignal && externalSignal.aborted ? Promise.reject(abortError()) : Promise.resolve(cached.value);
        }
        cache.delete(key);
      }
    }

    const existing = map.get(key);
    if (existing && existing.generation === currentGeneration) {
      if (optionsForRun.forceRefresh) {
        log(`${label} Force refresh: joining in-flight for ${key} (no cache write)`);
      } else {
        log(`${label} Joining in-flight for ${key}`);
      }
      return promiseForCaller(existing, externalSignal);
    }

    const shouldCacheResult = !optionsForRun.forceRefresh && resultTtlMs > 0;
    const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const promise = Promise.resolve()
      .then(() => execute(key, Object.assign({}, optionsForRun, { signal: controller ? controller.signal : undefined })))
      .then((value) => {
        if (shouldCacheResult && generation === currentGeneration) {
          cache.delete(key);
          cache.set(key, {
            value,
            generation: currentGeneration,
            expiresAt: Date.now() + resultTtlMs,
          });
          while (cache.size > resultCacheMaxEntries) {
            const oldestKey = cache.keys().next().value;
            if (oldestKey === undefined) break;
            cache.delete(oldestKey);
          }
        }
        return value;
      })
      .finally(() => {
        const current = map.get(key);
        if (current && current.promise === promise && current.generation === currentGeneration) {
          map.delete(key);
        }
      });

    const entry = { promise, generation: currentGeneration, controller };
    map.set(key, entry);
    log(`${label} Created in-flight for ${key}`);
    return promiseForCaller(entry, externalSignal);
  }

  function clear() {
    const count = map.size + cache.size;
    if (count > 0) {
      for (const entry of map.values()) {
        if (entry && entry.controller && typeof entry.controller.abort === 'function') entry.controller.abort();
      }
      map.clear();
      cache.clear();
      log(`${label} Cleared in-flight/cache (count=${count})`);
    }
    generation += 1;
  }

  function clearCaches() {
    clear();
  }

  function invalidateCaches() {
    clear();
  }

  return {
    run,
    clear,
    clearCaches,
    invalidateCaches,
  };
}

module.exports = {
  createInFlightCoalescer,
};
