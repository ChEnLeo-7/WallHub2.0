'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGatewayRequests } = require('./requests');

test('gateway request helpers preserve forwarding arguments', async () => {
  const calls = [];
  const requests = createGatewayRequests({
    forwarder: {
      request: async (...args) => {
        calls.push(['request', ...args]);
        return Buffer.from('body');
      },
      stream: async (...args) => {
        calls.push(['stream', ...args]);
        return 'response';
      },
    },
  });
  const opts = { hostname: 'steamcommunity.com' };
  const body = Buffer.from('request');

  assert.equal((await requests.request(opts, body, 1234)).toString(), 'body');
  assert.equal(await requests.requestStream(new URL('https://steamcommunity.com:8443/path?q=1'), 'POST', { Accept: 'text/plain' }, body, 4321), 'response');
  assert.deepEqual(calls, [
    ['request', opts, body, 1234],
    ['stream', {
      protocol: 'https:',
      hostname: 'steamcommunity.com',
      port: 8443,
      path: '/path?q=1',
      method: 'POST',
      headers: { Accept: 'text/plain' },
      timeout: 4321,
    }, body, 4321],
  ]);
});

test('gateway request stream reports invalid targets as promise rejections', async () => {
  const requests = createGatewayRequests({ forwarder: { stream() {} } });

  await assert.rejects(requests.requestStream(null), TypeError);
});
