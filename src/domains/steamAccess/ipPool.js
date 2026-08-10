'use strict';

const fs = require('fs');
const path = require('path');
const net = require('net');
const { builtinIpsForHost, hostProfile, isCoreHost } = require('./routes');
const { ROUTE_HEALTH } = require('./routeTypes');
const { nextHealthState, cooldownMsForState } = require('./healthState');

const DEFAULT_FILENAME = 'steam-access-ip-pool.json';
const DEFAULT_TARGET_MIN = 10;

function now() {
  return Date.now();
}

function createEmptyState() {
  return {
    version: 1,
    updatedAt: 0,
    hosts: {},
  };
}

function cloneRecord(record) {
  return Object.assign({
    ip: '',
    source: 'builtin',
    ok: 0,
    fail: 0,
    consecutiveFail: 0,
    lastOkAt: 0,
    lastFailAt: 0,
    cooldownUntil: 0,
    rttMs: 0,
    lastProbeAt: 0,
    state: ROUTE_HEALTH.UNKNOWN,
    probeLevel: '',
    requestOk: 0,
    lastRequestOkAt: 0,
    requestRttMs: 0,
    lastFailureStage: '',
    lastFailureReason: '',
    suspect: false,
    akamaiCidrMatched: undefined,
  }, record || {});
}

function createIpPool(options = {}) {
  const logger = options.logger || console;
  const configDir = options.configDir || process.cwd();
  const filePath = options.filePath || path.join(configDir, DEFAULT_FILENAME);
  const persistenceEnabled = options.persistenceEnabled !== false;
  let state = createEmptyState();
  let saveScheduled = null;

  function ensureHost(hostname) {
    const host = String(hostname || '').trim().toLowerCase();
    if (!state.hosts[host]) {
      state.hosts[host] = {
        targetMin: isCoreHost(host) ? DEFAULT_TARGET_MIN : 4,
        lastRefreshAt: 0,
        nextRefreshAt: 0,
        lastError: '',
        ips: [],
      };
    }
    return state.hosts[host];
  }

  function load() {
    if (!persistenceEnabled) return state;
    try {
      if (!fs.existsSync(filePath)) return state;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      state = createEmptyState();
      state.version = Number(parsed.version || 1);
      state.updatedAt = Number(parsed.updatedAt || 0);
      const hosts = parsed && parsed.hosts && typeof parsed.hosts === 'object' ? parsed.hosts : {};
      for (const [host, value] of Object.entries(hosts)) {
        const entry = ensureHost(host);
        entry.targetMin = Math.max(1, Number(value && value.targetMin || entry.targetMin || DEFAULT_TARGET_MIN));
        entry.lastRefreshAt = Number(value && value.lastRefreshAt || 0);
        entry.nextRefreshAt = Number(value && value.nextRefreshAt || 0);
        entry.lastError = String(value && value.lastError || '');
        entry.ips = Array.isArray(value && value.ips) ? value.ips.map(cloneRecord).filter(item => item.ip) : [];
      }
    } catch (error) {
      logger.warn('[SteamAccess] Failed to load IP pool:', error.message);
      state = createEmptyState();
    }
    return state;
  }

  function saveNow() {
    if (!persistenceEnabled) return;
    state.updatedAt = now();
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  }

  function scheduleSave() {
    if (!persistenceEnabled) return;
    if (saveScheduled) return;
    saveScheduled = setTimeout(() => {
      saveScheduled = null;
      try { saveNow(); } catch (error) { logger.warn('[SteamAccess] Failed to save IP pool:', error.message); }
    }, 100);
    saveScheduled.unref?.();
  }

  function cooldownMsFor(consecutiveFail) {
    const state = consecutiveFail >= 3 ? ROUTE_HEALTH.DEAD : ROUTE_HEALTH.UNSTABLE;
    return cooldownMsForState(state, consecutiveFail);
  }

  function failureKind(error, meta = {}) {
    const stage = String(meta.stage || '').toLowerCase();
    const message = String(error && error.message || error || '').toLowerCase();
    if (stage === 'reset' || message.includes('econnreset') || message.includes('socket hang up')) return 'reset';
    if (stage === 'timeout' || message.includes('timeout') || message.includes('etimedout')) return 'timeout';
    if (stage === 'application' || message.includes('application')) return 'application-failed';
    return stage || 'request-failed';
  }

  function stateForRecord(record) {
    if (record.cooldownUntil && record.cooldownUntil > now()) {
      return nextHealthState(record, 'observe');
    }
    if (Number(record.ok || 0) > 0 && Number(record.consecutiveFail || 0) === 0) return ROUTE_HEALTH.HEALTHY;
    if (record.lastProbeAt) return ROUTE_HEALTH.UNSTABLE;
    return ROUTE_HEALTH.UNKNOWN;
  }

  function mergeHostIps(hostname, incoming = [], source = 'resolver') {
    const entry = ensureHost(hostname);
    const map = new Map(entry.ips.map(item => [item.ip, cloneRecord(item)]));
    for (const raw of incoming) {
      const ip = String(raw || '').trim();
      if (!ip) continue;
      const current = map.get(ip) || cloneRecord({ ip, source });
      current.ip = ip;
      current.source = current.source === 'history' ? 'history' : source;
      map.set(ip, current);
    }
    entry.ips = Array.from(map.values());
    scheduleSave();
    return entry.ips;
  }

  function builtinRecordsForHost(hostname) {
    return builtinIpsForHost(hostname).map(ip => cloneRecord({ ip, source: 'builtin' }));
  }

  function prioritizedCandidates(hostname, resolvedIps = []) {
    const host = String(hostname || '').trim().toLowerCase();
    const entry = ensureHost(host);
    const out = [];
    const seen = new Set();
    const push = (record) => {
      const ip = String(record && record.ip || '').trim();
      if (!ip || seen.has(ip)) return;
      seen.add(ip);
      out.push(cloneRecord(record));
    };
    entry.ips
      .filter(item => item.ok > 0 || item.source === 'history' || (Number(item.fail || 0) === 0 && !item.cooldownUntil))
      .sort((a, b) => (b.ok || 0) - (a.ok || 0) || (a.rttMs || 999999) - (b.rttMs || 999999))
      .forEach(push);
    resolvedIps.map(ip => cloneRecord({ ip, source: 'resolver' })).forEach(push);
    builtinRecordsForHost(host).forEach(push);
    return out;
  }

  function probeLevelRank(level) {
    const normalized = String(level || '').toLowerCase();
    if (normalized === 'stress') return 5;
    if (normalized === 'application') return 4;
    if (normalized === 'http') return 3;
    if (normalized === 'tls') return 2;
    if (normalized === 'tcp') return 1;
    return 0;
  }

  function candidateScore(record) {
    const healthyIpv6Bonus = net.isIP(record.ip) === 6 && Number(record.ok || 0) > 0 ? 250 : 0;
    const applicationProbeBonus = probeLevelRank(record.probeLevel) >= 4 && Number(record.ok || 0) > 0 ? 180 : 0;
    const recentBonus = record.lastOkAt ? Math.max(0, 200 - Math.floor((now() - record.lastOkAt) / 60_000)) : 0;
    const requestBonus = Number(record.requestOk || 0) > 0 ? 1200 + Math.min(500, Number(record.requestOk || 0) * 80) : 0;
    const requestRecentBonus = record.lastRequestOkAt ? Math.max(0, 400 - Math.floor((now() - record.lastRequestOkAt) / 30_000)) : 0;
    const bestRtt = Number(record.requestRttMs || 0) > 0 ? Number(record.requestRttMs || 0) : Number(record.rttMs || 0);
    const rttPenalty = bestRtt ? Math.min(300, Math.floor(bestRtt / 10)) : 80;
    return Number(record.ok || 0) * 100 + requestBonus + requestRecentBonus + healthyIpv6Bonus + applicationProbeBonus + recentBonus - Number(record.consecutiveFail || 0) * 150 - rttPenalty;
  }

  function activeCandidates(hostname, resolvedIps = []) {
    const host = String(hostname || '').trim().toLowerCase();
    const entry = ensureHost(host);
    const min = entry.targetMin || (isCoreHost(host) ? DEFAULT_TARGET_MIN : 4);
    const candidates = prioritizedCandidates(host, resolvedIps);
    const currentTime = now();
    const active = candidates
      .filter(item => !item.cooldownUntil || item.cooldownUntil <= currentTime)
      .sort((a, b) => candidateScore(b) - candidateScore(a));
    if (active.length || !resolvedIps.length) return active.slice(0, Math.max(min, candidates.length));

    // A refreshed DNS answer can legitimately repeat an IP that has historical
    // success data but is currently cooling. Do not turn that into zero socket
    // attempts forever: hand the just-resolved addresses to the caller for one
    // bounded fresh probe while preserving the historical cooldown record.
    const fresh = [];
    const seen = new Set();
    for (const raw of resolvedIps) {
      const ip = String(raw || '').trim();
      if (!ip || seen.has(ip)) continue;
      seen.add(ip);
      fresh.push(cloneRecord({ ip, source: 'resolver' }));
    }
    return fresh.slice(0, Math.max(min, fresh.length));
  }

  function markProbeSuccess(hostname, ip, meta = {}) {
    const entry = ensureHost(hostname);
    const map = new Map(entry.ips.map(item => [item.ip, cloneRecord(item)]));
    const current = map.get(ip) || cloneRecord({ ip, source: meta.source || 'history' });
    current.ip = ip;
    current.source = current.source === 'builtin' && meta.source ? meta.source : current.source;
    current.ok = Number(current.ok || 0) + 1;
    current.consecutiveFail = 0;
    current.lastOkAt = now();
    current.lastProbeAt = current.lastOkAt;
    current.cooldownUntil = 0;
    current.state = nextHealthState(current, 'success');
    current.probeLevel = meta.probeLevel || meta.level || current.probeLevel || 'tls';
    if (meta.actualRequest || meta.requestOk) {
      current.requestOk = Number(current.requestOk || 0) + 1;
      current.lastRequestOkAt = current.lastOkAt;
      current.requestRttMs = Number(meta.rttMs || meta.elapsedMs || current.requestRttMs || current.rttMs || 0);
      current.source = 'history';
    }
    current.lastFailureStage = '';
    current.lastFailureReason = '';
    current.rttMs = Number(meta.rttMs || current.rttMs || 0);
    current.suspect = !!meta.suspect;
    if (typeof meta.akamaiCidrMatched === 'boolean') current.akamaiCidrMatched = meta.akamaiCidrMatched;
    map.set(ip, current);
    entry.ips = Array.from(map.values());
    scheduleSave();
  }

  function markProbeFailure(hostname, ip, error = '', meta = {}) {
    const entry = ensureHost(hostname);
    const map = new Map(entry.ips.map(item => [item.ip, cloneRecord(item)]));
    const current = map.get(ip) || cloneRecord({ ip, source: 'history' });
    current.fail = Number(current.fail || 0) + 1;
    current.consecutiveFail = Number(current.consecutiveFail || 0) + 1;
    current.lastFailAt = now();
    current.lastProbeAt = current.lastFailAt;
    const kind = failureKind(error, meta);
    if (kind === 'reset') current.cooldownUntil = current.lastFailAt + 360000;
    else if (kind === 'timeout' && current.consecutiveFail >= 2) current.cooldownUntil = current.lastFailAt + 360000;
    else if (kind === 'application-failed' && current.consecutiveFail >= 2) current.cooldownUntil = current.lastFailAt + cooldownMsFor(current.consecutiveFail);
    else current.cooldownUntil = current.lastFailAt + cooldownMsFor(current.consecutiveFail);
    current.state = nextHealthState(current, 'failure');
    current.probeLevel = meta.probeLevel || meta.level || current.probeLevel || '';
    current.lastFailureStage = kind;
    current.lastFailureReason = String(error && error.message || error || current.lastFailureReason || '').slice(0, 500);
    map.set(ip, current);
    entry.lastError = String(error || entry.lastError || '');
    entry.ips = Array.from(map.values());
    scheduleSave();
  }

  function updateRefreshMeta(hostname, meta = {}) {
    const entry = ensureHost(hostname);
    if (typeof meta.lastRefreshAt === 'number') entry.lastRefreshAt = meta.lastRefreshAt;
    if (typeof meta.nextRefreshAt === 'number') entry.nextRefreshAt = meta.nextRefreshAt;
    if (typeof meta.lastError === 'string') entry.lastError = meta.lastError;
    if (typeof meta.targetMin === 'number') entry.targetMin = Math.max(1, meta.targetMin);
    scheduleSave();
  }

  function snapshot(hostname) {
    const host = String(hostname || '').trim().toLowerCase();
    const entry = ensureHost(host);
    const currentTime = now();
    const active = entry.ips.filter(item => !item.cooldownUntil || item.cooldownUntil <= currentTime);
    const cooling = entry.ips.filter(item => item.cooldownUntil && item.cooldownUntil > currentTime);
    const fastest = active.slice().sort((a, b) => (a.rttMs || 999999) - (b.rttMs || 999999))[0] || null;
    return {
      host,
      targetMin: entry.targetMin,
      active: active.length,
      cooling: cooling.length,
      ipv4: entry.ips.filter(item => net.isIP(item.ip) === 4).length,
      ipv6: entry.ips.filter(item => net.isIP(item.ip) === 6).length,
      activeIpv4: active.filter(item => net.isIP(item.ip) === 4).length,
      activeIpv6: active.filter(item => net.isIP(item.ip) === 6).length,
      fastest: fastest ? fastest.ip : '',
      rttMs: fastest ? fastest.rttMs || 0 : 0,
      lastRefreshAt: entry.lastRefreshAt || 0,
      nextRefreshAt: entry.nextRefreshAt || 0,
      lastError: entry.lastError || '',
      ips: entry.ips.map(item => Object.assign(cloneRecord(item), { state: item.state || stateForRecord(item) })),
    };
  }

  return {
    filePath,
    load,
    saveNow,
    ensureHost,
    mergeHostIps,
    prioritizedCandidates,
    activeCandidates,
    markProbeSuccess,
    markProbeFailure,
    updateRefreshMeta,
    snapshot,
    state: () => state,
    candidateScore,
  };
}

module.exports = {
  DEFAULT_FILENAME,
  createIpPool,
};
