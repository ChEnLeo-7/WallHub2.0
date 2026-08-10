'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSteamCdnStatusStore, extractSteamContentHosts } = require('./steamCdnStatus');

test('extractSteamContentHosts excludes Steam CM control hosts', () => {
  const hosts = extractSteamContentHosts([
    'Connecting to cm1-sha1.cm.steampowered.com:443',
    'Using content server steamcdn-a.akamaihd.net:443',
    'Connecting to cmp1-lhr1.steamserver.net:443',
  ].join('\n'));

  assert.deepEqual(hosts, [
    { host: 'steamcdn-a.akamaihd.net', port: 443 },
  ]);
});

test('CDN status store ignores a control-plane host passed directly from process output', () => {
  const store = createSteamCdnStatusStore();

  assert.equal(store.update({ host: 'cmp1-lhr1.steamserver.net', port: 443 }), null);
  assert.equal(store.snapshot().currentHost, '');
});
