'use strict';

const http = require('http');
const https = require('https');
const tls = require('tls');
const { spawn } = require('child_process');
const { URL } = require('url');

function buildUrlFromOpts(opts) {
  const protocol = opts.protocol || 'https:';
  const port = opts.port ? `:${opts.port}` : '';
  return `${protocol}//${opts.hostname}${port}${opts.path || '/'}`;
}

function redactUrlPathForLog(pathname) {
  return String(pathname || '/').replace(/([?&]key=)[^&]*/ig, '$1<redacted>');
}

function buildCurlRequestArgs(opts, body, timeout, proxy, helpers = {}) {
  const appendCurlProxyArgs = helpers.appendCurlProxyArgs || (() => {});
  const url = buildUrlFromOpts(opts);
  const args = [
    '--silent',
    '--show-error',
    '--location',
    '--max-time', String(Math.max(1, Math.ceil((timeout || 22000) / 1000))),
    '--request', opts.method || 'GET',
    '--url', url,
    '--output', '-',
    '--write-out', '\n__WALLHUB_HTTP_CODE__:%{http_code}',
  ];
  if (process.platform === 'win32' && process.env.WALLHUB_CURL_CHECK_REVOKE !== '1') {
    args.push('--ssl-no-revoke');
  }
  if (opts.insecureCurl) args.push('--insecure');
  appendCurlProxyArgs(args, proxy);
  const headers = opts.headers || {};
  for (const [key, value] of Object.entries(headers)) {
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
    const curlEnv = stripProxyEnv(process.env);
    const cp = spawn(curlCommand, args, { windowsHide: true, env: curlEnv });
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
      if (httpCode < 200 || httpCode >= 300) return reject(new Error(`HTTP ${httpCode || 502} ${opts.hostname}${redactUrlPathForLog(opts.path || '/')}`));
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

function createHttpClient(options = {}) {
  const helpers = Object.assign({ logger: console }, options);
  const getProxyCandidates = helpers.getProxyCandidates || (() => [null]);
  const shouldRetryWithNextProxy = helpers.shouldRetryWithNextProxy || (() => false);
  const isSocksProxyProtocol = helpers.isSocksProxyProtocol || (() => false);
  const connectViaSocksProxy = helpers.connectViaSocksProxy;
  const proxyAuth = helpers.proxyAuth || (() => '');
  const steamAccessFallbackTimeoutMs = Number(process.env.WALLHUB_STEAM_ACCESS_FALLBACK_TIMEOUT_MS || helpers.steamAccessFallbackTimeoutMs || 8000);
  const isSteamAccessFallbackHost = typeof helpers.isSteamAccessFallbackHost === 'function' ? helpers.isSteamAccessFallbackHost : () => false;
  const steamAccessGatewayEnabled = typeof helpers.steamAccessGatewayEnabled === 'function' ? helpers.steamAccessGatewayEnabled : () => false;

  function doRequest(opts, body, redirects, proxyIndex) {
    const redirectCount = redirects || 0;
    const currentProxyIndex = proxyIndex || 0;
    const protocol = opts.protocol || 'https:';
    const baseTimeout = opts.timeout || 22000;
    const shouldClampSteamAccessFallback = steamAccessGatewayEnabled() && isSteamAccessFallbackHost(opts.hostname);
    const timeout = shouldClampSteamAccessFallback
      ? Math.min(baseTimeout, steamAccessFallbackTimeoutMs)
      : baseTimeout;
    const proxies = getProxyCandidates(protocol, opts.hostname);
    const proxy = proxies[Math.min(currentProxyIndex, proxies.length - 1)];
    const attemptTimeout = proxy ? Math.min(timeout, 12000) : timeout;
    if (currentProxyIndex === 0 && typeof helpers.shouldUseGateway === 'function' && helpers.shouldUseGateway(opts, proxy)) {
      return helpers.requestByGateway(opts, body, timeout).catch((err) => {
        if (err && err.redirectLocation) {
          if (redirectCount >= 3) throw new Error('Too many redirects');
          const loc = /^https?:\/\//i.test(err.redirectLocation)
            ? err.redirectLocation
            : `${protocol}//${opts.hostname}${err.redirectLocation}`;
          const u = new URL(loc);
          return doRequest({
            protocol: u.protocol,
            hostname: u.hostname,
            port: u.port ? parseInt(u.port, 10) : undefined,
            path: u.pathname + u.search,
            method: 'GET',
            headers: opts.headers,
            timeout,
            disableSteamAccessGateway: opts.disableSteamAccessGateway,
            routeOptions: opts.routeOptions,
          }, null, redirectCount + 1, 0);
        }
        if (process.env.WALLHUB_STEAM_ACCESS_FALLBACK_NORMAL === '0') {
          helpers.logger.warn(`[SteamAccess] ${opts.hostname} gateway failed, normal fallback disabled: ${err.message}`);
          throw err;
        }
        helpers.logger.warn(`[SteamAccess] ${opts.hostname} gateway failed, fallback to normal request: ${err.message}`);
        const fallbackTimeout = Math.min(timeout, Number(process.env.WALLHUB_STEAM_ACCESS_FALLBACK_TIMEOUT_MS || helpers.steamAccessFallbackTimeoutMs || 8000));
        return doRequest(Object.assign({}, opts, { disableSteamAccessGateway: true, timeout: fallbackTimeout }), body, redirectCount, currentProxyIndex);
      });
    }
    if (process.env.WALLHUB_DISABLE_CURL_PROXY !== '1' && !opts.disableCurlProxy) {
      return doRequestByCurlCascade(opts, body, attemptTimeout, proxies, currentProxyIndex, Object.assign({}, helpers, { shouldRetryWithNextProxy }));
    }
    return new Promise((resolve, reject) => {
      const retryNext = (err) => {
        if (shouldRetryWithNextProxy(err) && currentProxyIndex + 1 < proxies.length) {
          return doRequest(opts, body, redirectCount, currentProxyIndex + 1).then(resolve).catch(reject);
        }
        reject(err);
      };

      const onResponse = (response) => {
        if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location) {
          response.resume();
          if (redirectCount >= 3) return reject(new Error('Too many redirects'));
          let loc = response.headers.location;
          if (!/^https?:\/\//i.test(loc)) loc = `${protocol}//${opts.hostname}${loc}`;
          try {
            const u = new URL(loc);
            return doRequest({
              protocol: u.protocol,
              hostname: u.hostname,
              port: u.port ? parseInt(u.port, 10) : undefined,
              path: u.pathname + u.search,
              method: 'GET',
              headers: opts.headers,
              timeout,
              routeOptions: opts.routeOptions,
            }, null, redirectCount + 1, 0).then(resolve).catch(reject);
          } catch (error) {
            return reject(error);
          }
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
          response.resume();
          return reject(new Error(`HTTP ${response.statusCode} ${opts.hostname}${redactUrlPathForLog(opts.path || '/')}`));
        }
        const buffers = [];
        response.on('data', data => buffers.push(data));
        response.on('end', () => resolve(Buffer.concat(buffers)));
        response.on('error', retryNext);
      };
      const onError = (error) => retryNext(error);
      const writeEnd = (request) => {
        if (opts.signal) {
          if (opts.signal.aborted) {
            request.destroy(Object.assign(new Error('Request aborted'), { code: 'ABORT_ERR' }));
            return;
          }
          opts.signal.addEventListener('abort', () => request.destroy(Object.assign(new Error('Request aborted'), { code: 'ABORT_ERR' })), { once: true });
        }
        request.on('error', onError);
        request.on('timeout', () => request.destroy(new Error('Timeout')));
        if (body) request.write(body);
        request.end();
      };

      if (!proxy) {
        const mod = protocol === 'http:' ? http : https;
        const request = mod.request({
          protocol,
          hostname: opts.hostname,
          port: opts.port || (protocol === 'http:' ? 80 : 443),
          path: opts.path,
          method: opts.method || 'GET',
          headers: opts.headers || {},
          timeout: attemptTimeout,
        }, onResponse);
        writeEnd(request);
        return;
      }
      if (isSocksProxyProtocol(proxy.protocol)) {
        connectViaSocksProxy(proxy, opts.hostname, opts.port || (protocol === 'http:' ? 80 : 443), attemptTimeout)
          .then((socket) => {
            if (protocol === 'http:') {
              const request = http.request({
                hostname: opts.hostname,
                port: opts.port || 80,
                path: opts.path,
                method: opts.method || 'GET',
                headers: opts.headers || {},
                createConnection: () => socket,
                agent: false,
                timeout: attemptTimeout,
              }, onResponse);
              writeEnd(request);
              return;
            }
            const secureSocket = tls.connect({ socket, servername: opts.hostname });
            secureSocket.on('error', onError);
            const request = https.request({
              hostname: opts.hostname,
              port: opts.port || 443,
              path: opts.path,
              method: opts.method || 'GET',
              headers: opts.headers || {},
              createConnection: () => secureSocket,
              agent: false,
              timeout: attemptTimeout,
            }, onResponse);
            writeEnd(request);
          })
          .catch(onError);
        return;
      }
      const auth = proxyAuth(proxy);
      if (protocol === 'http:') {
        const headers = Object.assign({}, opts.headers || {});
        if (auth) headers['Proxy-Authorization'] = auth;
        const fullPath = `${protocol}//${opts.hostname}${opts.port ? `:${opts.port}` : ''}${opts.path || '/'}`;
        const request = http.request({
          hostname: proxy.hostname,
          port: proxy.port || 80,
          method: opts.method || 'GET',
          path: fullPath,
          headers,
          timeout: attemptTimeout,
        }, onResponse);
        writeEnd(request);
        return;
      }

      const connectHeaders = {};
      if (auth) connectHeaders['Proxy-Authorization'] = auth;
      const connectReq = http.request({
        hostname: proxy.hostname,
        port: proxy.port || 80,
        method: 'CONNECT',
        path: `${opts.hostname}:${opts.port || 443}`,
        headers: connectHeaders,
        timeout: attemptTimeout,
      });

      connectReq.on('connect', (res, socket) => {
        if (res.statusCode !== 200) {
          socket.destroy();
          return reject(new Error(`Proxy CONNECT ${res.statusCode}`));
        }
        const secureSocket = tls.connect({ socket, servername: opts.hostname });
        secureSocket.on('error', onError);
        const request = https.request({
          hostname: opts.hostname,
          port: opts.port || 443,
          path: opts.path,
          method: opts.method || 'GET',
          headers: opts.headers || {},
          createConnection: () => secureSocket,
          agent: false,
          timeout: attemptTimeout,
        }, onResponse);
        writeEnd(request);
      });
      connectReq.on('error', onError);
      connectReq.on('timeout', () => connectReq.destroy(new Error('Timeout')));
      connectReq.end();
    });
  }

  function get(url, extra, timeout) {
    const u = new URL(url);
    const extraHeaders = Object.assign({}, extra || {});
    const signal = extraHeaders.signal;
    delete extraHeaders.signal;
    const disableCurlProxy = !!extraHeaders.wallhubDisableCurlProxy;
    delete extraHeaders.wallhubDisableCurlProxy;
    const routeOptions = extraHeaders.steamAccessRouteOptions;
    delete extraHeaders.steamAccessRouteOptions;
    const baseHeaders = {
      'User-Agent': helpers.userAgent || 'WallHub',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Accept-Encoding': 'identity',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    };
    const headers = Object.assign(baseHeaders, extraHeaders);
    const extraCookie = String(extraHeaders.Cookie || extraHeaders.cookie || '').trim();
    const baseCookie = String(helpers.steamPrefCookie || '').trim();
    delete headers.cookie;
    if (baseCookie || extraCookie) headers.Cookie = [baseCookie, extraCookie].filter(Boolean).join('; ');
    return doRequest({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port ? parseInt(u.port, 10) : undefined,
      path: u.pathname + u.search,
      method: 'GET',
      headers,
      timeout: timeout || 22000,
      signal,
      routeOptions,
      disableCurlProxy,
    });
  }

  function post(url, body, timeout, extra = {}) {
    const u = new URL(url);
    const buf = Buffer.from(body, 'utf8');
    const extraHeaders = Object.assign({}, extra || {});
    const signal = extraHeaders.signal;
    delete extraHeaders.signal;
    const routeOptions = extraHeaders.steamAccessRouteOptions;
    delete extraHeaders.steamAccessRouteOptions;
    return doRequest({
      protocol: u.protocol,
      hostname: u.hostname,
      port: u.port ? parseInt(u.port, 10) : undefined,
      path: u.pathname + u.search,
      method: 'POST',
      headers: Object.assign({
        'User-Agent': helpers.userAgent || 'WallHub',
        'Accept-Encoding': 'identity',
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': buf.length,
      }, extraHeaders),
      timeout: timeout || 22000,
      signal,
      routeOptions,
    }, buf);
  }

  return {
    doRequest,
    get,
    post,
  };
}

module.exports = {
  buildUrlFromOpts,
  redactUrlPathForLog,
  buildCurlRequestArgs,
  doRequestByCurl,
  isCurlTlsVerifyError,
  shouldRetryCurlInsecure,
  doRequestByCurlCascade,
  createHttpClient,
};
