'use strict';

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
  'via',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
]);

function shouldUseCompressedProxy(experimental = {}) {
  return !!experimental.compressedProxy || process.env.WALLHUB_URL_PROXY_COMPRESSED_UPSTREAM === '1';
}

function createSteamProxyHeaderProfile(options = {}) {
  const userAgent = options.userAgent || 'WallHub';
  const getExperimental = typeof options.getExperimental === 'function' ? options.getExperimental : () => ({});

  function build(req, target, helpers = {}) {
    const method = String(helpers.method || 'GET').toUpperCase();
    const body = helpers.body;
    const referer = helpers.referer || `${target.protocol}//${target.host}/`;
    const headers = {
      'User-Agent': req.headers['user-agent'] || userAgent,
      'Accept': req.headers.accept || '*/*',
      'Accept-Language': req.headers['accept-language'] || 'zh-CN,zh;q=0.9,en;q=0.8',
      'Accept-Encoding': shouldUseCompressedProxy(getExperimental()) ? 'gzip, deflate, br' : 'identity',
      'Host': target.host,
      'Referer': referer,
    };
    if (helpers.origin) headers.Origin = helpers.origin;
    for (const [name, value] of Object.entries(req.headers || {})) {
      const lower = String(name || '').toLowerCase();
      if (!value || HOP_BY_HOP_HEADERS.has(lower)) continue;
      if (/^sec-/i.test(name) || ['content-type', 'x-requested-with', 'upgrade-insecure-requests'].includes(lower)) headers[name] = value;
    }
    if (helpers.contentType) headers['Content-Type'] = helpers.contentType;
    if (req.headers.range) headers.Range = req.headers.range;
    if (body && body.length && !['GET', 'HEAD'].includes(method)) headers['Content-Length'] = String(body.length);
    if (helpers.cookie) headers.Cookie = helpers.cookie;
    return headers;
  }

  return { build };
}

module.exports = { createSteamProxyHeaderProfile, shouldUseCompressedProxy };
