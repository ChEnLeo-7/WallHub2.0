'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  cleanProcessLineForStage,
  isDepotGuardRequiredMessage,
  isDepotNetworkFailureMessage,
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

test('isDepotNetworkFailureMessage recognizes SteamKit connection failures before auth hints', () => {
  for (const message of [
    'Login failed: NoConnection; Steam Guard mobile authenticator may be required',
    'CM connection failed: ConnectFailed',
    'Steam returned ServiceUnavailable',
    'System.Net.Http.HttpRequestException: The operation was canceled',
    'System.Threading.Tasks.TaskCanceledException: A task was cancelled',
  ]) {
    assert.equal(isDepotNetworkFailureMessage(message), true, message);
  }
  assert.equal(isDepotNetworkFailureMessage('Login Failure: InvalidPassword'), false);
  assert.equal(isDepotNetworkFailureMessage('Steam Guard authentication code required'), false);
});

test('isDepotGuardRequiredMessage requires an explicit Steam challenge', () => {
  for (const message of [
    'STEAM GUARD! Please enter your 2-factor auth code from your authenticator app:',
    'This account is protected by Steam Guard.',
    'Unable to login to Steam3: AccountLoginDeniedNeedTwoFactor',
    'Please enter the authentication code sent to your email address:',
    'Use the Steam Mobile App to confirm your sign in',
  ]) {
    assert.equal(isDepotGuardRequiredMessage(message), true, message);
  }
  for (const message of [
    'mobile authenticator may be required',
    'authenticator unavailable after a network failure',
    'Error: InitializeSteam failed',
    'Login Failure: InvalidPassword',
  ]) {
    assert.equal(isDepotGuardRequiredMessage(message), false, message);
  }
});
