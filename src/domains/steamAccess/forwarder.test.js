'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { createSteamAccessForwarder, validateAuthorizedCertificate } = require('./forwarder');

function route() {
  return {
    hostname: 'steamcommunity.com',
    ips: ['1.2.3.4'],
    sniStrategies: [{ type: 'hidden', mode: 'hidden' }],
    policy: { protocols: ['h1'], requestBudget: { maxIps: 1, perIpTimeoutMs: 1000 } },
  };
}

test('expected HTTP redirect is returned immediately without penalizing or exhausting routes', async () => {
  let requests = 0;
  let routeFailures = 0;
  let poolFailures = 0;
  const connectionPool = {
    request: async () => {
      requests += 1;
      const response = new PassThrough();
      response.statusCode = 302;
      response.headers = { location: 'https://steamcommunity.com/profiles/76561198000000001/myworkshopfiles/' };
      return response;
    },
    markFailure: () => { poolFailures += 1; },
  };
  const forwarder = createSteamAccessForwarder({
    chooseRoute: async () => route(),
    connectionPool,
    markFailure: () => { routeFailures += 1; },
  });

  await assert.rejects(
    () => forwarder.request({ hostname: 'steamcommunity.com', path: '/my/myworkshopfiles/' }, null, 1000),
    error => error && error.redirectLocation && /\/profiles\//.test(error.redirectLocation)
  );
  assert.equal(requests, 1);
  assert.equal(routeFailures, 0);
  assert.equal(poolFailures, 0);
});

test('response-body ECONNRESET destroys the affected pooled connection', async () => {
  let poolFailures = 0;
  const response = new PassThrough();
  response.statusCode = 200;
  response.headers = { 'content-type': 'text/html' };
  const connectionPool = {
    request: async () => {
      setImmediate(() => response.destroy(Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' })));
      return response;
    },
    markFailure: () => { poolFailures += 1; },
  };
  const forwarder = createSteamAccessForwarder({
    chooseRoute: async () => route(),
    connectionPool,
    markFailure: () => {},
  });

  await assert.rejects(() => forwarder.request({ hostname: 'steamcommunity.com', path: '/' }, null, 1000), /ECONNRESET/);
  assert.equal(poolFailures, 1);
});

test('broadcast stream retries the next route after an upstream 5xx response', async () => {
  let attempts = 0;
  let failures = 0;
  let poolFailures = 0;
  const candidateRoute = route();
  candidateRoute.ips = ['1.2.3.4', '5.6.7.8'];
  candidateRoute.policy.requestBudget.maxIps = 2;
  const connectionPool = {
    request: async () => {
      attempts += 1;
      const response = new PassThrough();
      response.statusCode = attempts === 1 ? 504 : 200;
      response.headers = { 'content-type': 'application/dash+xml' };
      response.resume = () => response.destroy();
      return response;
    },
    markFailure: () => { poolFailures += 1; },
  };
  const forwarder = createSteamAccessForwarder({
    chooseRoute: async () => candidateRoute,
    connectionPool,
    markFailure: () => { failures += 1; },
  });

  const response = await forwarder.stream({ hostname: 'lv.queniujq.cn', path: '/broadcast/live/manifest/' }, null, 1000);

  assert.equal(response.statusCode, 200);
  assert.equal(attempts, 2);
  assert.equal(failures, 1);
  assert.equal(poolFailures, 1);
});

test('certificate-bound requests reject unauthorized TLS responses', async () => {
  const response = new PassThrough();
  response.statusCode = 200;
  response.headers = { 'content-type': 'text/html' };
  response.socket = {
    authorized: false,
    authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    getPeerCertificate: () => ({}),
  };
  const forwarder = createSteamAccessForwarder({
    chooseRoute: async () => route(),
    connectionPool: { request: async () => response, markFailure() {} },
    markFailure() {},
  });

  await assert.rejects(
    () => forwarder.request({
      hostname: 'steamcommunity.com',
      routeOptions: { requireAuthorizedCertificate: true, certificateHostname: 'steamcommunity.com' },
    }, null, 1000),
    /TLS certificate validation failed/
  );
});

test('hidden SNI accepts a trusted certificate after validating the intended hostname', () => {
  const certificate = {
    subject: { CN: 'store.steampowered.com' },
    subjectaltname: 'DNS:store.steampowered.com, DNS:steamcommunity.com',
  };
  const error = validateAuthorizedCertificate({
    authorized: false,
    authorizationError: 'ERR_TLS_CERT_ALTNAME_INVALID',
    getPeerCertificate: () => certificate,
  }, 'steamcommunity.com');

  assert.equal(error, undefined);
});

test('hidden SNI still rejects an untrusted chain or the wrong intended hostname', () => {
  const certificate = {
    subject: { CN: 'store.steampowered.com' },
    subjectaltname: 'DNS:store.steampowered.com, DNS:steamcommunity.com',
  };
  assert.match(validateAuthorizedCertificate({
    authorized: false,
    authorizationError: 'DEPTH_ZERO_SELF_SIGNED_CERT',
    getPeerCertificate: () => certificate,
  }, 'steamcommunity.com').message, /SELF_SIGNED/);
  assert.match(validateAuthorizedCertificate({
    authorized: false,
    authorizationError: 'ERR_TLS_CERT_ALTNAME_INVALID',
    getPeerCertificate: () => certificate,
  }, 'evil.example').message, /does not match/);
});
