'use strict';

const steamProxyHttp = require('./http');
const { createSteamProxyHeaderProfile } = require('./headerProfile');
const { wallhubProxyPort, isExtensionlessBroadcastMediaManifest } = require('./urlProxy/helpers');
const { createUrlProxyPolicy } = require('./urlProxy/policy');
const { createLoginRequestTools } = require('./urlProxy/loginRequest');
const { createUpstreamRequestTools } = require('./urlProxy/upstream');
const { createUrlProxyRequestHandlers } = require('./urlProxy/requestHandler');

function createWallhubUrlProxyTools(options = {}) {
  const config = {
    userAgent: options.userAgent || 'WallHub',
    steamPrefCookie: options.steamPrefCookie || '',
    virtualHostParam: options.virtualHostParam || '__whp_host',
    logger: options.logger || console,
    isSteamHost: options.isSteamHost || (() => false),
    isSteamCdnHost: options.isSteamCdnHost || (() => false),
    isSteamAccessGatewayHost: options.isSteamAccessGatewayHost || (() => false),
    isSteamBroadcastResource: options.isSteamBroadcastResource || (() => false),
    isSteamAccessStaticBypassHost: options.isSteamAccessStaticBypassHost || (() => false),
    isAuthApiTarget: options.isAuthApiTarget || (() => false),
    isWebApiServiceTarget: options.isWebApiServiceTarget || (() => false),
    isProxyHtmlType: options.isProxyHtmlType || (() => false),
    isProxyStaticAsset: options.isProxyStaticAsset || (() => false),
    headerValue: options.headerValue || (() => ''),
    upstreamCookie: options.upstreamCookie || (() => ''),
    upstreamCookieValue: options.upstreamCookieValue || (() => ''),
    transformSetCookie: options.transformSetCookie || (() => []),
    urlProxyPath: options.urlProxyPath || ((location) => location),
    parseProxyTarget: options.parseProxyTarget || (() => null),
    parseVirtualProxyTarget: options.parseVirtualProxyTarget || (() => null),
    virtualProxyPath: options.virtualProxyPath || (() => ''),
    isVirtualLoginPath: options.isVirtualLoginPath || (() => false),
    inferContentType: options.inferContentType || (() => 'application/octet-stream'),
    jsonRes: options.jsonRes || (() => {}),
    readBodyBuffer: options.readBodyBuffer || (() => Promise.resolve(Buffer.alloc(0))),
    decodeBody: options.decodeBody || ((body) => Buffer.isBuffer(body) ? body : Buffer.from(body || '')),
    rewrite: options.rewrite || {},
    cache: options.cache || {},
    requestOnceImpl: options.requestOnce || (() => Promise.reject(new Error('Wallhub URL proxy requester missing'))),
    gatewayEnabled: options.gatewayEnabled || (() => false),
    requestByGatewayStream: options.requestByGatewayStream || null,
    getProxyCandidates: options.getProxyCandidates || (() => [null]),
    shouldRetryWithNextProxy: options.shouldRetryWithNextProxy || (() => false),
    isSteamCommunityHost: options.isSteamCommunityHost || (() => false),
  };
  config.requestStreamImpl = options.requestStream || ((target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions) =>
    config.requestOnceImpl(target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions));
  config.bufferResponseImpl = options.bufferResponse || ((response) => new Promise((resolve, reject) => {
    const buffers = [];
    response.on('data', (data) => buffers.push(Buffer.from(data)));
    response.on('end', () => resolve({
      statusCode: response.statusCode || 502,
      statusMessage: response.statusMessage || '',
      headers: response.headers || {},
      body: Buffer.concat(buffers),
    }));
    response.on('error', reject);
  }));

  const getSteamAccessPolicy = options.getSteamAccessPolicy || (() => null);
  const headerProfile = createSteamProxyHeaderProfile({
    userAgent: config.userAgent,
    getExperimental: () => (getSteamAccessPolicy('steamcommunity.com') || {}).experimental || {},
  });
  const policy = createUrlProxyPolicy({ ...config, headerProfile });
  const login = createLoginRequestTools(config);
  const upstream = createUpstreamRequestTools({
    ...config,
    ...policy,
    responseHeadersImpl: (target, headers, contentType, bodyLength, rewriteText, isHead) =>
      steamProxyHttp.createWallhubProxyResponseHeaders(target, headers, contentType, bodyLength, rewriteText, isHead, {
        isAuthApiTarget: config.isAuthApiTarget,
        isWebApiServiceTarget: config.isWebApiServiceTarget,
        urlProxyPath: config.urlProxyPath,
        transformSetCookie: config.transformSetCookie,
      }),
  });
  const handlers = createUrlProxyRequestHandlers({ ...config, ...policy, ...login, ...upstream });

  const handleSteamAppRelativeAsset = (req, res, handleUrlProxy) =>
    policy.handleSteamAppRelativeAsset(req, res, handleUrlProxy, config.urlProxyPath);

  return {
    shouldCacheTarget: policy.shouldCacheTarget,
    cachePaths: policy.cachePaths,
    readCache: policy.readCache,
    writeCache: policy.writeCache,
    cleanupCacheSoon: policy.cleanupCacheSoon,
    cleanupCache: policy.cleanupCache,
    referer: policy.referer,
    origin: policy.origin,
    normalizeSteamApiOrigin: policy.normalizeSteamApiOrigin,
    buildRequestHeaders: policy.buildRequestHeaders,
    requestOnce: upstream.requestOnce,
    requestUrl: upstream.requestUrl,
    responseHeaders: upstream.responseHeaders,
    prefetchTargets: upstream.prefetchTargets,
    steamPublicBaseFromReferer: policy.steamPublicBaseFromReferer,
    steamAppRelativeProxyTarget: policy.steamAppRelativeProxyTarget,
    handleSteamAppRelativeAsset,
    handleVirtualSteamProxy: handlers.handleVirtualSteamProxy,
    handleUrlProxy: handlers.handleUrlProxy,
    normalizeSteamLoginPostBody: login.normalizeSteamLoginPostBody,
    localProxyValueToSteamUrl: login.localProxyValueToSteamUrl,
  };
}

module.exports = {
  wallhubProxyPort,
  isExtensionlessBroadcastMediaManifest,
  createWallhubUrlProxyTools,
};
