'use strict';

const http = require('http');
const https = require('https');
const tls = require('tls');

function createRemoteVideoStreamProxy(deps = {}) {
  const {
    userAgent,
    getRemoteVideoStream,
    updateSteamCdnStatus,
    cleanupRemoteVideoStreams,
    extFromUrl,
    mimeFromExt,
    getProxyCandidates,
    isSocksProxyProtocol,
    connectViaSocksProxy,
    proxyAuth,
    jsonRes,
  } = deps;

  function proxy(req, res, token) {
    const entry = getRemoteVideoStream(token);
    if (!entry || !entry.url) return jsonRes(res, 404, { error: 'Remote video stream expired' });
    let upstream;
    try { upstream = new URL(entry.url); }
    catch { return jsonRes(res, 400, { error: 'Invalid remote video URL' }); }

    updateSteamCdnStatus({
      host: upstream.hostname,
      port: upstream.port ? parseInt(upstream.port, 10) : 443,
      source: 'remote',
      mode: 'steamkit'
    });
    cleanupRemoteVideoStreams();

    const headers = {
      'User-Agent': userAgent,
      'Accept': '*/*',
      'Accept-Encoding': 'identity',
      'Referer': `https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(entry.id || '')}`,
    };
    if (req.headers.range) headers.Range = req.headers.range;

    const opts = {
      protocol: upstream.protocol,
      hostname: upstream.hostname,
      port: upstream.port ? parseInt(upstream.port, 10) : undefined,
      path: upstream.pathname + upstream.search,
      method: 'GET',
      headers,
      timeout: 45000,
    };
    const proxies = getProxyCandidates(opts.protocol, opts.hostname);
    const selectedProxy = proxies[0];

    const pipeResponse = (upstreamRes) => {
      if (upstreamRes.statusCode >= 300 && upstreamRes.statusCode < 400 && upstreamRes.headers.location) {
        upstreamRes.resume();
        entry.url = new URL(upstreamRes.headers.location, entry.url).toString();
        return proxy(req, res, token);
      }
      if (upstreamRes.statusCode < 200 || upstreamRes.statusCode >= 300) {
        upstreamRes.resume();
        return jsonRes(res, upstreamRes.statusCode || 502, { error: `Remote video HTTP ${upstreamRes.statusCode || 502}` });
      }
      const ext = entry.ext || extFromUrl(entry.url, '.mp4');
      const outHeaders = {
        'Content-Type': upstreamRes.headers['content-type'] || mimeFromExt(ext) || 'application/octet-stream',
        'Accept-Ranges': upstreamRes.headers['accept-ranges'] || 'bytes',
        'Cache-Control': 'no-store',
      };
      if (upstreamRes.headers['content-length']) outHeaders['Content-Length'] = upstreamRes.headers['content-length'];
      if (upstreamRes.headers['content-range']) outHeaders['Content-Range'] = upstreamRes.headers['content-range'];
      if (upstreamRes.headers['last-modified']) outHeaders['Last-Modified'] = upstreamRes.headers['last-modified'];
      if (upstreamRes.headers.etag) outHeaders.ETag = upstreamRes.headers.etag;
      res.writeHead(upstreamRes.statusCode, outHeaders);
      upstreamRes.pipe(res);
    };

    const onError = (error) => {
      if (!res.headersSent) jsonRes(res, 502, { error: error.message || 'Remote video stream failed' });
      else res.destroy(error);
    };
    const writeEnd = (request) => {
      request.on('error', onError);
      request.on('timeout', () => request.destroy(new Error('Remote video timeout')));
      req.on('close', () => request.destroy());
      request.end();
    };

    if (!selectedProxy) {
      const mod = opts.protocol === 'http:' ? http : https;
      return writeEnd(mod.request({
        protocol: opts.protocol,
        hostname: opts.hostname,
        port: opts.port || (opts.protocol === 'http:' ? 80 : 443),
        path: opts.path,
        method: 'GET',
        headers: opts.headers,
        timeout: opts.timeout,
      }, pipeResponse));
    }

    if (isSocksProxyProtocol(selectedProxy.protocol)) {
      connectViaSocksProxy(selectedProxy, opts.hostname, opts.port || (opts.protocol === 'http:' ? 80 : 443), Math.min(opts.timeout, 20000))
        .then((socket) => {
          if (opts.protocol === 'http:') {
            return writeEnd(http.request({
              hostname: opts.hostname,
              port: opts.port || 80,
              path: opts.path,
              method: 'GET',
              headers: opts.headers,
              createConnection: () => socket,
              agent: false,
              timeout: opts.timeout,
            }, pipeResponse));
          }
          const secureSocket = tls.connect({ socket, servername: opts.hostname });
          secureSocket.on('error', onError);
          return writeEnd(https.request({
            hostname: opts.hostname,
            port: opts.port || 443,
            path: opts.path,
            method: 'GET',
            headers: opts.headers,
            createConnection: () => secureSocket,
            agent: false,
            timeout: opts.timeout,
          }, pipeResponse));
        })
        .catch(onError);
      return;
    }

    const auth = proxyAuth(selectedProxy);
    if (opts.protocol === 'http:') {
      const proxyHeaders = Object.assign({}, opts.headers);
      if (auth) proxyHeaders['Proxy-Authorization'] = auth;
      return writeEnd(http.request({
        hostname: selectedProxy.hostname,
        port: selectedProxy.port || 80,
        method: 'GET',
        path: `${opts.protocol}//${opts.hostname}${opts.port ? `:${opts.port}` : ''}${opts.path}`,
        headers: proxyHeaders,
        timeout: Math.min(opts.timeout, 20000),
      }, pipeResponse));
    }

    const connectHeaders = {};
    if (auth) connectHeaders['Proxy-Authorization'] = auth;
    const connectReq = http.request({
      hostname: selectedProxy.hostname,
      port: selectedProxy.port || 80,
      method: 'CONNECT',
      path: `${opts.hostname}:${opts.port || 443}`,
      headers: connectHeaders,
      timeout: Math.min(opts.timeout, 20000),
    });
    connectReq.on('connect', (connectRes, socket) => {
      if (connectRes.statusCode !== 200) {
        socket.destroy();
        return onError(new Error(`Proxy CONNECT ${connectRes.statusCode}`));
      }
      const secureSocket = tls.connect({ socket, servername: opts.hostname });
      secureSocket.on('error', onError);
      writeEnd(https.request({
        hostname: opts.hostname,
        port: opts.port || 443,
        path: opts.path,
        method: 'GET',
        headers: opts.headers,
        createConnection: () => secureSocket,
        agent: false,
        timeout: opts.timeout,
      }, pipeResponse));
    });
    connectReq.on('error', onError);
    connectReq.on('timeout', () => connectReq.destroy(new Error('Proxy CONNECT timeout')));
    connectReq.end();
  }

  return { proxy };
}

module.exports = {
  createRemoteVideoStreamProxy,
};
