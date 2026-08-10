'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  isSteamAccessGatewayHost,
  isSteamBroadcastResource,
} = require('./hosts');

test('broadcast media CDN hosts stay on the direct CDN path', () => {
  assert.equal(isSteamAccessGatewayHost('steambroadcast.akamaized.net'), false);
  assert.equal(isSteamAccessGatewayHost('steambroadcastchat.akamaized.net'), false);
  assert.equal(isSteamAccessGatewayHost('steamvideo-a.akamaihd.net'), false);
  assert.equal(isSteamAccessGatewayHost('video.akamai.steamstatic.com'), false);
});

test('broadcast resources are path-scoped for shared Steam content hosts', () => {
  assert.equal(isSteamBroadcastResource('cache1-sgp1.steamcontent.com', '/broadcast/123/master.m3u8'), true);
  assert.equal(isSteamBroadcastResource('cache1-sgp1.steamcontent.com', '/depot/431960/chunk'), false);
  assert.equal(isSteamBroadcastResource('steambroadcastchat.akamaized.net', '/chat/123/messages/0'), true);
  assert.equal(isSteamBroadcastResource('community.fastly.steamstatic.com', '/public/shared/javascript/dash_player.js'), true);
  assert.equal(isSteamBroadcastResource('random.akamaized.net', '/broadcast/123/master.m3u8'), false);
});
