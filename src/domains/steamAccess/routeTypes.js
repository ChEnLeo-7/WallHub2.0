'use strict';

const ROUTE_HEALTH = Object.freeze({
  UNKNOWN: 'UNKNOWN',
  PROBING: 'PROBING',
  HEALTHY: 'HEALTHY',
  UNSTABLE: 'UNSTABLE',
  DEAD: 'DEAD',
});

const PROBE_LEVELS = Object.freeze(['tcp', 'tls', 'http', 'application', 'stress']);

module.exports = { ROUTE_HEALTH, PROBE_LEVELS };
