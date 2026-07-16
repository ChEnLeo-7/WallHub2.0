'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { dohEndpointUrl, parseDnsRecords } = require('./resolver');
const { createResolver } = require('./resolver/multiSource');
const { resolveHostsText } = require('./resolver/hosts');

test('DoH endpoint URL encodes hostname and record type', () => {
  const url = new URL(dohEndpointUrl('https://dns.alidns.com/resolve', 'steamcommunity.com', 'AAAA'));
  assert.equal(url.searchParams.get('name'), 'steamcommunity.com');
  assert.equal(url.searchParams.get('type'), 'AAAA');
});

test('hosts resolver returns forced route metadata', () => {
  const result = resolveHostsText('1.2.3.4 steamcommunity.com', 'steamcommunity.com');
  assert.deepEqual(result.ips, ['1.2.3.4']);
  assert.equal(result.protocol, 'hosts');
  assert.equal(result.answers[0].recordType, 'A');
});

test('parseDnsRecords rejects invalid DNS response', () => {
  assert.throws(() => parseDnsRecords(Buffer.from([1, 2, 3])), /invalid DNS response/);
});

test('selected DoH endpoints are exclusive in fastest mode', () => {
  const resolver = createResolver({
    dohEndpoints: ['https://cloudflare-dns.com/resolve', 'https://dns.alidns.com/resolve'],
    logger: { warn() {}, log() {} },
  });

  const endpoints = resolver.resolveSelectedEndpoints('doh', {
    dohMode: 'fastest',
    dohEndpoint: 'https://cloudflare-dns.com/resolve',
    selectedDohEndpoints: ['https://dns.alidns.com/resolve'],
  });

  assert.deepEqual(endpoints, ['https://dns.alidns.com/resolve']);
});
