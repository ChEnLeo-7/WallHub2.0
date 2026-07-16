'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanProcessLineForStage,
  stripWallhubDiagnosticOutput,
} = require('./depotTools');

test('stripWallhubDiagnosticOutput removes internal WALLHUB diagnostics while preserving real errors', () => {
  const raw = [
    'WALLHUB_DEPOT_BOOTSTRAP:main',
    "Logging 'tester' into Steam3...",
    'WALLHUB_STEAM3_API_BROKER:api.steampowered.com:/ISteamDirectory/GetCMListForConnect/v1/?format=vdf&cellid=0 WALLHUB_STEAM3_API_BROKER_REQUIRED:CMWebSocket',
    'Login Failure: InvalidPassword',
  ].join('\n');

  const cleaned = stripWallhubDiagnosticOutput(raw);

  assert.equal(/WALLHUB_/.test(cleaned), false);
  assert.match(cleaned, /Logging 'tester' into Steam3/);
  assert.match(cleaned, /Login Failure: InvalidPassword/);
});

test('cleanProcessLineForStage ignores WALLHUB diagnostic-only chunks', () => {
  assert.equal(cleanProcessLineForStage('WALLHUB_DEPOT_BOOTSTRAP:main\n'), '');
  assert.equal(
    cleanProcessLineForStage('WALLHUB_STEAM3_API_BROKER_REQUIRED:WebAPI\nConnecting to Steam3...\n'),
    'Connecting to Steam3...'
  );
});
