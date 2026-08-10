'use strict';

const http = require('http');
const https = require('https');
const dns = require('dns');
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
    if (!net.isIP(ip)) {
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

function isPublicIpv4(address) {
  const parts = String(address || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b, c] = parts;
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && ((b === 0) || (b === 168))) return false;
  if (a === 192 && b === 88 && c === 99) return false;
  if (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) return false;
  if (a === 203 && b === 0 && c === 113) return false;
  return true;
}

function isPublicIpv6(address) {
  const value = String(address || '').toLowerCase().split('%', 1)[0];
  const mapped = value.match(/(?:^|:)ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPublicIpv4(mapped[1]);
  const halves = value.split('::');
  if (halves.length > 2) return false;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const groups = halves.length === 2
    ? left.concat(Array(8 - left.length - right.length).fill('0'), right)
    : left;
  if (groups.length !== 8 || (halves.length === 2 && left.length + right.length >= 8) || groups.some(group => !/^[0-9a-f]{1,4}$/.test(group))) return false;
  const words = groups.map(group => Number.parseInt(group, 16));
  const first = words[0];
  if (first < 0x2000 || first > 0x3fff) return false;
  if ((first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00) return false;
  if (first === 0x2001 && (words[1] === 0 || words[1] === 0x0002 || (words[1] & 0xfff0) === 0x0010 || words[1] === 0x0db8)) return false;
  if (first === 0x64ff && words[1] === 0x009b) return false;
  if (first === 0x2002) return false;
  return true;
}

function isPublicAddress(address) {
  const family = net.isIP(address);
  return family === 4 ? isPublicIpv4(address) : family === 6 ? isPublicIpv6(address) : false;
}

async function resolvePublicTarget(hostname, options = {}) {
  const host = String(hostname || '').replace(/^\[|\]$/g, '').toLowerCase();
  const family = net.isIP(host);
  const addresses = family
    ? [{ address: host, family }]
    : await (options.lookup || dns.promises.lookup)(host, { all: true, verbatim: true });
  if (!Array.isArray(addresses) || !addresses.length) throw new Error('Hosts URL host did not resolve');
  if (addresses.some(item => !isPublicAddress(item && item.address))) {
    throw new Error('Hosts URL resolved to a non-public IP address');
  }
  const selected = addresses[0];
  return { address: selected.address, family: Number(selected.family) || net.isIP(selected.address) };
}

async function fetchText(url, options = {}) {
  const maxBytes = Math.max(1, Math.min(DEFAULT_HOSTS_FETCH_MAX_BYTES, Math.floor(Number(options.maxBytes) || DEFAULT_HOSTS_FETCH_MAX_BYTES)));
  const timeoutMs = Math.max(1, Math.floor(Number(options.timeoutMs) || DEFAULT_HOSTS_FETCH_TIMEOUT_MS));
  const parsed = new URL(normalizeSteamAccessHostsUrl(url));
  return new Promise((resolve, reject) => {
    let req = null;
    let settled = false;
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      if (error) reject(error);
      else resolve(value);
    };
    const deadline = setTimeout(() => {
      const error = new Error('Hosts URL fetch timeout');
      finish(error);
      if (req) req.destroy(error);
    }, timeoutMs);
    deadline.unref?.();

    resolvePublicTarget(parsed.hostname, options).then((target) => {
      if (settled) return;
      const client = parsed.protocol === 'http:' ? http : https;
      const request = options.request || client.request.bind(client);
      req = request(parsed, {
        method: 'GET',
        agent: false,
        headers: { 'User-Agent': options.userAgent || 'WallHub' },
        servername: parsed.hostname,
        lookup(_hostname, lookupOptions, callback) {
          if (lookupOptions && lookupOptions.all) {
            callback(null, [{ address: target.address, family: target.family }]);
            return;
          }
          callback(null, target.address, target.family);
        },
      }, (res) => {
        const statusCode = Number(res.statusCode || 0);
        if (statusCode < 200 || statusCode >= 300) {
          const error = new Error(statusCode >= 300 && statusCode < 400
            ? 'Hosts URL redirects are not allowed'
            : `Hosts URL returned HTTP ${statusCode}`);
          finish(error);
          res.destroy();
          req.destroy();
          return;
        }
        const contentLength = Number(res.headers && res.headers['content-length']);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
          finish(new Error('Hosts URL response is too large'));
          res.destroy();
          req.destroy();
          return;
        }
        const chunks = [];
        let total = 0;
        res.on('data', (chunk) => {
          if (settled) return;
          total += chunk.length;
          if (total > maxBytes) {
            const error = new Error('Hosts URL response is too large');
            finish(error);
            res.destroy(error);
            req.destroy(error);
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        res.on('end', () => finish(null, Buffer.concat(chunks).toString('utf8')));
        res.on('error', finish);
      });
      req.on('error', finish);
      req.end();
    }, finish);
  });
}

function createHostsUpdater(options = {}) {
  const getSettings = typeof options.getSettings === 'function' ? options.getSettings : () => ({});
  const applyPatch = typeof options.applyPatch === 'function' ? options.applyPatch : () => null;
  const saveSettings = typeof options.saveSettings === 'function' ? options.saveSettings : () => false;
  const restoreSettings = typeof options.restoreSettings === 'function' ? options.restoreSettings : () => {};
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
      if (!parsed.validEntries) throw new Error('Hosts URL did not contain any valid mappings');
      const lastUpdatedAt = Date.now();
      if (save) {
        const previousSettings = JSON.parse(JSON.stringify(getSettings()));
        applyPatch({
          wallhubSteamAccessHosts: hosts,
          wallhubSteamAccessHostsUrl: normalizedUrl,
          wallhubSteamAccessHostsLastUpdatedAt: lastUpdatedAt,
          wallhubSteamAccessHostsLastError: '',
        });
        if (saveSettings() !== true) {
          restoreSettings(previousSettings);
          const error = new Error('Failed to save Hosts settings');
          error.code = 'HOSTS_SETTINGS_SAVE_FAILED';
          throw error;
        }
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
      if (save && e.code !== 'HOSTS_SETTINGS_SAVE_FAILED') {
        const previousSettings = JSON.parse(JSON.stringify(getSettings()));
        try {
          applyPatch({
            wallhubSteamAccessHostsUrl: normalizedUrl,
            wallhubSteamAccessHostsLastError: e.message || String(e),
          });
          if (saveSettings() === true) schedule();
          else restoreSettings(previousSettings);
        } catch (patchErr) {
          restoreSettings(previousSettings);
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
  isPublicAddress,
  resolvePublicTarget,
  fetchText,
  createHostsUpdater,
};
