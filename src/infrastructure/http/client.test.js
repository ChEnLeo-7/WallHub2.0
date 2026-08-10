'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildCurlRequestArgs, redactUrlPathForLog, createHttpClient } = require('./client');

test('redactUrlPathForLog hides Steam Web API key', () => {
  const path = '/IPublishedFileService/QueryFiles/v1/?key=abcdef&format=json';
  assert.equal(redactUrlPathForLog(path), '/IPublishedFileService/QueryFiles/v1/?key=<redacted>&format=json');
});

test('buildCurlRequestArgs uses curl cookie engine for redirects', () => {
  const args = buildCurlRequestArgs({
    protocol: 'https:',
    hostname: 'steamcommunity.com',
    path: '/workshop/browse/',
    method: 'GET',
    headers: {
      Cookie: 'birthtime=1; steamLoginSecure=secure',
      Accept: 'text/html',
    },
  }, null, 22000, null, {});

  assert.equal(args.includes('--location'), true);
  assert.equal(args.includes('--cookie'), true);
  assert.equal(args[args.indexOf('--cookie') + 1], 'birthtime=1; steamLoginSecure=secure');
  assert.equal(args.some(arg => arg === 'Cookie: birthtime=1; steamLoginSecure=secure'), false);
});

test('GET forwards private Steam route controls to gateway without leaking them as HTTP headers', async () => {
  let captured = null;
  const client = createHttpClient({
    getProxyCandidates: () => [null],
    shouldUseGateway: () => true,
    requestByGateway: async (opts) => {
      captured = opts;
      return Buffer.from('ok');
    },
  });

  const routeOptions = { requireApplicationProbe: true, connectionReuse: false };
  const body = await client.get('https://steamcommunity.com/my/myworkshopfiles/', {
    Cookie: 'steamLoginSecure=secure',
    steamAccessRouteOptions: routeOptions,
  });

  assert.equal(body.toString('utf8'), 'ok');
  assert.deepEqual(captured.routeOptions, routeOptions);
  assert.equal(Object.prototype.hasOwnProperty.call(captured.headers, 'steamAccessRouteOptions'), false);
});

test('GET forwards the private SteamAccess bypass flag without leaking it as an HTTP header', async () => {
  let captured = null;
  const client = createHttpClient({
    getProxyCandidates: () => [null],
    shouldUseGateway: opts => { captured = opts; return true; },
    requestByGateway: async () => Buffer.from('gateway'),
  });

  await client.get('https://steamcommunity.com/', { wallhubDisableSteamAccessGateway: true });

  assert.equal(captured.disableSteamAccessGateway, true);
  assert.equal(Object.prototype.hasOwnProperty.call(captured.headers, 'wallhubDisableSteamAccessGateway'), false);
});

test('gateway redirects preserve request policy controls', async () => {
  const requests = [];
  const controller = new AbortController();
  const routeOptions = { requireApplicationProbe: true };
  const client = createHttpClient({
    getProxyCandidates: () => [null],
    shouldUseGateway: () => true,
    requestByGateway: async (opts) => {
      requests.push(opts);
      if (requests.length === 1) {
        throw Object.assign(new Error('redirect'), { redirectLocation: '/redirected' });
      }
      return Buffer.from('ok');
    },
  });

  const body = await client.get('https://steamcommunity.com/start', {
    signal: controller.signal,
    steamAccessRouteOptions: routeOptions,
    wallhubDisableCurlProxy: true,
    wallhubDisableSteamAccessGateway: true,
  });

  assert.equal(body.toString('utf8'), 'ok');
  assert.equal(requests.length, 2);
  assert.equal(requests[1].path, '/redirected');
  assert.equal(requests[1].signal, controller.signal);
  assert.equal(requests[1].disableCurlProxy, true);
  assert.equal(requests[1].disableSteamAccessGateway, true);
  assert.deepEqual(requests[1].routeOptions, routeOptions);
});
