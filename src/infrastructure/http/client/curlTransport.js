'use strict';

const { spawn } = require('child_process');
const { buildUrlFromOpts, redactUrlPathForLog } = require('./shared');

function buildCurlRequestArgs(opts, body, timeout, proxy, helpers = {}) {
  const appendCurlProxyArgs = helpers.appendCurlProxyArgs || (() => {});
  const args = [
    '--silent',
    '--show-error',
    '--location',
    '--max-time', String(Math.max(1, Math.ceil((timeout || 22000) / 1000))),
    '--request', opts.method || 'GET',
    '--url', buildUrlFromOpts(opts),
    '--output', '-',
    '--write-out', '\n__WALLHUB_HTTP_CODE__:%{http_code}',
  ];
  if (process.platform === 'win32' && process.env.WALLHUB_CURL_CHECK_REVOKE !== '1') {
    args.push('--ssl-no-revoke');
  }
  if (opts.insecureCurl) args.push('--insecure');
  appendCurlProxyArgs(args, proxy);
  for (const [key, value] of Object.entries(opts.headers || {})) {
    if (value === undefined || value === null || value === '') continue;
    if (String(key).toLowerCase() === 'cookie') {
      args.push('--cookie', String(value));
      continue;
    }
    args.push('-H', `${key}: ${String(value)}`);
  }
  if (body && String(opts.method || 'GET').toUpperCase() !== 'GET') {
    const payload = Buffer.isBuffer(body) ? body.toString('utf8') : String(body);
    args.push('--data-binary', payload);
  }
  return args;
}

function doRequestByCurl(opts, body, timeout, proxy, helpers = {}) {
  return new Promise((resolve, reject) => {
    if (opts && opts.signal && opts.signal.aborted) {
      reject(Object.assign(new Error('Request aborted'), { code: 'ABORT_ERR' }));
      return;
    }
    const stripProxyEnv = helpers.stripProxyEnv || ((env) => Object.assign({}, env));
    const args = buildCurlRequestArgs(opts, body, timeout, proxy, helpers);
    const curlCommand = process.platform === 'win32' ? 'curl.exe' : 'curl';
    const cp = spawn(curlCommand, args, { windowsHide: true, env: stripProxyEnv(process.env) });
    const abort = () => {
      try { cp.kill(); } catch {}
      reject(Object.assign(new Error('Request aborted'), { code: 'ABORT_ERR' }));
    };
    if (opts && opts.signal) opts.signal.addEventListener('abort', abort, { once: true });
    const chunks = [];
    let err = '';
    cp.stdout.on('data', data => chunks.push(Buffer.from(data)));
    cp.stderr.on('data', data => { err += data.toString(); });
    cp.on('error', error => {
      if (opts && opts.signal) opts.signal.removeEventListener('abort', abort);
      reject(error);
    });
    cp.on('close', code => {
      if (opts && opts.signal) opts.signal.removeEventListener('abort', abort);
      if (opts && opts.signal && opts.signal.aborted) return;
      const raw = Buffer.concat(chunks);
      const marker = Buffer.from('\n__WALLHUB_HTTP_CODE__:', 'utf8');
      const idx = raw.lastIndexOf(marker);
      const codeText = idx >= 0 ? raw.subarray(idx + marker.length).toString('utf8').trim() : '';
      const httpCode = idx >= 0 ? parseInt(codeText, 10) : 0;
      const responseBody = idx >= 0 ? raw.subarray(0, idx) : raw;
      if (code !== 0) return reject(new Error((err || `curl exit ${code}`).trim().slice(-1200)));
      if (httpCode < 200 || httpCode >= 300) {
        return reject(new Error(`HTTP ${httpCode || 502} ${opts.hostname}${redactUrlPathForLog(opts.path || '/')}`));
      }
      resolve(responseBody);
    });
  });
}

function isCurlTlsVerifyError(err) {
  const message = String(err && err.message || '');
  return /curl:\s*\(60\)|certificate|SSL: no alternative certificate subject name|unable to get local issuer|self-signed|verify the legitimacy/i.test(message);
}

function shouldRetryCurlInsecure(opts, err, helpers = {}) {
  if (opts && opts.insecureCurl) return false;
  if (!isCurlTlsVerifyError(err)) return false;
  const mode = String(process.env.WALLHUB_STEAMCOMMUNITY_INSECURE_TLS || 'auto').trim().toLowerCase();
  if (mode === '0' || mode === 'off' || mode === 'false') return false;
  if (mode === '1' || mode === 'on' || mode === 'true') return true;
  const host = String(opts && opts.hostname || '').toLowerCase();
  const isSteamCommunity = host === 'steamcommunity.com' || host.endsWith('.steamcommunity.com');
  if (!isSteamCommunity) return false;
  if (typeof helpers.isAndroidHostLikeEnv === 'function' && helpers.isAndroidHostLikeEnv()) return true;
  return process.platform === 'linux' && /no alternative certificate subject name|target host name/i.test(String(err && err.message || ''));
}

function doRequestByCurlCascade(opts, body, timeout, proxies, idx, helpers = {}) {
  const index = idx || 0;
  const proxy = proxies[Math.min(index, proxies.length - 1)];
  const shouldRetryWithNextProxy = helpers.shouldRetryWithNextProxy || (() => false);
  const logger = helpers.logger || console;
  return doRequestByCurl(opts, body, timeout, proxy, helpers).catch((error) => {
    if (shouldRetryCurlInsecure(opts, error, helpers)) {
      logger.warn(`[HTTP] curl TLS verification failed for ${opts.hostname}; retrying with --insecure on this request`);
      return doRequestByCurl(Object.assign({}, opts, { insecureCurl: true }), body, timeout, proxy, helpers);
    }
    if (shouldRetryWithNextProxy(error) && index + 1 < proxies.length) {
      return doRequestByCurlCascade(opts, body, timeout, proxies, index + 1, helpers);
    }
    throw error;
  });
}

module.exports = {
  buildCurlRequestArgs,
  doRequestByCurl,
  isCurlTlsVerifyError,
  shouldRetryCurlInsecure,
  doRequestByCurlCascade,
};
