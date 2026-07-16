'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { shouldLogClientEvent, truncateClientEventValue } = require('./clientEvents');

test('truncateClientEventValue normalizes whitespace and clamps length', () => {
  assert.equal(truncateClientEventValue('  hello\nworld\t!!  ', 8), 'hello wo');
});

test('shouldLogClientEvent logs download-click without extra flags', () => {
  assert.equal(shouldLogClientEvent('download-click', {}, false), true);
});

test('shouldLogClientEvent logs every event when debug is enabled', () => {
  assert.equal(shouldLogClientEvent('search-open', {}, true), true);
  assert.equal(shouldLogClientEvent('panel-toggle', { verboseNetworkLogs: false }, true), true);
});

test('shouldLogClientEvent does not use NSFW as the debug logging switch', () => {
  assert.equal(shouldLogClientEvent('search-open', { verboseNetworkLogs: false }, false), false);
});

test('shouldLogClientEvent respects verboseNetworkLogs when debug is off', () => {
  assert.equal(shouldLogClientEvent('search-open', { verboseNetworkLogs: true }, false), true);
  assert.equal(shouldLogClientEvent('search-open', { verboseNetworkLogs: false }, false), false);
});

test('shouldLogClientEvent respects persisted debug log level', () => {
  assert.equal(shouldLogClientEvent('search-open', { logLevel: 'debug' }, false), true);
  assert.equal(shouldLogClientEvent('search-open', { logLevel: 'info' }, false), false);
});
