'use strict';

function createConnectionPoolSnapshot(options = {}) {
  const metadata = options.metadata;
  const http1 = options.http1;
  const http2 = options.http2;
  const connectionReuseEnabled = options.connectionReuseEnabled;

  return function snapshot() {
    const connections = Array.from(metadata.values()).map(meta => ({
      host: meta.host,
      ip: meta.ip,
      family: meta.family,
      protocol: meta.protocol,
      sniMode: meta.sniMode,
      sniHostname: meta.sniHostname,
      state: meta.state,
      connectionReuseEnabled: connectionReuseEnabled(meta.route),
      createdAt: meta.createdAt,
      lastUsedAt: meta.lastUsedAt,
      lastOkAt: meta.lastOkAt,
      requestCount: meta.requestCount,
      reusedCount: meta.reusedCount,
      lastLocalPort: meta.lastLocalPort,
      connectionAgeMs: Date.now() - meta.createdAt,
      lastError: meta.lastError,
      lastResetAt: meta.lastResetAt,
      cooldownUntil: meta.cooldownUntil,
    }));
    return {
      h1Agents: http1.size(),
      h2Sessions: http2.size(),
      enabledProtocols: http2.size() ? ['h2', 'h1'] : ['h1'],
      connections,
    };
  };
}

module.exports = { createConnectionPoolSnapshot };
