'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { createWallhubUrlProxyTools, isExtensionlessBroadcastMediaManifest } = require('./urlProxy');
const { isSteamBroadcastResource } = require('../steam/hosts');

function responseStream(statusCode = 200) {
  const stream = new PassThrough();
  stream.statusCode = statusCode;
  stream.headers = { 'content-type': 'application/octet-stream' };
  return stream;
}

function createTools(calls) {
  return createWallhubUrlProxyTools({
    isSteamHost: () => true,
    isSteamAccessGatewayHost: () => false,
    isSteamAccessStaticBypassHost: () => false,
    isSteamBroadcastResource,
    gatewayEnabled: () => true,
    requestByGatewayStream: async () => {
      calls.gateway += 1;
      return responseStream();
    },
    requestStream: async () => {
      calls.direct += 1;
      return responseStream();
    },
    getProxyCandidates: () => [null],
    cache: {
      pathsFor: () => ({}),
      read: async () => null,
      write: async () => {},
      cleanupSoon: () => {},
      cleanup: async () => {},
    },
  });
}

test('extensionless broadcast MPD uses the media-manifest rewriter', () => {
  const target = new URL('https://cache5-hkg1.steamcontent.com/broadcast/123/manifest/0/cache5-hkg1.steamcontent.com/');
  assert.equal(isExtensionlessBroadcastMediaManifest('<?xml version="1.0"?><MPD><Period /></MPD>', target), true);
  assert.equal(isExtensionlessBroadcastMediaManifest('<MPD><Period /></MPD>', new URL('https://cache5-hkg1.steamcontent.com/depot/123')), false);
});

test('URL proxy sends only broadcast paths on steamcontent.com through SteamAccess', async () => {
  const calls = { gateway: 0, direct: 0 };
  const tools = createTools(calls);

  await tools.requestUrl(new URL('https://cache1-sgp1.steamcontent.com/broadcast/123/master.m3u8'), 'GET', {}, null);
  await tools.requestUrl(new URL('https://cache1-sgp1.steamcontent.com/depot/431960/chunk'), 'GET', {}, null);

  assert.deepEqual(calls, { gateway: 1, direct: 1 });
});

test('URL proxy enhances Steam broadcast player assets and chat polling', async () => {
  const calls = { gateway: 0, direct: 0 };
  const tools = createTools(calls);

  await tools.requestUrl(new URL('https://community.fastly.steamstatic.com/public/shared/javascript/dash_player.js'), 'GET', {}, null);
  await tools.requestUrl(new URL('https://steambroadcastchat.akamaized.net/chat/123/messages/0'), 'GET', {}, null);

  assert.deepEqual(calls, { gateway: 2, direct: 0 });
});

test('URL proxy normalizes private WallHub origins before forwarding Steam WebAPI calls', () => {
  const tools = createWallhubUrlProxyTools({
    isSteamHost: (host) => host === 'steamcommunity.com' || host === 'api.steampowered.com',
    isWebApiServiceTarget: () => true,
  });
  const target = new URL('https://api.steampowered.com/IPlayerService/GetPlayerLinkDetails/v1?origin=http%3A%2F%2F10.133.141.41%3A3090');

  tools.normalizeSteamApiOrigin(target, 'http://10.133.141.41:3090/broadcast/watch/1?__whp_host=steamcommunity.com');

  assert.equal(target.searchParams.get('origin'), 'https://steamcommunity.com');
});
