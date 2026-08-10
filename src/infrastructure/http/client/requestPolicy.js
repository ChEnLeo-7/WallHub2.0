'use strict';

const { doRequestByCurlCascade } = require('./curlTransport');
const { requestNative } = require('./nativeTransport');
const { getRedirectLocation, followRedirect } = require('./redirectPolicy');

function createRequestDispatcher(helpers = {}) {
  const getProxyCandidates = helpers.getProxyCandidates || (() => [null]);
  const shouldRetryWithNextProxy = helpers.shouldRetryWithNextProxy || (() => false);
  const logger = helpers.logger || console;
  const fallbackTimeoutMs = Number(process.env.WALLHUB_STEAM_ACCESS_FALLBACK_TIMEOUT_MS || helpers.steamAccessFallbackTimeoutMs || 8000);
  const isFallbackHost = typeof helpers.isSteamAccessFallbackHost === 'function' ? helpers.isSteamAccessFallbackHost : () => false;
  const gatewayEnabled = typeof helpers.steamAccessGatewayEnabled === 'function' ? helpers.steamAccessGatewayEnabled : () => false;

  function doRequest(opts, body, redirects, proxyIndex) {
    const redirectCount = redirects || 0;
    const currentProxyIndex = proxyIndex || 0;
    const protocol = opts.protocol || 'https:';
    const baseTimeout = opts.timeout || 22000;
    const timeout = gatewayEnabled() && isFallbackHost(opts.hostname)
      ? Math.min(baseTimeout, fallbackTimeoutMs)
      : baseTimeout;
    const proxies = getProxyCandidates(protocol, opts.hostname);
    const proxy = proxies[Math.min(currentProxyIndex, proxies.length - 1)];
    const attemptTimeout = proxy ? Math.min(timeout, 12000) : timeout;

    if (currentProxyIndex === 0 && typeof helpers.shouldUseGateway === 'function' && helpers.shouldUseGateway(opts, proxy)) {
      return helpers.requestByGateway(opts, body, timeout).catch((error) => {
        const location = getRedirectLocation(error);
        if (location) return followRedirect(doRequest, opts, location, timeout, redirectCount);
        if (process.env.WALLHUB_STEAM_ACCESS_FALLBACK_NORMAL === '0') {
          logger.warn(`[SteamAccess] ${opts.hostname} gateway failed, normal fallback disabled: ${error.message}`);
          throw error;
        }
        logger.warn(`[SteamAccess] ${opts.hostname} gateway failed, fallback to normal request: ${error.message}`);
        const fallbackTimeout = Math.min(timeout, fallbackTimeoutMs);
        const fallbackOpts = Object.assign({}, opts, {
          disableSteamAccessGateway: true,
          timeout: fallbackTimeout,
        });
        return doRequest(fallbackOpts, body, redirectCount, currentProxyIndex);
      });
    }
    if (process.env.WALLHUB_DISABLE_CURL_PROXY !== '1' && !opts.disableCurlProxy) {
      return doRequestByCurlCascade(opts, body, attemptTimeout, proxies, currentProxyIndex, Object.assign({}, helpers, {
        shouldRetryWithNextProxy,
      }));
    }
    return requestNative(opts, body, attemptTimeout, proxy, helpers).catch((error) => {
      const location = getRedirectLocation(error);
      if (location) return followRedirect(doRequest, opts, location, timeout, redirectCount);
      if (shouldRetryWithNextProxy(error) && currentProxyIndex + 1 < proxies.length) {
        return doRequest(opts, body, redirectCount, currentProxyIndex + 1);
      }
      throw error;
    });
  }

  return doRequest;
}

module.exports = {
  createRequestDispatcher,
};
