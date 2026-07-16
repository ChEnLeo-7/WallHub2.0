'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createSteamProxyHeaderProfile } = require('./headerProfile');

test('header profile keeps stable identity encoding by default', () => {
  const profile = createSteamProxyHeaderProfile({ userAgent: 'WallHub' });
  const headers = profile.build({ headers: { accept: 'text/html', 'x-forwarded-for': '1.2.3.4' } }, new URL('https://steamcommunity.com/workshop/'), { referer: 'https://steamcommunity.com/' });

  assert.equal(headers['Accept-Encoding'], 'identity');
  assert.equal(headers['x-forwarded-for'], undefined);
  assert.equal(headers.Host, 'steamcommunity.com');
});

test('header profile can opt into compressed upstream responses', () => {
  const profile = createSteamProxyHeaderProfile({ getExperimental: () => ({ compressedProxy: true }) });
  const headers = profile.build({ headers: { 'user-agent': 'Browser', 'sec-fetch-mode': 'navigate' } }, new URL('https://store.steampowered.com/'), { referer: 'https://store.steampowered.com/' });

  assert.equal(headers['Accept-Encoding'], 'gzip, deflate, br');
  assert.equal(headers['sec-fetch-mode'], 'navigate');
});
