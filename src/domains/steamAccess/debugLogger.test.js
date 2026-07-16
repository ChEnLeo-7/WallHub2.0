'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createSteamAccessDebugLogger, formatLogValue } = require('./debugLogger');

test('debug logger writes enabled messages to log file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-steam-log-'));
  const logger = createSteamAccessDebugLogger({
    configDir: dir,
    enabled: () => true,
    logger: { log() {}, warn() {}, error() {} },
  });

  logger.log('[SteamAccess:net] request ok host=api.steampowered.com');
  logger.warn('[SteamAccess] DOH failed', new Error('timeout'));
  logger.error('[SteamAccess] request failed');
  logger.network('[SteamAccess:net] pool h1 reused');
  await logger.flush();

  const text = fs.readFileSync(logger.filePath, 'utf8');
  assert.match(text, /request ok host=api\.steampowered\.com/);
  assert.match(text, /DOH failed/);
  assert.match(text, /timeout/);
  assert.match(text, /request failed/);
  assert.match(text, /pool h1 reused/);
});

test('debug logger skips file writes when disabled', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-steam-log-'));
  const logger = createSteamAccessDebugLogger({
    configDir: dir,
    enabled: () => false,
    logger: { log() {}, warn() {}, error() {} },
  });

  logger.warn('not written');
  await logger.flush();

  assert.equal(fs.existsSync(logger.filePath), false);
});

test('debug logger formats non-string values safely', () => {
  assert.equal(formatLogValue({ stage: 'dns' }), '{"stage":"dns"}');
  assert.match(formatLogValue(new Error('boom')), /boom/);
});
