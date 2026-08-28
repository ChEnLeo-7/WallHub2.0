'use strict';

const REMOTE_TOKEN_TTL_MS = 20 * 60 * 1000;
const DEPOT_TOKEN_TTL_MS = 45 * 60 * 1000;

function createVideoTokenRegistry(deps = {}) {
  const { disposeDepotEntry = () => {}, releaseDepotEntry } = deps;
  const remoteStreams = new Map();
  const depotStreams = new Map();

  function createToken() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  }

  function createRemote(source) {
    const token = createToken();
    const now = Date.now();
    remoteStreams.set(token, Object.assign({}, source, {
      createdAt: now,
      expiresAt: now + REMOTE_TOKEN_TTL_MS,
    }));
    return token;
  }

  function getRemote(token) {
    const key = String(token || '');
    const entry = remoteStreams.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      remoteStreams.delete(key);
      return null;
    }
    return entry;
  }

  function releaseDepotEntryIfUnreferenced(entry, reason) {
    const workerKey = String(entry && entry.workerKey || '').trim();
    if (workerKey) {
      const now = Date.now();
      for (const candidate of depotStreams.values()) {
        if (
          !(candidate && candidate.expiresAt <= now)
          && String(candidate && candidate.workerKey || '').trim() === workerKey
        ) {
          return { stopped: false, retained: true };
        }
      }
    }
    return releaseDepotEntry(entry, reason);
  }

  function removeDepot(token, reason) {
    const key = String(token || '').trim();
    const entry = depotStreams.get(key);
    if (!entry) return { released: false, stopped: false };
    depotStreams.delete(key);
    disposeDepotEntry(entry, reason);
    const result = releaseDepotEntryIfUnreferenced(entry, reason);
    return { released: true, stopped: !!result.stopped };
  }

  function releaseOtherDepots(keepToken = '', keepId = '') {
    const keepKey = String(keepToken || '');
    const keepVideoId = String(keepId || '');
    for (const [key, entry] of Array.from(depotStreams.entries())) {
      if (key === keepKey) continue;
      if (keepVideoId && String(entry && (entry.id || entry.publishedFileId) || '') === keepVideoId) continue;
      removeDepot(key, 'superseded');
    }
  }

  function createDepot(source, info) {
    const token = createToken();
    const now = Date.now();
    depotStreams.set(token, Object.assign({}, source, info || {}, {
      createdAt: now,
      expiresAt: now + DEPOT_TOKEN_TTL_MS,
    }));
    releaseOtherDepots(token, source && source.id);
    return token;
  }

  function getDepot(token) {
    const key = String(token || '');
    const entry = depotStreams.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      removeDepot(key, 'token-expired');
      return null;
    }
    entry.expiresAt = Date.now() + DEPOT_TOKEN_TTL_MS;
    return entry;
  }

  function releaseDepot(token) {
    const result = removeDepot(token, 'client-release');
    if (!result.released) return { success: true, released: false };
    return { success: true, released: true, stopped: result.stopped };
  }

  function releaseDepotUrl(streamUrl) {
    try {
      const parsed = new URL(String(streamUrl || ''), 'http://wallhub.local');
      if (parsed.pathname !== '/api/video/depot') return { success: true, released: false };
      return releaseDepot(parsed.searchParams.get('token') || '');
    } catch {
      return { success: true, released: false };
    }
  }

  function cleanup() {
    const now = Date.now();
    for (const [key, entry] of remoteStreams) {
      if (!entry || entry.expiresAt <= now) remoteStreams.delete(key);
    }
    for (const [key, entry] of Array.from(depotStreams.entries())) {
      if (!entry || entry.expiresAt <= now) removeDepot(key, 'token-expired');
    }
  }

  return {
    createRemote,
    getRemote,
    createDepot,
    getDepot,
    getDepotStreams: () => depotStreams.values(),
    releaseDepot,
    releaseDepotUrl,
    releaseDepotEntryIfUnreferenced,
    cleanup,
  };
}

module.exports = {
  createVideoTokenRegistry,
};
