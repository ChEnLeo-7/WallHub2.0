'use strict';

function createRouteStore(options = {}) {
  const ipPool = options.ipPool;
  if (!ipPool) throw new Error('routeStore requires ipPool');

  function mergeResolved(host, ips, source) {
    return ipPool.mergeHostIps(host, ips, source || 'resolver');
  }

  function candidates(host, resolvedIps) {
    return ipPool.activeCandidates(host, resolvedIps);
  }

  function prioritized(host, resolvedIps) {
    return ipPool.prioritizedCandidates(host, resolvedIps);
  }

  function feedbackSuccess(host, ip, meta = {}) {
    ipPool.markProbeSuccess(host, ip, meta);
  }

  function feedbackFailure(host, ip, error, meta = {}) {
    ipPool.markProbeFailure(host, ip, String(error && error.message || error || 'request-failed'), meta);
  }

  function cooldown(host, ip, reason, ms = 360000, meta = {}) {
    ipPool.markProbeFailure(host, ip, reason || 'cooldown', Object.assign({}, meta, { stage: reason || 'cooldown', cooldownMs: ms }));
  }

  function snapshot(host) {
    return ipPool.snapshot(host);
  }

  function updateRefreshMeta(host, meta) {
    return ipPool.updateRefreshMeta(host, meta);
  }

  return { mergeResolved, candidates, prioritized, feedbackSuccess, feedbackFailure, cooldown, snapshot, updateRefreshMeta };
}

module.exports = { createRouteStore };
