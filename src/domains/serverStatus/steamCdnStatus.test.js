'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { extractSteamContentHosts } = require('./steamCdnStatus');

test('extractSteamContentHosts recognizes Steam CDN rule domains', () => {
  const hosts = extractSteamContentHosts([
    'Connecting to cm1-sha1.cm.steampowered.com:443',
    'Using content server steamcdn-a.akamaihd.net:443',
    'CDN host cache8-hkg1.steamserver.net:80',
  ].join('\n'));

  assert.deepEqual(hosts, [
    { host: 'cache8-hkg1.steamserver.net', port: 80 },
    { host: 'steamcdn-a.akamaihd.net', port: 443 },
    { host: 'cm1-sha1.cm.steampowered.com', port: 443 },
  ]);
});
