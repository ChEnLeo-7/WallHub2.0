'use strict';

const { createSteamAccessError } = require('./errors');
const { redactUrlPathForLog } = require('../../infrastructure/http/client');

function collectBody(response) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    response.on('data', chunk => chunks.push(Buffer.from(chunk)));
    response.on('end', () => resolve(Buffer.concat(chunks)));
    response.on('error', reject);
  });
}

function createSteamAccessForwarder(options = {}) {
  const chooseRoute = options.chooseRoute || (() => Promise.resolve(null));
  const connectionPool = options.connectionPool;
  const markSuccess = options.markSuccess || (() => {});
  const markFailure = options.markFailure || (() => {});
  const metrics = options.metrics || { recordRequest: () => {} };
  const logger = options.logger || console;
  const debugLogger = options.debugLogger || logger;
  const verboseNetworkLogs = typeof options.verboseNetworkLogs === 'function' ? options.verboseNetworkLogs : () => !!options.verboseNetworkLogs;

  function networkLog(message) {
    if (verboseNetworkLogs()) logger.log(`[SteamAccess:net] ${message}`);
    else debugLogger.network?.(`[SteamAccess:net] ${message}`);
  }

  function sniLabel(strategy) {
    const type = strategy.type || strategy.mode || 'hidden';
    if (type === 'fake' || strategy.mode === 'custom') return strategy.hostname || 'fake';
    return type;
  }

  function orderCandidates(route, candidates, strategy, protocol) {
    if (connectionPool && typeof connectionPool.prioritizeIps === 'function') {
      return connectionPool.prioritizeIps(route, candidates, strategy, protocol);
    }
    return candidates;
  }

  function responseMeta(response) {
    return response && response.steamAccess ? response.steamAccess : {};
  }

  async function request(opts, body, timeout) {
    const startedAt = Date.now();
    const host = String(opts.hostname || '').toLowerCase();
    const routeOptions = Object.assign({ allowDegraded: true }, opts.routeOptions || {});
    const route = await chooseRoute(host, opts.port || 443, routeOptions);
    if (!route || !route.ips || !route.ips.length) throw createSteamAccessError('Steam access gateway has no route', { stage: 'route', host });
    const budget = route.policy && route.policy.requestBudget || {};
    const candidates = route.ips.slice(0, Math.max(1, budget.maxIps || 2));
    const strategies = Array.isArray(route.sniStrategies) && route.sniStrategies.length ? route.sniStrategies : [{ type: route.sniMode || 'hidden', mode: route.sniMode || 'hidden', hostname: route.sniHostname || '' }];
    const protocols = route.policy && Array.isArray(route.policy.protocols) && route.policy.protocols.length ? route.policy.protocols : ['h1'];
    let lastError = null;
    for (const strategy of strategies) {
      for (const protocol of protocols) {
        for (const ip of orderCandidates(route, candidates, strategy, protocol)) {
          const attemptStartedAt = Date.now();
          let response = null;
          try {
            networkLog(`request start host=${host} ip=${ip} sni=${sniLabel(strategy)} protocol=${protocol} path=${redactUrlPathForLog(opts.path || '/')}`);
            response = await connectionPool.request(route, Object.assign({}, opts, { body }), ip, strategy, Math.min(timeout || budget.totalTimeoutMs || 10000, budget.perIpTimeoutMs || 5000), opts.signal, protocol);
            if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
              response.resume?.();
              throw Object.assign(createSteamAccessError(`Steam access redirect ${response.statusCode}`, { stage: 'http', host, ip, sniStrategy: strategy.type, protocol, elapsedMs: Date.now() - attemptStartedAt }), { redirectLocation: response.headers.location });
            }
            if (response.statusCode < 200 || response.statusCode >= 300) {
              response.resume?.();
              throw createSteamAccessError(`HTTP ${response.statusCode}`, { stage: 'http', host, ip, sniStrategy: strategy.type, protocol, elapsedMs: Date.now() - attemptStartedAt });
            }
            const result = await collectBody(response);
            const meta = responseMeta(response);
            const elapsedMs = Date.now() - attemptStartedAt;
            networkLog(`request ok host=${host} ip=${ip} sni=${sniLabel(strategy)} protocol=${protocol} status=${response.statusCode} bytes=${result.length} reused=${!!meta.reusedSocket} localPort=${meta.localPort || 0} age=${meta.connectionAgeMs || 0}ms elapsed=${elapsedMs}ms`);
            markSuccess(host, ip, { source: 'history', actualRequest: true, requestOk: true, rttMs: elapsedMs, elapsedMs, sniStrategy: strategy.type, protocol, reusedSocket: !!meta.reusedSocket, localPort: meta.localPort || 0 });
            metrics.recordRequest(host, { ip, sniStrategy: strategy.type, protocol, reusedSocket: !!meta.reusedSocket, elapsedMs: Date.now() - startedAt });
            return result;
          } catch (error) {
            if (error && error.redirectLocation) throw error;
            lastError = error;
            if (response && connectionPool && typeof connectionPool.markFailure === 'function' && /ECONNRESET|socket|connection.*(?:reset|closed)/i.test(String(error && error.message || error || ''))) {
              connectionPool.markFailure(route, ip, strategy, protocol, error, { notify: true });
            }
            networkLog(`request failed host=${host} ip=${ip} sni=${sniLabel(strategy)} protocol=${protocol} stage=${error.stage || 'request'} elapsed=${Date.now() - attemptStartedAt}ms error=${error.message}`);
            markFailure(host, ip, error, { stage: error.stage || 'request', sniStrategy: strategy.type, protocol });
            metrics.recordRequest(host, { stage: error.stage || 'request', ip, sniStrategy: strategy.type, protocol, elapsedMs: Date.now() - attemptStartedAt }, error);
          }
        }
      }
    }
    throw lastError || createSteamAccessError('Steam access gateway request failed', { stage: 'request', host });
  }

  async function stream(opts, body, timeout) {
    const startedAt = Date.now();
    const host = String(opts.hostname || '').toLowerCase();
    const routeOptions = Object.assign({ allowDegraded: true }, opts.routeOptions || {});
    const route = await chooseRoute(host, opts.port || 443, routeOptions);
    if (!route || !route.ips || !route.ips.length) throw createSteamAccessError('Steam access gateway has no route', { stage: 'route', host });
    const budget = route.policy && route.policy.requestBudget || {};
    const candidates = route.ips.slice(0, Math.max(1, budget.maxIps || 2));
    const strategies = Array.isArray(route.sniStrategies) && route.sniStrategies.length ? route.sniStrategies : [{ type: route.sniMode || 'hidden', mode: route.sniMode || 'hidden', hostname: route.sniHostname || '' }];
    const protocols = route.policy && Array.isArray(route.policy.protocols) && route.policy.protocols.length ? route.policy.protocols : ['h1'];
    let lastError = null;
    for (const strategy of strategies) {
      for (const protocol of protocols) {
        for (const ip of orderCandidates(route, candidates, strategy, protocol)) {
          const attemptStartedAt = Date.now();
          try {
            networkLog(`stream start host=${host} ip=${ip} sni=${sniLabel(strategy)} protocol=${protocol} path=${redactUrlPathForLog(opts.path || '/')}`);
            const response = await connectionPool.request(route, Object.assign({}, opts, { body }), ip, strategy, Math.min(timeout || budget.totalTimeoutMs || 10000, budget.perIpTimeoutMs || 5000), opts.signal, protocol);
            if (Number(response.statusCode || 0) >= 500) {
              const error = createSteamAccessError(`HTTP ${response.statusCode}`, {
                stage: 'http',
                host,
                ip,
                sniStrategy: strategy.type,
                protocol,
                elapsedMs: Date.now() - attemptStartedAt,
              });
              response.resume?.();
              if (connectionPool && typeof connectionPool.markFailure === 'function') {
                connectionPool.markFailure(route, ip, strategy, protocol, error, { notify: true });
              }
              throw error;
            }
            const meta = responseMeta(response);
            const elapsedMs = Date.now() - attemptStartedAt;
            networkLog(`stream ok host=${host} ip=${ip} sni=${sniLabel(strategy)} protocol=${protocol} status=${response.statusCode || 0} reused=${!!meta.reusedSocket} localPort=${meta.localPort || 0} age=${meta.connectionAgeMs || 0}ms elapsed=${elapsedMs}ms`);
            markSuccess(host, ip, { source: 'history', actualRequest: true, requestOk: true, rttMs: elapsedMs, elapsedMs, sniStrategy: strategy.type, protocol, reusedSocket: !!meta.reusedSocket, localPort: meta.localPort || 0 });
            metrics.recordRequest(host, { ip, sniStrategy: strategy.type, protocol, reusedSocket: !!meta.reusedSocket, elapsedMs: Date.now() - startedAt });
            response.once?.('error', (error) => {
              if (connectionPool && typeof connectionPool.markFailure === 'function') {
                connectionPool.markFailure(route, ip, strategy, protocol, error, { notify: true });
              }
              markFailure(host, ip, error, { stage: 'stream', sniStrategy: strategy.type, protocol });
            });
            return response;
          } catch (error) {
            lastError = error;
            networkLog(`stream failed host=${host} ip=${ip} sni=${sniLabel(strategy)} protocol=${protocol} stage=${error.stage || 'request'} elapsed=${Date.now() - attemptStartedAt}ms error=${error.message}`);
            markFailure(host, ip, error, { stage: error.stage || 'request', sniStrategy: strategy.type, protocol });
            metrics.recordRequest(host, { stage: error.stage || 'request', ip, sniStrategy: strategy.type, protocol, elapsedMs: Date.now() - attemptStartedAt }, error);
          }
        }
      }
    }
    throw lastError || createSteamAccessError('Steam access gateway stream failed', { stage: 'request', host });
  }

  return { request, stream };
}

module.exports = { createSteamAccessForwarder };
