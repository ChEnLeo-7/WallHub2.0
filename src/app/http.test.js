'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { cors } = require('./http');

test('CORS keeps wildcard access enabled', () => {
  const headers = new Map();
  cors({ setHeader: (name, value) => headers.set(name, value) });

  assert.equal(headers.get('Access-Control-Allow-Origin'), '*');
  assert.equal(headers.get('Access-Control-Allow-Methods'), 'GET,POST,OPTIONS');
  assert.equal(headers.get('Access-Control-Allow-Headers'), 'Content-Type');
});
