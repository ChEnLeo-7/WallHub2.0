'use strict';

function createGatewayWarmup(options = {}) {
  const enabled = options.enabled;
  const currentMode = options.currentMode;
  const warmupHosts = options.warmupHosts;
  const cdnWarmupHosts = options.cdnWarmupHosts;
  const routeCache = options.routeCache;
  const chooseRoute = options.chooseRoute;
  const connectionPool = options.connectionPool;
  const debugLogger = options.debugLogger;
  let warmupPromise = null;
  let coreWarmupPromise = null;
  let cdnWarmupPromise = null;

  async function runWarmup(reason, list, optionsForRun = {}) {
    if (!enabled() && optionsForRun.forceEnhance !== true) return { ok: 0, total: 0, routes: [] };
    const targets = Array.isArray(list) && list.length ? list : warmupHosts;
    const forceRefresh = optionsForRun.forceRefresh !== false;
    const onProgress = typeof optionsForRun.onProgress === 'function' ? optionsForRun.onProgress : null;
    const routes = [];
    let ok = 0;
    let completed = 0;
    const emitProgress = (host = '') => {
      if (!onProgress) return;
      try { onProgress({ completed, total: targets.length, ok, host }); }
      catch (error) { debugLogger.warn(`[SteamAccess] warmup progress callback failed: ${error.message}`); }
    };
    emitProgress();
    for (const host of targets) {
      try {
        const cached = !forceRefresh ? routeCache.buildCachedRouteFromPool(host, 443) : null;
        const route = cached || await chooseRoute(host, 443, {
          forceRefresh,
          forceEnhance: optionsForRun.forceEnhance === true,
        });
        if (route && route.ip) {
          routes.push(route);
          for (const ip of (route.ips || []).slice(0, 2)) connectionPool.prewarm(route, ip, (route.sniStrategies || [])[0] || { type: 'hidden', mode: 'hidden' });
          if (route.readiness === 'ready') ok += 1;
        }
      } catch (error) {
        debugLogger.warn(`[SteamAccess] warmup failed ${host}: ${error.message}`);
      } finally {
        completed += 1;
        emitProgress(host);
      }
    }
    debugLogger.log(`[SteamAccess] warmup finished (${reason || 'manual'}): ${ok}/${targets.length}`);
    return { ok, total: targets.length, completed, routes };
  }

  function warmup(reason, list) {
    if (!warmupPromise) {
      warmupPromise = runWarmup(reason, list).finally(() => { warmupPromise = null; });
    }
    return warmupPromise;
  }

  function warmupCore(reason, optionsForRun = {}) {
    if (!coreWarmupPromise) {
      coreWarmupPromise = runWarmup(reason || 'core', warmupHosts, optionsForRun).finally(() => { coreWarmupPromise = null; });
    }
    return coreWarmupPromise;
  }

  function warmupControlPlane(reason, optionsForRun = {}) {
    return runWarmup(reason || 'control-plane', ['api.steampowered.com', 'community.steam-api.com'], Object.assign({ forceRefresh: true }, optionsForRun));
  }

  function warmupCdnBackground(reason) {
    if (!cdnWarmupPromise) {
      cdnWarmupPromise = runWarmup(reason || 'cdn', cdnWarmupHosts).finally(() => { cdnWarmupPromise = null; });
    }
    return cdnWarmupPromise;
  }

  function ensureReady(reason, timeoutMs = 15000, optionsForRun = {}) {
    if (!enabled()) {
      return Promise.resolve({ ready: false, disabled: true, ok: 0, total: 0, completed: 0, routes: [] });
    }
    const mode = currentMode();
    const coreRoutes = warmupHosts
      .map(host => routeCache.get(`${mode}:${String(host || '').toLowerCase()}:443`))
      .filter(route => route && route.ip);
    if (coreRoutes.length) {
      if (typeof optionsForRun.onProgress === 'function') {
        optionsForRun.onProgress({ completed: coreRoutes.length, total: warmupHosts.length, ok: coreRoutes.length, host: '', cached: true });
      }
      return Promise.resolve({ ready: true, ok: coreRoutes.length, total: warmupHosts.length, completed: coreRoutes.length, routes: coreRoutes, cached: true });
    }
    return Promise.race([
      warmupCore(reason || 'ready', Object.assign({}, optionsForRun, { forceRefresh: false })).then(result => Object.assign({ ready: !!(result && result.ok > 0) }, result || {})),
      new Promise(resolve => setTimeout(() => resolve({ ready: false, ok: 0, total: 0, completed: 0, routes: [], timeout: true }), Math.max(500, timeoutMs))),
    ]);
  }

  function isWarmingUp() {
    return !!(warmupPromise || coreWarmupPromise || cdnWarmupPromise);
  }

  async function logResolvedRoutes(reason) {
    const result = await runWarmup(reason || 'log', warmupHosts);
    for (const route of result.routes || []) {
      debugLogger.log(`[SteamAccess] ${reason || 'route'} ${route.hostname} -> ${route.ip}`);
    }
    return result.routes || [];
  }

  return {
    warmup,
    warmupCore,
    warmupControlPlane,
    warmupCdnBackground,
    ensureReady,
    isWarmingUp,
    logResolvedRoutes,
  };
}

module.exports = { createGatewayWarmup };
