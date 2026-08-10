'use strict';

const path = require('node:path');
const { createRequire } = require('node:module');
const test = require('node:test');
const assert = require('node:assert/strict');

const { assembleBootstrapHelpers } = require('./bootstrapHelpers');

function createScope() {
  const projectRoot = path.resolve(__dirname, '../../..');
  const rootRequire = createRequire(path.join(projectRoot, 'server.js'));
  const scope = {
    require: rootRequire,
    RUNTIME_TUNING: { PROXY: { maxDisplaySpeedBytes: 1024 * 1024 } },
    getSteamCdnRouteStrategy: () => 'nearest',
    applySteamHttpProxyEnv: env => Object.assign({}, env),
    buildSteamAuthEnv: env => Object.assign({}, env),
  };
  assembleBootstrapHelpers(scope);
  return scope;
}

test('child processes do not inherit internal Steam bridge credentials by default', async () => {
  const scope = createScope();
  const result = await scope.runProcess(process.execPath, ['-e', [
    'const keys = Object.keys(process.env)',
    '  .filter(key => key.startsWith("WALLHUB_DEPOT_RESOLVER_") || key.startsWith("WALLHUB_DEPOT_WEBAPI_BROKER_"));',
    'process.stdout.write(JSON.stringify(keys));',
  ].join('\n')], 10000, {
    env: {
      WALLHUB_DEPOT_RESOLVER_URL: 'http://127.0.0.1/internal-resolver',
      WALLHUB_DEPOT_RESOLVER_TOKEN: 'resolver-token',
      WALLHUB_DEPOT_WEBAPI_BROKER_URL: 'http://127.0.0.1/internal-broker',
      WALLHUB_DEPOT_WEBAPI_BROKER_TOKEN: 'broker-token',
    },
  });

  assert.deepEqual(JSON.parse(result.out), []);
});

test('Steam authentication child environment only receives explicitly rebuilt bridge settings', async () => {
  const scope = createScope();
  scope.buildSteamAuthEnv = env => Object.assign({}, env, {
    WALLHUB_DEPOT_RESOLVER_URL: 'http://127.0.0.1/enabled-resolver',
    WALLHUB_DEPOT_RESOLVER_TOKEN: 'enabled-token',
  });
  const result = await scope.runProcess(process.execPath, ['-e', [
    'const values = {',
    '  resolverUrl: process.env.WALLHUB_DEPOT_RESOLVER_URL || "",',
    '  resolverToken: process.env.WALLHUB_DEPOT_RESOLVER_TOKEN || "",',
    '  brokerUrl: process.env.WALLHUB_DEPOT_WEBAPI_BROKER_URL || "",',
    '  brokerToken: process.env.WALLHUB_DEPOT_WEBAPI_BROKER_TOKEN || "",',
    '};',
    'process.stdout.write(JSON.stringify(values));',
  ].join('\n')], 10000, {
    steamAuth: true,
    env: {
      WALLHUB_DEPOT_RESOLVER_URL: 'stale-resolver',
      WALLHUB_DEPOT_RESOLVER_TOKEN: 'stale-token',
      WALLHUB_DEPOT_WEBAPI_BROKER_URL: 'stale-broker',
      WALLHUB_DEPOT_WEBAPI_BROKER_TOKEN: 'stale-broker-token',
    },
  });

  assert.deepEqual(JSON.parse(result.out), {
    resolverUrl: 'http://127.0.0.1/enabled-resolver',
    resolverToken: 'enabled-token',
    brokerUrl: '',
    brokerToken: '',
  });
});
