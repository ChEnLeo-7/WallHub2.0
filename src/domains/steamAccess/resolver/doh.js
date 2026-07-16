'use strict';

const { URL } = require('url');
const { queryDohWire, queryDohJson, dohEndpointUrl } = require('../resolver.js');

function isWireDohEndpoint(endpoint) {
  const parsed = new URL(endpoint);
  return /\/dns-query(?:$|[/?#])/i.test(parsed.pathname);
}

async function queryDohEndpoint(endpoint, hostname, qtype, userAgent, timeoutMs) {
  return isWireDohEndpoint(endpoint)
    ? queryDohWire(endpoint, hostname, qtype === 'AAAA' ? 28 : qtype === 'HTTPS' || qtype === 'SVCB' || qtype === 65 ? 65 : 1, userAgent, timeoutMs)
    : queryDohJson(endpoint, hostname, qtype, userAgent, timeoutMs);
}

module.exports = { dohEndpointUrl, isWireDohEndpoint, queryDohEndpoint };
