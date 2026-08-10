'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isSteamCdnHost, isSteamEnhancedHost, networkMode } = require('./networkPolicy');

test('classifies Steam business hosts for built-in enhancement', () => {
  assert.equal(isSteamEnhancedHost('api.steampowered.com'), true);
  assert.equal(isSteamEnhancedHost('login.steampowered.com'), true);
  assert.equal(isSteamEnhancedHost('partner.steampowered.com'), true);
  assert.equal(isSteamEnhancedHost('example.com'), false);
});

test('classifies Steam CDN hosts as direct data-plane hosts', () => {
  assert.equal(isSteamCdnHost('cache1-hkg1.steamcontent.com'), true);
  assert.equal(isSteamCdnHost('st.dl.eccdnx.com'), true);
  assert.equal(isSteamCdnHost('xz.pphimalayanrt.com'), true);
  assert.equal(isSteamCdnHost('dl.steam.clngaa.com'), true);
  assert.equal(isSteamEnhancedHost('shared.akamai.steamstatic.com'), false);
});

test('network mode gives an explicit proxy precedence', () => {
  assert.equal(networkMode('api.steampowered.com', { enhancementEnabled: true }), 'enhanced');
  assert.equal(networkMode('api.steampowered.com', { enhancementEnabled: true, proxyConfigured: true }), 'proxy');
  assert.equal(networkMode('example.com', { enhancementEnabled: true }), 'direct');
});
