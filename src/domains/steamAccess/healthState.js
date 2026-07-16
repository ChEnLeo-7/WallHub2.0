'use strict';

const { ROUTE_HEALTH } = require('./routeTypes');

function nextHealthState(record = {}, event = 'observe') {
  if (event === 'success') return ROUTE_HEALTH.HEALTHY;
  if (event === 'probe') return ROUTE_HEALTH.PROBING;
  if (event === 'failure') {
    const fails = Number(record.consecutiveFail || 0);
    return fails >= 3 ? ROUTE_HEALTH.DEAD : ROUTE_HEALTH.UNSTABLE;
  }
  if (record.cooldownUntil && record.cooldownUntil > Date.now()) {
    return Number(record.consecutiveFail || 0) >= 3 ? ROUTE_HEALTH.DEAD : ROUTE_HEALTH.UNSTABLE;
  }
  if (Number(record.ok || 0) > 0 && Number(record.consecutiveFail || 0) === 0) return ROUTE_HEALTH.HEALTHY;
  if (record.lastProbeAt) return ROUTE_HEALTH.UNSTABLE;
  return ROUTE_HEALTH.UNKNOWN;
}

function cooldownMsForState(state, consecutiveFail = 0) {
  if (state === ROUTE_HEALTH.DEAD) return 30 * 60 * 1000;
  if (state === ROUTE_HEALTH.UNSTABLE) return consecutiveFail >= 2 ? 10 * 60 * 1000 : 3 * 60 * 1000;
  return 0;
}

module.exports = { nextHealthState, cooldownMsForState };
