'use strict';

function createSteamAccessMetrics(options = {}) {
  const maxEvents = Math.max(20, Number(options.maxEvents || 100));
  const counters = {
    resolveAttempts: 0,
    resolveSuccess: 0,
    resolveFailure: 0,
    resolvedCandidates: 0,
    probeAttempts: 0,
    probeSuccess: 0,
    requestAttempts: 0,
    requestSuccess: 0,
    requestFailure: 0,
    fallbackCount: 0,
  };
  const recent = [];

  function push(event) {
    recent.push(Object.assign({ at: Date.now() }, event || {}));
    while (recent.length > maxEvents) recent.shift();
  }

  function recordResolve(host, result = {}, elapsedMs = 0, error = null) {
    counters.resolveAttempts += 1;
    if (error) counters.resolveFailure += 1;
    else counters.resolveSuccess += 1;
    counters.resolvedCandidates += Array.isArray(result.ips) ? result.ips.length : 0;
    push({ stage: error ? 'dns' : 'resolved', host, elapsedMs, candidates: Array.isArray(result.ips) ? result.ips.length : 0, error: error ? String(error.message || error) : '' });
  }

  function recordProbe(host, checked, ok, level) {
    counters.probeAttempts += Number(checked || 0);
    counters.probeSuccess += Number(ok || 0);
    push({ stage: 'probe', host, checked: Number(checked || 0), ok: Number(ok || 0), level: level || '' });
  }

  function recordRequest(host, meta = {}, error = null) {
    counters.requestAttempts += 1;
    if (error) counters.requestFailure += 1;
    else counters.requestSuccess += 1;
    if (meta.fallback) counters.fallbackCount += 1;
    push(Object.assign({ stage: error ? (meta.stage || 'request') : 'request', host, error: error ? String(error.message || error) : '' }, meta));
  }

  function snapshot() {
    const requestTotal = counters.requestSuccess + counters.requestFailure;
    return {
      counters: Object.assign({}, counters, {
        requestSuccessRate: requestTotal ? counters.requestSuccess / requestTotal : 0,
      }),
      recent: recent.slice(-20),
    };
  }

  return { recordResolve, recordProbe, recordRequest, snapshot };
}

module.exports = { createSteamAccessMetrics };
