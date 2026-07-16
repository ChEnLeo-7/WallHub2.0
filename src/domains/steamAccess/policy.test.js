'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createSteamAccessPolicyFactory,
  isBlockedFakeSni,
  normalizeFakeSniCandidates,
} = require('./policy');

test('policy keeps default SNI behavior when experiments are off', () => {
  const policyFactory = createSteamAccessPolicyFactory({
    enabled: () => true,
    directWebApi: () => false,
    isGatewayHost: () => true,
    getExperimental: () => ({}),
  });

  const community = policyFactory.forHost('steamcommunity.com');
  const webapi = policyFactory.forHost('api.steampowered.com');

  assert.equal(community.sniStrategies[0].type, 'hidden');
  assert.deepEqual(webapi.sniStrategies.map(item => item.type), ['hidden']);
  assert.deepEqual(webapi.protocols, ['h1']);
  assert.equal(webapi.probeLevel, 'application');
  assert.deepEqual(webapi.edgeAliases, ['api.steampowered.com.edgekey.net', 'api.steampowered.com.edgesuite.net']);
  assert.equal(webapi.requestBudget.perIpTimeoutMs, 8000);
  assert.equal(policyFactory.shouldUse({ protocol: 'https:', hostname: 'steamcommunity.com' }, null), true);
});

test('policy probes third-party Steam broadcast media with original SNI before hidden SNI', () => {
  const policyFactory = createSteamAccessPolicyFactory({
    enabled: () => true,
    directWebApi: () => false,
    isGatewayHost: () => true,
    getExperimental: () => ({}),
  });

  assert.deepEqual(policyFactory.forHost('lv.queniujq.cn').sniStrategies.map(item => item.type), ['original', 'hidden']);
  assert.deepEqual(policyFactory.forHost('broadcast.st.dl.eccdnx.com').sniStrategies.map(item => item.type), ['original', 'hidden']);
  assert.deepEqual(policyFactory.forHost('community.fastly.steamstatic.com').sniStrategies.map(item => item.type), ['original', 'hidden']);
});

test('policy can enable hidden and fake SNI fallback chain safely', () => {
  const policyFactory = createSteamAccessPolicyFactory({
    enabled: () => true,
    directWebApi: () => false,
    isGatewayHost: () => true,
    getExperimental: () => ({ hiddenSniForAll: true, fakeSniFallback: true, fakeSniCandidates: ['google.com', 'www.bing.com'] }),
  });

  const policy = policyFactory.forHost('steamcommunity.com');

  assert.deepEqual(policy.sniStrategies.map(item => item.type), ['hidden', 'fake', 'original']);
  assert.equal(policy.sniStrategies[1].hostname, 'www.bing.com');
  assert.equal(isBlockedFakeSni('sub.youtube.com'), true);
  assert.deepEqual(normalizeFakeSniCandidates(['telegram.org', 'api.github.com']), ['api.github.com']);
});

test('policy keeps WebAPI h1 hidden even when h2 experiment is enabled', () => {
  const policyFactory = createSteamAccessPolicyFactory({
    enabled: () => true,
    directWebApi: () => false,
    isGatewayHost: () => true,
    getExperimental: () => ({ http2Enabled: true, fakeSniFallback: true }),
  });

  const policy = policyFactory.forHost('api.steampowered.com');

  assert.deepEqual(policy.sniStrategies.map(item => item.type), ['hidden']);
  assert.deepEqual(policy.protocols, ['h1']);
});

test('policy disables WebAPI gateway when direct WebAPI is configured', () => {
  const policyFactory = createSteamAccessPolicyFactory({
    enabled: () => true,
    directWebApi: () => true,
    isGatewayHost: () => true,
  });

  assert.equal(policyFactory.forHost('api.steampowered.com').enhanceEnabled, false);
  assert.equal(policyFactory.shouldUse({ protocol: 'https:', hostname: 'api.steampowered.com' }, null), false);
});

test('policy exposes per-host connection reuse control for static CDN hosts', () => {
  const policyFactory = createSteamAccessPolicyFactory({
    enabled: () => true,
    directWebApi: () => false,
    isGatewayHost: () => true,
    reuseConnectionForHost: host => host !== 'images.steamusercontent.com',
    getExperimental: () => ({ http2Enabled: true }),
  });

  const policy = policyFactory.forHost('images.steamusercontent.com');

  assert.equal(policy.connectionReuseEnabled, false);
  assert.deepEqual(policy.protocols, ['h1']);
});

test('policy lets account-sensitive requests disable connection reuse per request', () => {
  const policyFactory = createSteamAccessPolicyFactory({
    enabled: () => true,
    directWebApi: () => false,
    isGatewayHost: () => true,
  });

  const policy = policyFactory.forHost('steamcommunity.com', { connectionReuse: false });
  assert.equal(policy.connectionReuseEnabled, false);
});
