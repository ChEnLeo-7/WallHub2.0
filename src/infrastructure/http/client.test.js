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
