'use strict';

const { wallhubProxyPort } = require('./helpers');

function createUpstreamRequestTools(options) {
  const {
    userAgent,
    steamPrefCookie,
    logger,
    isSteamAccessGatewayHost,
    isSteamCdnHost,
    isSteamBroadcastResource,
    isSteamAccessStaticBypassHost,
    requestOnceImpl,
    requestStreamImpl,
    bufferResponseImpl,
    gatewayEnabled,
    requestByGatewayStream,
    getProxyCandidates,
    shouldRetryWithNextProxy,
    shouldCacheTarget,
    readCache,
    writeCache,
    responseHeadersImpl,
  } = options;
  const prefetching = new Set();

  function requestOnce(target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions = {}) {
    return requestOnceImpl(target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions);
  }

  function isTransientProxyNetworkError(error) {
    return /client network socket disconnected|secure tls connection|socket hang up|ecconnreset|econnreset|etimedout|timed? out|failed to connect|connection.*(?:reset|closed|refused)|tls|ssl/i
      .test(String(error && error.message ? error.message : error || ''));
  }

  async function requestUrl(target, method, headers, body) {
    const timeout = 45000;
    wallhubProxyPort(target);
    const cached = await readCache(target, method, headers);
    if (cached) return { statusCode: cached.statusCode, headers: cached.headers, body: cached.body, stream: null };

    const fetchStream = (proxy, gatewayIp, gatewayOptions = {}) =>
      requestStreamImpl(target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions);
    const useSteamAccessRoute = gatewayEnabled() &&
      target.protocol === 'https:' &&
      !isSteamCdnHost(target.hostname) &&
      !isSteamAccessStaticBypassHost(target.hostname) &&
      (isSteamAccessGatewayHost(target.hostname) || isSteamBroadcastResource(target.hostname, target.pathname));
    if (useSteamAccessRoute) {
      if (typeof requestByGatewayStream !== 'function') {
        logger.warn(`[SteamAccess] ${target.hostname} gateway forwarder missing, fallback to normal proxy path`);
      } else {
        try {
          const stream = await requestByGatewayStream(target, method, headers, body, timeout);
          return { statusCode: stream.statusCode || 200, headers: stream.headers || {}, body: null, stream };
        } catch (error) {
          logger.warn(`[SteamAccess] ${target.hostname} gateway forwarder failed, fallback to normal proxy path: ${error.message}`);
        }
      }
    }

    const proxies = getProxyCandidates(target.protocol, target.hostname);
    let lastError = null;
    for (const proxy of proxies) {
      try {
        const stream = await fetchStream(proxy, '');
        return { statusCode: stream.statusCode || 200, headers: stream.headers || {}, body: null, stream };
      } catch (error) {
        lastError = error;
        if (!shouldRetryWithNextProxy(error) && !isTransientProxyNetworkError(error)) break;
      }
    }
    if (lastError && isTransientProxyNetworkError(lastError)) {
      throw Object.assign(new Error(`Wallhub URL proxy failed: ${target.hostname} is unreachable or the TLS connection was interrupted`), { cause: lastError });
    }
    throw lastError || new Error('Wallhub URL proxy request failed');
  }

  function responseHeaders(target, upstreamHeaders, contentType, bodyLength, rewriteText, isHead) {
    return responseHeadersImpl(target, upstreamHeaders, contentType, bodyLength, rewriteText, isHead);
  }

  function prefetchTargets(targets, reqHeaders) {
    for (const target of targets || []) {
      const key = target.toString();
      if (prefetching.has(key)) continue;
      prefetching.add(key);
      const headers = {
        'User-Agent': userAgent,
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Accept-Encoding': 'identity',
        'Host': target.host,
        'Referer': reqHeaders && reqHeaders.referer ? reqHeaders.referer : 'https://steamcommunity.com/',
        'Cookie': steamPrefCookie,
      };
      requestUrl(target, 'GET', headers, null)
        .then(async (upstream) => {
          if (!upstream || !upstream.stream) return;
          const contentType = String((upstream.headers || {})['content-type'] || '');
          if (shouldCacheTarget(target, 'GET', headers, contentType)) {
            const buffered = await bufferResponseImpl(upstream.stream);
            writeCache(target, buffered).catch(() => {});
          } else {
            upstream.stream.destroy();
          }
        })
        .catch(() => {})
        .finally(() => prefetching.delete(key));
    }
  }

  return { requestOnce, requestUrl, responseHeaders, prefetchTargets };
}

module.exports = { createUpstreamRequestTools };
