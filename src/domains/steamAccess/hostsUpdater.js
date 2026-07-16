'use strict';

const http = require('http');
const https = require('https');
const net = require('net');
const { URL } = require('url');
const {
  normalizeSteamAccessHostsUrl,
} = require('../../config/normalizers');

const DEFAULT_HOSTS_FETCH_MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_HOSTS_FETCH_TIMEOUT_MS = 15000;

function parseHostsText(text) {
  const entries = new Map();
  let validEntries = 0;
  let ignoredEntries = 0;
  const lines = String(text || '').replace(/\r\n?/g, '\n').split('\n');
  for (const rawLine of lines) {
    const line = String(rawLine || '').trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const body = line.split(/\s+#|\s+;/, 1)[0].trim();
    const parts = body.split(/\s+/).filter(Boolean);
    if (parts.length < 2) {
      ignoredEntries += 1;
      continue;
    }
    const ip = parts[0];
    if (net.isIP(ip) !== 4) {
      ignoredEntries += 1;
      continue;
    }
    let accepted = 0;
    for (const hostValue of parts.slice(1)) {
      const host = String(hostValue || '').trim().toLowerCase();
      if (!host || host.includes('/') || host.includes('://') || /\s/.test(host)) continue;
      entries.set(host, { ip, host });
      accepted += 1;
    }
    if (accepted) validEntries += accepted;
    else ignoredEntries += 1;
  }
  return { entries, validEntries, ignoredEntries };
}

function fetchText(url, options = {}) {
  const maxBytes = options.maxBytes || DEFAULT_HOSTS_FETCH_MAX_BYTES;
  const timeoutMs = options.timeoutMs || DEFAULT_HOSTS_FETCH_TIMEOUT_MS;
  const parsed = new URL(normalizeSteamAccessHostsUrl(url));
  const client = parsed.protocol === 'http:' ? http : https;
  return new Promise((resolve, reject) => {
    const req = client.request(parsed, {
      method: 'GET',
      headers: { 'User-Agent': options.userAgent || 'WallHub' },
      timeout: timeoutMs,
    }, (res) => {
      if (res.statusCode < 200 || res.statusCode >= 300) {
        res.resume();
        reject(new Error(`Hosts URL returned HTTP ${res.statusCode || 0}`));
        return;
      }
      const chunks = [];
      let total = 0;
      res.on('data', (chunk) => {
        total += chunk.length;
        if (total > maxBytes) {
          req.destroy(new Error('Hosts URL response is too large'));
          return;
        }
        chunks.push(Buffer.from(chunk));
      });
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('timeout', () => req.destroy(new Error('Hosts URL fetch timeout')));
    req.on('error', reject);
    req.end();
  });
}

function createHostsUpdater(options = {}) {
  const getSettings = typeof options.getSettings === 'function' ? options.getSettings : () => ({});
  const applyPatch = typeof options.applyPatch === 'function' ? options.applyPatch : () => null;
  const saveSettings = typeof options.saveSettings === 'function' ? options.saveSettings : () => false;
  const clearGateway = typeof options.clearGateway === 'function' ? options.clearGateway : () => {};
  const logger = options.logger || console;
  let timer = null;
  let nextUpdateAt = 0;

  function clearTimer() {
    if (timer) clearTimeout(timer);
    timer = null;
    nextUpdateAt = 0;
  }

  async function fetchAndMaybeSave(url, save = true) {
    const normalizedUrl = normalizeSteamAccessHostsUrl(url || getSettings().wallhubSteamAccessHostsUrl || '');
    if (!normalizedUrl) throw new Error('请先填写 hosts 来源 URL');
    try {
      const hosts = await fetchText(normalizedUrl, options);
      const parsed = parseHostsText(hosts);
      const lastUpdatedAt = Date.now();
      if (save) {
        applyPatch({
          wallhubSteamAccessHosts: hosts,
          wallhubSteamAccessHostsUrl: normalizedUrl,
          wallhubSteamAccessHostsLastUpdatedAt: lastUpdatedAt,
          wallhubSteamAccessHostsLastError: '',
        });
        saveSettings();
        clearGateway();
        schedule();
      }
      return {
        success: true,
        hosts,
        validEntries: parsed.validEntries,
        ignoredEntries: parsed.ignoredEntries,
        lastUpdatedAt,
      };
    } catch (e) {
      if (save) {
        try {
          applyPatch({
            wallhubSteamAccessHostsUrl: normalizedUrl,
            wallhubSteamAccessHostsLastError: e.message || String(e),
          });
          saveSettings();
          schedule();
        } catch (patchErr) {
          logger.warn('[SteamAccess] failed to persist hosts fetch error:', patchErr.message);
        }
      }
      throw e;
    }
  }

  function schedule() {
    clearTimer();
    const settings = getSettings();
    if (!settings.wallhubSteamAccessHostsAutoUpdateEnabled || !settings.wallhubSteamAccessHostsUrl) return;
    const intervalHours = Math.max(0.5, Math.min(168, Number(settings.wallhubSteamAccessHostsUpdateIntervalHours || 24)));
    const intervalMs = intervalHours * 60 * 60 * 1000;
    const last = Number(settings.wallhubSteamAccessHostsLastUpdatedAt || 0);
    nextUpdateAt = Math.max(Date.now() + 1000, (last || Date.now()) + intervalMs);
    timer = setTimeout(() => {
      fetchAndMaybeSave(settings.wallhubSteamAccessHostsUrl, true)
        .catch((e) => logger.warn('[SteamAccess] hosts auto update failed:', e.message));
    }, Math.max(1000, nextUpdateAt - Date.now()));
    timer.unref?.();
  }

  return {
    parseHostsText,
    fetchAndMaybeSave,
    schedule,
    clearTimer,
    nextUpdateAt: () => nextUpdateAt,
  };
}

module.exports = {
  DEFAULT_HOSTS_FETCH_MAX_BYTES,
  DEFAULT_HOSTS_FETCH_TIMEOUT_MS,
  parseHostsText,
  fetchText,
  createHostsUpdater,
};
