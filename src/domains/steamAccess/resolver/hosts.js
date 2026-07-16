'use strict';

const { parseHostsText, selectHostsRoute } = require('../hostsCompat');

function resolveHostsText(hostsText, hostname) {
  const selected = selectHostsRoute(parseHostsText(hostsText), String(hostname || '').toLowerCase());
  if (!selected) return { ips: [], protocol: 'hosts', source: 'hosts-miss', endpoints: [], answers: [], resolverHealth: [] };
  const recordType = selected.family === 6 ? 'AAAA' : 'A';
  return {
    ips: [selected.ip],
    protocol: 'hosts',
    source: selected.source,
    endpoints: [selected.matchedHost],
    answers: [{
      ip: selected.ip,
      data: selected.ip,
      family: selected.family,
      endpoint: selected.matchedHost,
      resolver: selected.matchedHost,
      type: recordType,
      recordType,
      source: 'hosts',
      elapsedMs: 0,
      confidence: 1,
    }],
    resolverHealth: [],
  };
}

module.exports = { resolveHostsText };
