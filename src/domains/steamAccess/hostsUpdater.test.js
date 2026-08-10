'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  fetchText,
  isPublicAddress,
  resolvePublicTarget,
  createHostsUpdater,
} = require('./hostsUpdater');

function responseRequest({ statusCode = 200, headers = {}, body = '' } = {}) {
  return (_url, options, callback) => {
    const request = new EventEmitter();
    request.end = () => {
      const response = new PassThrough();
      response.statusCode = statusCode;
      response.headers = headers;
      callback(response);
      if (body !== null) response.end(body);
    };
    request.destroy = error => request.emit('error', error || new Error('destroyed'));
    request.options = options;
    return request;
  };
}

test('Hosts URL target validation rejects non-public IPv4 and IPv6 ranges', () => {
  for (const address of ['127.0.0.1', '10.0.0.1', '100.64.0.1', '169.254.169.254', '172.16.0.1', '192.0.0.1', '192.168.1.1', '224.0.0.1', '::1', 'fe80::1', 'fc00::1', '::ffff:127.0.0.1', '2001:db8::1', '2001:2::1', '2001:10::1', '2001:0000::1', '64:ff9b::1', '2002::1']) {
    assert.equal(isPublicAddress(address), false, address);
  }
  assert.equal(isPublicAddress('93.184.216.34'), true);
  assert.equal(isPublicAddress('2606:2800:220:1:248:1893:25c8:1946'), true);
});

test('Hosts URL resolution rejects mixed public and private DNS answers', async () => {
  await assert.rejects(
    () => resolvePublicTarget('example.com', {
      lookup: async () => [
        { address: '93.184.216.34', family: 4 },
        { address: '127.0.0.1', family: 4 },
      ],
    }),
    /non-public IP/
  );
});

test('Hosts fetch pins the request lookup to the validated DNS address', async () => {
  let requestOptions;
  const body = await fetchText('https://example.com/hosts', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: (url, options, callback) => {
      requestOptions = options;
      return responseRequest({ body: '1.2.3.4 steamcommunity.com' })(url, options, callback);
    },
  });
  assert.equal(body, '1.2.3.4 steamcommunity.com');
  assert.equal(requestOptions.agent, false);
  const pinned = await new Promise((resolve, reject) => requestOptions.lookup('example.com', {}, (error, address, family) => error ? reject(error) : resolve({ address, family })));
  assert.deepEqual(pinned, { address: '93.184.216.34', family: 4 });
  const pinnedAll = await new Promise((resolve, reject) => requestOptions.lookup('example.com', { all: true }, (error, addresses) => error ? reject(error) : resolve(addresses)));
  assert.deepEqual(pinnedAll, [{ address: '93.184.216.34', family: 4 }]);
});

test('HTTPS Hosts fetch rejects DNS answers when every address is non-public', async () => {
  let requestCalled = false;
  await assert.rejects(() => fetchText('https://example.com/hosts', {
    lookup: async () => [
      { address: '198.18.0.48', family: 4 },
      { address: 'fdfe:dcba:9876::30', family: 6 },
    ],
    request: () => {
      requestCalled = true;
      throw new Error('request should not start');
    },
  }), /non-public IP/);
  assert.equal(requestCalled, false);
});

test('Hosts target validation rejects literal and insecure non-public addresses', async () => {
  await assert.rejects(
    () => resolvePublicTarget('192.168.1.2'),
    /non-public IP/
  );
  await assert.rejects(
    () => resolvePublicTarget('example.com', {
      lookup: async () => [{ address: '10.20.30.40', family: 4 }],
    }),
    /non-public IP/
  );
});

test('Hosts fetch rejects credentials, redirects, oversized responses, and absolute timeouts', async () => {
  const lookup = async () => [{ address: '93.184.216.34', family: 4 }];
  await assert.rejects(() => fetchText('https://user:secret@example.com/hosts', { lookup }), /credentials/);
  await assert.rejects(() => fetchText('https://example.com/redirect', {
    lookup,
    request: responseRequest({ statusCode: 302, headers: { location: 'http://127.0.0.1/' } }),
  }), /redirects are not allowed/);
  await assert.rejects(() => fetchText('https://example.com/large', {
    lookup,
    maxBytes: 8,
    request: responseRequest({ headers: { 'content-length': '9' }, body: '123456789' }),
  }), /too large/);
  await assert.rejects(() => fetchText('https://example.com/slow', {
    timeoutMs: 10,
    lookup: () => new Promise(() => {}),
  }), /timeout/);
});

test('Hosts fetch destroys a rejected response instead of draining it indefinitely', async () => {
  let responseDestroyed = false;
  let requestDestroyed = false;
  const request = (_url, _options, callback) => {
    const req = new EventEmitter();
    req.end = () => {
      const response = new PassThrough();
      response.statusCode = 302;
      response.headers = { location: 'https://example.com/other' };
      response.on('error', () => {});
      response.destroy = () => { responseDestroyed = true; };
      callback(response);
    };
    req.destroy = () => { requestDestroyed = true; };
    return req;
  };
  await assert.rejects(() => fetchText('https://example.com/redirect', {
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request,
  }), /redirects are not allowed/);
  assert.equal(responseDestroyed, true);
  assert.equal(requestDestroyed, true);
});

test('Hosts updater rejects empty mappings and rolls back failed saves', async () => {
  let settings = { wallhubSteamAccessHosts: '1.1.1.1 old.example' };
  const original = JSON.parse(JSON.stringify(settings));
  const updater = createHostsUpdater({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: responseRequest({ body: '2.2.2.2 steamcommunity.com' }),
    getSettings: () => settings,
    applyPatch: patch => { settings = { ...settings, ...patch }; },
    saveSettings: () => false,
    restoreSettings: previous => { settings = previous; },
    logger: { warn() {} },
  });
  await assert.rejects(() => updater.fetchAndMaybeSave('https://example.com/hosts', true), /Failed to save/);
  assert.deepEqual(settings, original);

  const empty = createHostsUpdater({
    lookup: async () => [{ address: '93.184.216.34', family: 4 }],
    request: responseRequest({ body: '<html>not hosts</html>' }),
  });
  await assert.rejects(() => empty.fetchAndMaybeSave('https://example.com/hosts', false), /valid mappings/);
});
