'use strict';

const { WORKSHOP_COMMUNITY_TAGS } = require('./rewrite/workshopTags');
const { createRewriteUrlPolicy } = require('./rewrite/urlPolicy');
const { createTextRewriteTools } = require('./rewrite/textRewrite');
const { createHtmlRewriteTools } = require('./rewrite/htmlRewrite');
const { createMediaRewriteTools } = require('./rewrite/mediaRewrite');
const { createRewriteResponsePolicy } = require('./rewrite/responsePolicy');
const { wallhubProxyClientScript } = require('./rewrite/clientScript');

function createSteamProxyRewriteTools(options = {}) {
  const virtualHostParam = options.virtualHostParam || '__whp_host';
  const isSteamHost = typeof options.isSteamHost === 'function' ? options.isSteamHost : () => false;
  const isSteamStaticCdnHost = typeof options.isSteamStaticCdnHost === 'function' ? options.isSteamStaticCdnHost : () => false;
  const isSteamCommunityHost = typeof options.isSteamCommunityHost === 'function' ? options.isSteamCommunityHost : () => false;
  const steamResourceContentType = typeof options.steamResourceContentType === 'function'
    ? options.steamResourceContentType
    : () => 'application/octet-stream';
  const workshopCommunityTags = new Set(WORKSHOP_COMMUNITY_TAGS.map((tag) => tag.toLowerCase()));
  const urlPolicy = createRewriteUrlPolicy({
    virtualHostParam,
    isSteamHost,
    isSteamCommunityHost,
    workshopCommunityTags,
  });
  const textRewrite = createTextRewriteTools(urlPolicy);
  const htmlRewrite = createHtmlRewriteTools({ ...urlPolicy, ...textRewrite });
  const mediaRewrite = createMediaRewriteTools({ isSteamHost, ...urlPolicy });
  const responsePolicy = createRewriteResponsePolicy({
    isSteamHost,
    isSteamStaticCdnHost,
    steamResourceContentType,
    ...urlPolicy,
  });
  const clientScript = (baseUrl = '') => wallhubProxyClientScript({ virtualHostParam, workshopCommunityTags }, baseUrl);

  function injectWallhubProxyClientScript(html, baseUrl) {
    const text = String(html || '');
    if (/data-wallhub-url-proxy=/i.test(text)) return text;
    const script = clientScript(baseUrl);
    if (/<head\b[^>]*>/i.test(text)) return text.replace(/<head\b[^>]*>/i, (match) => `${match}${script}`);
    if (/<\/head>/i.test(text)) return text.replace(/<\/head>/i, `${script}</head>`);
    if (/<\/body>/i.test(text)) return text.replace(/<\/body>/i, `${script}</body>`);
    return script + text;
  }

  return {
    parseWallhubUrlProxyTarget: urlPolicy.parseWallhubUrlProxyTarget,
    normalizeWallhubProxyTargetQuery: urlPolicy.normalizeWallhubProxyTargetQuery,
    isWallhubProxyVirtualLoginPath: urlPolicy.isWallhubProxyVirtualLoginPath,
    isWallhubProxyVirtualSteamPath: urlPolicy.isWallhubProxyVirtualSteamPath,
    canUseWallhubVirtualSteamProxyPath: urlPolicy.canUseWallhubVirtualSteamProxyPath,
    wallhubVirtualSteamProxyPath: urlPolicy.wallhubVirtualSteamProxyPath,
    parseWallhubVirtualSteamProxyTarget: urlPolicy.parseWallhubVirtualSteamProxyTarget,
    wallhubUrlProxyPath: urlPolicy.wallhubUrlProxyPath,
    wallhubWorkshopTagBrowsePath: urlPolicy.wallhubWorkshopTagBrowsePath,
    wallhubWorkshopFilterBrowsePath: urlPolicy.wallhubWorkshopFilterBrowsePath,
    steamProxyHostPattern: urlPolicy.steamProxyHostPattern,
    rewriteWallhubProxyEscapedUrls: textRewrite.rewriteWallhubProxyEscapedUrls,
    rewriteWallhubProxyJsonText: textRewrite.rewriteWallhubProxyJsonText,
    rewriteWallhubProxyJsText: textRewrite.rewriteWallhubProxyJsText,
    decodeWallhubHtmlAttrValue: htmlRewrite.decodeWallhubHtmlAttrValue,
    encodeWallhubHtmlAttrValue: htmlRewrite.encodeWallhubHtmlAttrValue,
    rewriteWallhubProxyHtmlTags: htmlRewrite.rewriteWallhubProxyHtmlTags,
    rewriteWallhubProxyApplicationConfig: htmlRewrite.rewriteWallhubProxyApplicationConfig,
    rewriteWallhubProxyHtml: htmlRewrite.rewriteWallhubProxyHtml,
    rewriteWallhubProxyCss: textRewrite.rewriteWallhubProxyCss,
    rewriteWallhubProxyMediaManifest: mediaRewrite.rewriteWallhubProxyMediaManifest,
    wallhubProxyClientScript: clientScript,
    injectWallhubProxyClientScript,
    inferWallhubProxyContentType: responsePolicy.inferWallhubProxyContentType,
    wallhubProxyPathExt: responsePolicy.wallhubProxyPathExt,
    isWallhubProxyTextType: responsePolicy.isWallhubProxyTextType,
    isWallhubProxyHtmlType: responsePolicy.isWallhubProxyHtmlType,
    isWallhubProxyStaticAsset: responsePolicy.isWallhubProxyStaticAsset,
    shouldRewriteWallhubProxyText: responsePolicy.shouldRewriteWallhubProxyText,
    collectWallhubProxyPrefetchUrls: responsePolicy.collectWallhubProxyPrefetchUrls,
    isWallhubSteamAuthApiTarget: urlPolicy.isWallhubSteamAuthApiTarget,
    isWallhubSteamWebApiServiceTarget: urlPolicy.isWallhubSteamWebApiServiceTarget,
    isSteamQrChallengeUrl: urlPolicy.isSteamQrChallengeUrl,
    isSteamCommunityHost,
  };
}

module.exports = { createSteamProxyRewriteTools };
