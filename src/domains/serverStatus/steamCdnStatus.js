'use strict';

function normalizeSteamCdnHost(host) {
  return String(host || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^\/\//, '')
    .split('/')[0]
    .split('@').pop()
    .replace(/:\d+$/, '')
    .toLowerCase();
}

function isSteamControlHost(host) {
  const value = normalizeSteamCdnHost(host);
  return value === 'steamserver.net' || value.endsWith('.steamserver.net') ||
    value === 'cm.steampowered.com' || value.endsWith('.cm.steampowered.com');
}

function extractSteamContentHosts(text) {
  const source = String(text || '');
  const hosts = [];
  const seen = new Set();
  const patterns = [
    /\bhttps?:\/\/([^/\s"'<>]+steamcontent\.com)(?::(\d+))?/gi,
    /\b((?:cache\d+[-.]|[a-z0-9-]+\.)[a-z0-9.-]*steamcontent\.com)(?::(\d+))?/gi,
    /\b((?:[a-z0-9.-]+\.)?steamcdn-a\.akamaihd\.net)(?::(\d+))?/gi,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      const host = normalizeSteamCdnHost(match[1]);
      if (!host || seen.has(host)) continue;
      seen.add(host);
      hosts.push({ host, port: parseInt(String(match[2] || '0'), 10) || 0 });
    }
  }
  return hosts;
}

function createSteamCdnStatusStore(options = {}) {
  const limit = Math.max(1, parseInt(String(options.limit || '8'), 10) || 8);
  const getStrategy = typeof options.getStrategy === 'function' ? options.getStrategy : () => '';
  const getMode = typeof options.getMode === 'function' ? options.getMode : () => '';
  const state = {
    currentHost: '',
    currentVHost: '',
    currentPort: 0,
    source: '',
    mode: '',
    strategy: '',
    updatedAt: 0,
    recent: [],
  };

  function update(data = {}) {
    const host = normalizeSteamCdnHost(data.host || data.vhost);
    if (!host || isSteamControlHost(host)) return null;
    const port = Math.max(0, parseInt(String(data.port || '0'), 10) || 0);
    const entry = {
      host,
      vhost: normalizeSteamCdnHost(data.vhost),
      port,
      source: String(data.source || '').trim() || 'unknown',
      mode: String(data.mode || getMode()).trim() || getMode(),
      strategy: getStrategy(),
      at: Date.now(),
    };
    state.currentHost = entry.host;
    state.currentVHost = entry.vhost;
    state.currentPort = entry.port;
    state.source = entry.source;
    state.mode = entry.mode;
    state.strategy = entry.strategy;
    state.updatedAt = entry.at;
    state.recent = [
      entry,
      ...state.recent.filter(item => normalizeSteamCdnHost(item.host) !== entry.host),
    ].slice(0, limit);
    return entry;
  }

  function snapshot() {
    return {
      currentHost: state.currentHost,
      currentVHost: state.currentVHost,
      currentPort: state.currentPort,
      source: state.source,
      mode: state.mode,
      strategy: state.strategy || getStrategy(),
      updatedAt: state.updatedAt,
      recent: state.recent.slice(),
    };
  }

  function updateFromText(text, meta = {}) {
    for (const host of extractSteamContentHosts(text)) {
      update(Object.assign({}, meta, host));
    }
  }

  return {
    state,
    update,
    snapshot,
    updateFromText,
  };
}

module.exports = {
  normalizeSteamCdnHost,
  isSteamControlHost,
  extractSteamContentHosts,
  createSteamCdnStatusStore,
};
