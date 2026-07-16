'use strict';

const http = require('http');
const https = require('https');
const tls = require('tls');

function wallhubProxyPort(target) {
  return target.port ? parseInt(target.port, 10) : (target.protocol === 'http:' ? 80 : 443);
}

function wallhubProxyAgentMapKey(protocol, hostname, port, extra = '') {
  return `${protocol || 'https:'}|${String(hostname || '').toLowerCase()}|${port || 443}|${extra}`;
}

function collectDetailedResponse(response, resolve, reject) {
  const buffers = [];
  response.on('data', data => buffers.push(Buffer.from(data)));
  response.on('end', () => resolve({
    statusCode: response.statusCode || 502,
    statusMessage: response.statusMessage || '',
    headers: response.headers || {},
    body: Buffer.concat(buffers),
  }));
  response.on('error', reject);
}

function bufferResponse(response) {
  return new Promise((resolve, reject) => collectDetailedResponse(response, resolve, reject));
}

function createWallhubProxyRequester(options = {}) {
  const directAgents = new Map();
  const gatewayAgents = new Map();
  const isSocksProxyProtocol = options.isSocksProxyProtocol || (() => false);
  const connectViaSocksProxy = options.connectViaSocksProxy;
  const proxyAuth = options.proxyAuth || (() => '');

  function getDirectAgent(target) {
    const protocol = target.protocol || 'https:';
    const port = wallhubProxyPort(target);
    const key = wallhubProxyAgentMapKey(protocol, target.hostname, port);
    let agent = directAgents.get(key);
    if (!agent) {
      const AgentClass = protocol === 'http:' ? http.Agent : https.Agent;
      agent = new AgentClass({
        keepAlive: true,
        maxSockets: 32,
        maxFreeSockets: 8,
        timeout: 30000,
        freeSocketTimeout: 30000,
      });
      directAgents.set(key, agent);
    }
    return agent;
  }

  function gatewayServername(target, gatewayOptions = {}) {
    if (gatewayOptions.sniMode === 'custom') return String(gatewayOptions.sniHostname || '');
    if (gatewayOptions.sniMode === 'original' || gatewayOptions.hiddenSni === false) return target.hostname;
    return '';
  }

  function gatewaySniKey(target, gatewayOptions = {}) {
    if (gatewayOptions.sniMode === 'custom') return `custom:${gatewayOptions.sniHostname || ''}`;
    if (gatewayOptions.sniMode === 'original' || gatewayOptions.hiddenSni === false) return 'original';
    return 'hidden';
  }

  function getGatewayAgent(target, gatewayIp, gatewayOptions = {}) {
    const port = wallhubProxyPort(target);
    const servername = gatewayServername(target, gatewayOptions);
    const key = wallhubProxyAgentMapKey('https:', gatewayIp, port, `${target.hostname}|${gatewaySniKey(target, gatewayOptions)}`);
    let agent = gatewayAgents.get(key);
    if (!agent) {
      agent = new https.Agent({
        keepAlive: true,
        maxSockets: 16,
        maxFreeSockets: 4,
        timeout: 30000,
        freeSocketTimeout: 30000,
        rejectUnauthorized: false,
        createConnection: (connectOptions, cb) => {
          let settled = false;
          const done = (err, socket) => {
            if (settled) return;
            settled = true;
            cb(err, socket);
          };
          const socket = tls.connect(Object.assign({}, connectOptions, {
            host: gatewayIp,
            servername,
            rejectUnauthorized: false,
          }), () => done(null, socket));
          socket.on('error', err => done(err));
          return socket;
        },
      });
      gatewayAgents.set(key, agent);
    }
    return agent;
  }

  // Core request dispatcher. `handleResponse` is invoked with the raw
  // http.IncomingMessage once response headers arrive. requestOnce buffers the
  // full body (needed for HTML/CSS/JSON rewriting and for the on-disk cache);
  // requestStream hands the response straight to the caller so large binary
  // bodies (video) can be piped to the client without buffering.
  function issueRequest(target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions, handleResponse) {
    const protocol = target.protocol;
    const port = wallhubProxyPort(target);
    const targetPath = target.pathname + target.search;
    const writeEnd = (request) => {
      request.on('timeout', () => request.destroy(new Error('Wallhub URL proxy timeout')));
      if (body && body.length && method !== 'GET' && method !== 'HEAD') request.write(body);
      request.end();
    };

    return new Promise((resolve, reject) => {
      const onResponse = response => handleResponse(response, resolve, reject);
      const onError = error => reject(error);
      if (gatewayIp) {
        const request = https.request({
          protocol: 'https:',
          hostname: gatewayIp,
          servername: gatewayServername(target, gatewayOptions),
          port,
          family: 4,
          path: targetPath,
          method,
          headers,
          timeout,
          rejectUnauthorized: false,
          agent: getGatewayAgent(target, gatewayIp, gatewayOptions),
        }, onResponse);
        request.on('error', onError);
        writeEnd(request);
        return;
      }
      if (!proxy) {
        const mod = protocol === 'http:' ? http : https;
        const request = mod.request({
          protocol,
          hostname: target.hostname,
          port,
          path: targetPath,
          method,
          headers,
          timeout,
          family: 4,
          agent: getDirectAgent(target),
        }, onResponse);
        request.on('error', onError);
        writeEnd(request);
        return;
      }
      if (isSocksProxyProtocol(proxy.protocol)) {
        connectViaSocksProxy(proxy, target.hostname, port, timeout)
          .then((socket) => {
            if (protocol === 'http:') {
              const request = http.request({
                hostname: target.hostname,
                port,
                path: targetPath,
                method,
                headers,
                createConnection: () => socket,
                agent: false,
                timeout,
              }, onResponse);
              request.on('error', onError);
              writeEnd(request);
              return;
            }
            const secureSocket = tls.connect({ socket, servername: target.hostname });
            secureSocket.on('error', onError);
            const request = https.request({
              hostname: target.hostname,
              port,
              path: targetPath,
              method,
              headers,
              createConnection: () => secureSocket,
              agent: false,
              timeout,
            }, onResponse);
            request.on('error', onError);
            writeEnd(request);
          })
          .catch(onError);
        return;
      }
      const auth = proxyAuth(proxy);
      if (protocol === 'http:') {
        const proxyHeaders = Object.assign({}, headers);
        if (auth) proxyHeaders['Proxy-Authorization'] = auth;
        const fullPath = `${protocol}//${target.host}${targetPath || '/'}`;
        const request = http.request({
          hostname: proxy.hostname,
          port: proxy.port || 80,
          method,
          path: fullPath,
          headers: proxyHeaders,
          timeout,
        }, onResponse);
        request.on('error', onError);
        writeEnd(request);
        return;
      }
      const connectHeaders = {};
      if (auth) connectHeaders['Proxy-Authorization'] = auth;
      const connectReq = http.request({
        hostname: proxy.hostname,
        port: proxy.port || 80,
        method: 'CONNECT',
        path: `${target.hostname}:${port}`,
        headers: connectHeaders,
        timeout,
      });
      connectReq.on('connect', (connectRes, socket) => {
        if (connectRes.statusCode !== 200) {
          socket.destroy();
          reject(new Error(`Proxy CONNECT ${connectRes.statusCode}`));
          return;
        }
        const secureSocket = tls.connect({ socket, servername: target.hostname });
        secureSocket.on('error', onError);
        const request = https.request({
          hostname: target.hostname,
          port,
          path: targetPath,
          method,
          headers,
          createConnection: () => secureSocket,
          agent: false,
          timeout,
        }, onResponse);
        request.on('error', onError);
        writeEnd(request);
      });
      connectReq.on('error', onError);
      connectReq.on('timeout', () => connectReq.destroy(new Error('Wallhub URL proxy timeout')));
      connectReq.end();
    });
  }

  function requestOnce(target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions = {}) {
    return issueRequest(target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions, collectDetailedResponse);
  }

  function requestStream(target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions = {}) {
    return issueRequest(target, method, headers, body, timeout, proxy, gatewayIp, gatewayOptions, (response, resolve) => resolve(response));
  }

  return {
    requestOnce,
    requestStream,
    getDirectAgent,
    getGatewayAgent,
  };
}

module.exports = {
  wallhubProxyPort,
  wallhubProxyAgentMapKey,
  collectDetailedResponse,
  bufferResponse,
  createWallhubProxyRequester,
};
