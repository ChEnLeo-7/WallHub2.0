'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createGatewayRouteSelection } = require('./routeSelection');

test('forced Depot resolution bypasses hosts mode without changing default resolution', async () => {
  const resolverCalls = [];
  const routeSelection = createGatewayRouteSelection({
    currentMode: () => 'hosts',
    getHostsText: () => '203.0.113.10 steamcommunity.com',
    getResolverProtocol: () => 'doh',
    getExperimental: () => ({}),
    endpointSelectors: () => ({ selectedDohEndpoints: ['https://resolver.test/resolve'] }),
    isStaticCdnHost: () => false,
    resolveHostsText: (text, host) => ({ ips: text.includes(host) ? ['203.0.113.10'] : [], protocol: 'hosts', endpoints: [] }),
    resolver: {
      resolveHost: async (host, options) => {
        resolverCalls.push({ host, options });
        return { ips: ['198.51.100.20'], answers: [], endpoints: ['https://resolver.test/resolve'], protocol: 'doh' };
      },
    },
    policyFactory: {
      forHost: () => ({ edgeAliases: [], preferredFamilies: [4], requestBudget: { minPoolSize: 4 } }),
    },
    metrics: { recordResolve() {} },
    debugLogger: { warn() {}, log() {} },
  });

  const normal = await routeSelection.resolveForHost('steamcommunity.com');
  const forced = await routeSelection.resolveForHost('dl.steam.clngaa.com', { forceResolver: true });

  assert.deepEqual(normal.ips, ['203.0.113.10']);
  assert.deepEqual(forced.ips, ['198.51.100.20']);
  assert.equal(forced.protocol, 'doh');
  assert.deepEqual(resolverCalls.map(call => call.host), ['dl.steam.clngaa.com']);
});
