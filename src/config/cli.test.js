'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseNsfwEnabledArg, parseDebugEnabledArg } = require('./cli');

test('parseNsfwEnabledArg accepts -nsfw and --nsfw only for content safety', () => {
  assert.equal(parseNsfwEnabledArg(['node', 'server.js', '-NSFW']), true);
  assert.equal(parseNsfwEnabledArg(['node', 'server.js', '--nsfw']), true);
  assert.equal(parseNsfwEnabledArg(['node', 'server.js', '-debug']), false);
});

test('parseDebugEnabledArg accepts -debug and --debug only for verbose diagnostics', () => {
  assert.equal(parseDebugEnabledArg(['node', 'server.js', '-debug']), true);
  assert.equal(parseDebugEnabledArg(['node', 'server.js', '--debug']), true);
  assert.equal(parseDebugEnabledArg(['node', 'server.js', '-DEBUG']), true);
  assert.equal(parseDebugEnabledArg(['node', 'server.js', '-NSFW']), false);
});
