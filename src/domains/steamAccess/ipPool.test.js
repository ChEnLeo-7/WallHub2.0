'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const test = require('node:test');
const assert = require('node:assert/strict');
const { createIpPool } = require('./ipPool');

function tempPoolFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-ip-pool-'));
  return path.join(dir, 'pool.json');
}

test('ipPool records health state and cooldown after failures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-ip-pool-'));
  const pool = createIpPool({ configDir: dir, logger: { warn() {} } });
  pool.markProbeFailure('steamcommunity.com', '1.2.3.4', 'tls failed', { stage: 'tls', probeLevel: 'tls' });
  const record = pool.snapshot('steamcommunity.com').ips.find(item => item.ip === '1.2.3.4');
  assert.equal(record.state, 'UNSTABLE');
  assert.equal(record.lastFailureStage, 'tls');
  assert.equal(record.probeLevel, 'tls');
  assert.equal(record.cooldownUntil > Date.now(), true);
});

test('ipPool marks successful IPv6 as healthy and selectable', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-ip-pool-'));
  const pool = createIpPool({ configDir: dir, logger: { warn() {} } });
  pool.mergeHostIps('images.steamusercontent.com', ['2606:4700::1', '1.2.3.4'], 'resolver');
  pool.markProbeSuccess('images.steamusercontent.com', '2606:4700::1', { rttMs: 20, probeLevel: 'tls' });
  const active = pool.activeCandidates('images.steamusercontent.com', ['2606:4700::1', '1.2.3.4']);
  assert.equal(active[0].ip, '2606:4700::1');
});

test('ipPool prioritizes healthy application-probed IPv6 routes', () => {
  const pool = createIpPool({ filePath: tempPoolFile(), logger: { warn() {}, log() {} } });
  pool.mergeHostIps('api.steampowered.com', ['1.1.1.1', '2606:4700::1'], 'resolver');
  pool.markProbeSuccess('api.steampowered.com', '1.1.1.1', { rttMs: 10, probeLevel: 'tls' });
  pool.markProbeSuccess('api.steampowered.com', '2606:4700::1', { rttMs: 80, probeLevel: 'application' });

  const candidates = pool.activeCandidates('api.steampowered.com', []);

  assert.equal(candidates[0].ip, '2606:4700::1');
  const snapshot = pool.snapshot('api.steampowered.com');
  assert.equal(snapshot.ipv4, 1);
  assert.equal(snapshot.ipv6, 1);
});

test('ipPool keeps fresh untested candidates selectable when old routes are cooling', () => {
  const pool = createIpPool({ filePath: path.join(os.tmpdir(), `wallhub-ip-pool-${Date.now()}-${Math.random()}.json`), logger: { warn() {} } });

  pool.mergeHostIps('api.steampowered.com', ['1.1.1.1'], 'resolver');
  pool.markProbeFailure('api.steampowered.com', '1.1.1.1', 'timeout', { stage: 'timeout' });
  pool.mergeHostIps('api.steampowered.com', ['2.2.2.2'], 'resolver');

  const candidates = pool.activeCandidates('api.steampowered.com', []);

  assert.equal(candidates.some(item => item.ip === '2.2.2.2'), true);
  assert.equal(candidates.some(item => item.ip === '1.1.1.1' && item.cooldownUntil > Date.now()), false);
});

test('ipPool re-probes current resolver IPs when historical successful routes are all cooling', () => {
  const pool = createIpPool({ filePath: tempPoolFile(), logger: { warn() {} } });
  const host = 'lv.queniujq.cn';
  const ips = ['1.1.1.1', '2.2.2.2'];

  pool.mergeHostIps(host, ips, 'resolver');
  for (const ip of ips) {
    pool.markProbeSuccess(host, ip, { probeLevel: 'tls' });
    pool.markProbeFailure(host, ip, new Error('ECONNRESET'), { stage: 'reset' });
  }

  const candidates = pool.activeCandidates(host, ips);
  assert.deepEqual(candidates.map(item => item.ip).sort(), ips);
  assert.equal(candidates.every(item => !item.cooldownUntil), true);
});

test('ipPool promotes recent real WebAPI request success over probe-only routes', () => {
  const pool = createIpPool({ filePath: tempPoolFile(), logger: { warn() {}, log() {} } });
  pool.mergeHostIps('api.steampowered.com', ['184.87.199.210', '23.36.106.129'], 'resolver');
  for (let i = 0; i < 8; i++) {
    pool.markProbeSuccess('api.steampowered.com', '184.87.199.210', { rttMs: 80, probeLevel: 'application' });
  }
  pool.markProbeSuccess('api.steampowered.com', '23.36.106.129', {
    rttMs: 453,
    elapsedMs: 453,
    probeLevel: 'application',
    actualRequest: true,
    requestOk: true,
  });

  const candidates = pool.activeCandidates('api.steampowered.com', []);
  const record = pool.snapshot('api.steampowered.com').ips.find(item => item.ip === '23.36.106.129');

  assert.equal(candidates[0].ip, '23.36.106.129');
  assert.equal(record.requestOk, 1);
  assert.equal(record.requestRttMs, 453);
});
