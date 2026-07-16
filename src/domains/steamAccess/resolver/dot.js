'use strict';

const { queryDot } = require('../resolver.js');

function queryDotEndpoint(endpoint, hostname, qtype, timeoutMs) {
  return queryDot(endpoint, hostname, qtype === 'AAAA' ? 28 : 1, timeoutMs);
}

module.exports = { queryDotEndpoint };
