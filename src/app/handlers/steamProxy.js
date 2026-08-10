'use strict';

const {
  parseProxyUrl,
  isSocksProxyProtocol,
  resolveProxyForProtocol,
  proxyAuth,
  appendCurlProxyArgs,
  proxyKey,
  shouldRetryWithNextProxy,
  connectViaSocksProxy,
} = require('../../infrastructure/http/proxy');
const { createHttpClient } = require('../../infrastructure/http/client');
const { createSteamProxyCookieTools } = require('../../domains/steamProxy/cookies');
const { headerValue, createSteamProxyCache } = require('../../domains/steamProxy/cache');
const { createSteamProxyRewriteTools } = require('../../domains/steamProxy/rewrite');
const steamProxyHttp = require('../../domains/steamProxy/http');
const { createWallhubProxyRequester, bufferResponse } = require('../../domains/steamProxy/request');
const { createWallhubUrlProxyTools } = require('../../domains/steamProxy/urlProxy');

function createSteamProxyHandlers(options = {}) {
  const {
    userAgent,
    steamPrefCookie,
    virtualHostParam,
    cache,
    env,
    platform,
    logger = console,
    jsonRes,
    readBodyBuffer,
    stripProxyEnv,
    contentTypeFromUrl,
    isAndroidHostLikeEnv,
    isSteamHost,
    isSteamCdnHost,
    isSteamStaticCdnHost,
    isSteamBroadcastResource,
    isSteamCommunityHost,
    isSteamAccessGatewayHost,
    getSettings,
    getSteamCdnRouteStrategy,
    steamAccessDirectWebApiEnabled,
    steamAccessGatewayEnabled,
    shouldUseSteamAccessGateway,
    requestBySteamAccessGateway,
    requestStreamBySteamAccessGateway,
    chooseSteamAccessRoute,
    removeSteamAccessCachedIp,
    steamAccessPolicyForHost,
  } = options;

  const cookieTools = createSteamProxyCookieTools({ isSteamHost });
  const rewriteTools = createSteamProxyRewriteTools({
    virtualHostParam,
    isSteamHost,
    isSteamStaticCdnHost,
    isSteamCommunityHost,
    steamResourceContentType: contentTypeFromUrl,
  });
  const proxyCache = createSteamProxyCache({
    cacheDir: cache.dir,
    version: cache.version,
    maxBytes: cache.maxBytes,
    entryMaxBytes: cache.entryMaxBytes,
    ttlMs: cache.ttlMs,
    steamResourceContentType: contentTypeFromUrl,
  });
  const proxyRequester = createWallhubProxyRequester({
    isSocksProxyProtocol,
    connectViaSocksProxy,
    proxyAuth,
  });

  function shouldUseSettingsSteamHttpProxy(hostname) {
    return !!String(getSettings().steamHttpProxyUrl || '').trim();
  }

  function getProxyCandidates(protocol, hostname) {
    const list = [];
    const add = proxy => { if (proxy && proxy.hostname) list.push(proxy); };
    const customProxyHost = String(env.WALLHUB_PROXY_HOST || '').trim();
    const explicitProxy = parseProxyUrl(env.WALLHUB_PROXY || env.wallhub_proxy || '');
    add(explicitProxy);
    const settingsProxy = shouldUseSettingsSteamHttpProxy(hostname)
      ? parseProxyUrl(getSettings().steamHttpProxyUrl || '')
      : null;
    add(settingsProxy);
    const resolved = explicitProxy || settingsProxy ? null : resolveProxyForProtocol(protocol);
    add(resolved);
    if (customProxyHost && resolved && /^(127\.0\.0\.1|localhost)$/i.test(resolved.hostname)) {
      add(parseProxyUrl(`http://${customProxyHost}:${resolved.port || 80}`));
    }
    const extraPortsRaw = String(env.WALLHUB_PROXY_PORTS || '').trim();
    if (extraPortsRaw && platform === 'win32') {
      const ports = extraPortsRaw
        .split(',')
        .map(value => parseInt(String(value).trim()))
        .filter(value => value > 0 && value < 65536);
      const hosts = customProxyHost ? ['127.0.0.1', 'localhost', customProxyHost] : ['127.0.0.1', 'localhost'];
      for (const port of ports) {
        for (const host of hosts) add(parseProxyUrl(`http://${host}:${port}`));
      }
    }
    const seen = new Set();
    const unique = [];
    for (const proxy of list) {
      const key = proxyKey(proxy);
      if (seen.has(key)) continue;
      seen.add(key);
      unique.push(proxy);
    }
    if (!seen.has('direct') && !settingsProxy) unique.push(null);
    return unique;
  }

  function isSteamWebApiHost(hostname) {
    return String(hostname || '').trim().toLowerCase() === 'api.steampowered.com';
  }

  const httpClient = createHttpClient({
    userAgent,
    steamPrefCookie,
    getProxyCandidates,
    shouldUseGateway: (requestOptions, proxy) => {
      if (requestOptions && isSteamWebApiHost(requestOptions.hostname) && steamAccessDirectWebApiEnabled()) return false;
      return shouldUseSteamAccessGateway(requestOptions, proxy);
    },
    requestByGateway: requestBySteamAccessGateway,
    appendCurlProxyArgs,
    stripProxyEnv,
    shouldRetryWithNextProxy,
    isSocksProxyProtocol,
    connectViaSocksProxy,
    proxyAuth,
    isAndroidHostLikeEnv,
    isSteamAccessFallbackHost: isSteamAccessGatewayHost,
    steamAccessGatewayEnabled,
    logger,
  });

  const urlProxyTools = createWallhubUrlProxyTools({
    userAgent,
    steamPrefCookie,
    virtualHostParam,
    logger,
    isSteamHost,
    isSteamAccessGatewayHost,
    isSteamCdnHost,
    isSteamStaticCdnHost,
    isSteamBroadcastResource,
    isAuthApiTarget: rewriteTools.isWallhubSteamAuthApiTarget,
    isWebApiServiceTarget: rewriteTools.isWallhubSteamWebApiServiceTarget,
    isProxyHtmlType: rewriteTools.isWallhubProxyHtmlType,
    isProxyStaticAsset: rewriteTools.isWallhubProxyStaticAsset,
    headerValue,
    upstreamCookie: cookieTools.wallhubProxyUpstreamCookie,
    upstreamCookieValue: cookieTools.wallhubProxyCookieValue,
    transformSetCookie: cookieTools.transformWallhubProxySetCookie,
    urlProxyPath: rewriteTools.wallhubUrlProxyPath,
    parseProxyTarget: rewriteTools.parseWallhubUrlProxyTarget,
    parseVirtualProxyTarget: rewriteTools.parseWallhubVirtualSteamProxyTarget,
    virtualProxyPath: rewriteTools.wallhubVirtualSteamProxyPath,
    isVirtualLoginPath: rewriteTools.isWallhubProxyVirtualSteamPath,
    inferContentType: rewriteTools.inferWallhubProxyContentType,
    jsonRes,
    readBodyBuffer,
    decodeBody: (body, headers) => steamProxyHttp.decodeWallhubProxyBody(body, headers, logger),
    isSteamCommunityHost,
    rewrite: {
      escapedUrls: rewriteTools.rewriteWallhubProxyEscapedUrls,
      jsonText: rewriteTools.rewriteWallhubProxyJsonText,
      jsText: rewriteTools.rewriteWallhubProxyJsText,
      html: rewriteTools.rewriteWallhubProxyHtml,
      css: rewriteTools.rewriteWallhubProxyCss,
      mediaManifest: rewriteTools.rewriteWallhubProxyMediaManifest,
      injectClientScript: rewriteTools.injectWallhubProxyClientScript,
      pathExt: rewriteTools.wallhubProxyPathExt,
      isTextType: rewriteTools.isWallhubProxyTextType,
      shouldRewriteText: rewriteTools.shouldRewriteWallhubProxyText,
      collectPrefetchUrls: rewriteTools.collectWallhubProxyPrefetchUrls,
    },
    cache: proxyCache,
    requestOnce: (...args) => proxyRequester.requestOnce(...args),
    requestStream: (...args) => proxyRequester.requestStream(...args),
    bufferResponse,
    gatewayEnabled: steamAccessGatewayEnabled,
    chooseGatewayRoute: chooseSteamAccessRoute,
    removeGatewayCachedIp: removeSteamAccessCachedIp,
    requestByGatewayStream: requestStreamBySteamAccessGateway,
    getSteamAccessPolicy: steamAccessPolicyForHost,
    getProxyCandidates,
    shouldRetryWithNextProxy,
  });

  async function handleWallhubUrlProxy(req, res) {
    return urlProxyTools.handleUrlProxy(req, res);
  }

  return {
    doRequest: (...args) => httpClient.doRequest(...args),
    get: (...args) => httpClient.get(...args),
    post: (...args) => httpClient.post(...args),
    getProxyCandidates,
    upstreamCookie: cookieTools.wallhubProxyUpstreamCookie,
    isWallhubProxyVirtualSteamPath: rewriteTools.isWallhubProxyVirtualSteamPath,
    handleWallhubUrlProxy,
    handleWallhubVirtualSteamProxy: (req, res) => urlProxyTools.handleVirtualSteamProxy(req, res, handleWallhubUrlProxy),
    handleWallhubSteamAppRelativeAsset: (req, res) => urlProxyTools.handleSteamAppRelativeAsset(req, res, handleWallhubUrlProxy),
  };
}

module.exports = { createSteamProxyHandlers };
