'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { applicationProbeOk } = require('./probe');
const { httpProbePath, shouldHttpProbeHost, shouldProbeSteamAccessIpv6 } = require('./routes');

test('application probe validates Steam community-like HTML', () => {
  assert.equal(applicationProbeOk('steamcommunity.com', 200, { 'content-type': 'text/html' }, '<html>Steam Community Workshop</html>'), true);
  assert.equal(applicationProbeOk('steamcommunity.com', 200, { 'content-type': 'text/html' }, 'blocked'), false);
  assert.equal(applicationProbeOk('steamcommunity.com', 200, { 'content-type': 'text/html' }, '<html>Workshop</html>'), false);
});

test('application probe accepts lightweight WebAPI JSON', () => {
  assert.equal(applicationProbeOk('api.steampowered.com', 200, { 'content-type': 'application/json' }, '{}'), true);
  assert.equal(applicationProbeOk('api.steampowered.com', 200, { 'content-type': 'text/html' }, '<html>Steam</html>'), false);
  assert.equal(applicationProbeOk('api.steampowered.com', 404, { 'content-type': 'application/json' }, '{}'), false);
  assert.equal(applicationProbeOk('community.steam-api.com', 405, { 'content-type': 'application/json' }, '{}'), false);
  assert.equal(applicationProbeOk('api.steampowered.com', 503, { 'content-type': 'application/json' }, '{}'), false);
});

test('application probe policy covers core web hosts', () => {
  assert.equal(shouldHttpProbeHost('api.steampowered.com'), true);
  assert.equal(shouldHttpProbeHost('steamcommunity.com'), true);
  assert.equal(shouldHttpProbeHost('store.steampowered.com'), true);
  assert.equal(shouldHttpProbeHost('images.steamusercontent.com'), false);
  assert.equal(httpProbePath('api.steampowered.com'), '/ISteamWebAPIUtil/GetSupportedAPIList/v1/?format=json');
  assert.equal(httpProbePath('store.steampowered.com'), '/app/431960');
});

test('IPv6 probing is enabled for core Steam access hosts', () => {
  assert.equal(shouldProbeSteamAccessIpv6('api.steampowered.com'), true);
  assert.equal(shouldProbeSteamAccessIpv6('steamcommunity.com'), true);
  assert.equal(shouldProbeSteamAccessIpv6('store.steampowered.com'), true);
});
