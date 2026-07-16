'use strict';

const fs = require('fs');
const path = require('path');
const https = require('https');
const githubSource = require('../steamkit/githubSource');

const DEFAULT_FILENAME = 'steam-access-cdn-db.json';
const DEFAULT_SOURCE = 'https://raw.githubusercontent.com/mansourjabin/cdn-ip-database/main/data/resolved_ips.json';
const DEFAULT_PROVIDER = 'Akamai';

function uniqueCidrs(cidrs) {
  return Array.from(new Set((cidrs || [])
    .map(cidr => String(cidr || '').trim())
    .filter(Boolean)));
}

function cidrsFromProviderData(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.ips)) return data.ips;
  if (Array.isArray(data.ipv4)) return data.ipv4;
  if (Array.isArray(data.cidrs)) return data.cidrs;
  return [];
}

function providerDataFromResolvedJson(parsed, provider) {
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  if (Object.prototype.hasOwnProperty.call(parsed, provider)) return parsed[provider];
  const wanted = String(provider || '').toLowerCase();
  const key = Object.keys(parsed).find(name => name.toLowerCase() === wanted);
  return key ? parsed[key] : null;
}

function ipv4ToInt(ip) {
  const parts = String(ip || '').trim().split('.');
  if (parts.length !== 4) return null;
  let out = 0;
  for (const part of parts) {
    if (!/^\d+$/.test(part)) return null;
    const value = Number(part);
    if (value < 0 || value > 255) return null;
    out = ((out << 8) + value) >>> 0;
  }
  return out >>> 0;
}

function parseCidrRange(cidr) {
  const parts = String(cidr || '').trim().split('/');
  const base = ipv4ToInt(parts[0]);
  if (base === null) return null;
  const prefix = parts.length > 1 ? Number(parts[1]) : 32;
  if (!Number.isInteger(prefix) || prefix < 0 || prefix > 32) return null;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return {
    base: (base & mask) >>> 0,
    mask,
  };
}

function cidrContainsIpv4(cidr, ipInt) {
  const range = parseCidrRange(cidr);
  if (!range) return false;
  return ((ipInt & range.mask) >>> 0) === range.base;
}

function compileCidrRanges(cidrs) {
  return (cidrs || [])
    .map(parseCidrRange)
    .filter(Boolean);
}

function parseCidrs(text, provider = DEFAULT_PROVIDER) {
  const value = String(text || '').trim();
  if (!value) return [];

  if (value[0] === '{') {
    const parsed = JSON.parse(value);
    return uniqueCidrs(cidrsFromProviderData(providerDataFromResolvedJson(parsed, provider)));
  }

  return uniqueCidrs(value
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#')));
}

function createCdnIpDatabase(options = {}) {
  const logger = options.logger || console;
  const configDir = options.configDir || process.cwd();
  const filePath = options.filePath || path.join(configDir, DEFAULT_FILENAME);
  const sourceUrl = options.sourceUrl || DEFAULT_SOURCE;
  const provider = options.provider || DEFAULT_PROVIDER;
  const env = options.env || process.env;
  const acceleratorMode = options.acceleratorMode || options.githubAcceleratorMode;
  const userAgent = options.userAgent || 'WallHub';
  let state = {
    updatedAt: 0,
    source: sourceUrl,
    cidrs: [],
    lastError: '',
  };

  let cidrRanges = compileCidrRanges(state.cidrs);

  function setCidrs(cidrs) {
    state.cidrs = uniqueCidrs(cidrs);
    cidrRanges = compileCidrRanges(state.cidrs);
  }

  function load() {
    try {
      if (!fs.existsSync(filePath)) return state;
      const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      state = {
        updatedAt: Number(parsed.updatedAt || 0),
        source: String(parsed.source || sourceUrl),
        cidrs: Array.isArray(parsed.cidrs) ? parsed.cidrs.slice() : [],
        lastError: String(parsed.lastError || ''),
      };
      setCidrs(state.cidrs);
    } catch (error) {
      logger.warn('[SteamAccess] Failed to load CDN IP database:', error.message);
    }
    return state;
  }

  function save() {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
  }

  function routeName(route) {
    return route && route.name === 'direct' ? 'direct' : String(route && route.name || 'direct');
  }

  function requestText(url) {
    return new Promise((resolve, reject) => {
      const req = https.request(new URL(url), {
        method: 'GET',
        timeout: 20000,
        headers: { 'User-Agent': userAgent },
      }, (rs) => {
        const chunks = [];
        rs.on('data', chunk => chunks.push(Buffer.from(chunk)));
        rs.on('end', () => {
          if (rs.statusCode < 200 || rs.statusCode >= 300) return reject(new Error(`CDN DB HTTP ${rs.statusCode || 0}`));
          resolve(Buffer.concat(chunks).toString('utf8'));
        });
      });
      req.on('timeout', () => req.destroy(new Error('CDN DB timeout')));
      req.on('error', reject);
      req.end();
    });
  }

  function sourceRoutes() {
    const routes = githubSource.githubProxyCandidates(sourceUrl, { env, acceleratorMode });
    if (routes.length > 1) {
      logger.log(`[SteamAccess] CDN database route order: ${routes.map(routeName).join(' -> ')}`);
    }
    return routes;
  }

  async function refresh() {
    const routes = sourceRoutes();
    let lastError = null;
    for (const route of routes) {
      try {
        logger.log(`[SteamAccess] Refreshing CDN database via ${routeName(route)}`);
        const text = await requestText(route.url);
        setCidrs(parseCidrs(text, provider));
        state.updatedAt = Date.now();
        state.source = sourceUrl;
        state.lastError = '';
        save();
        return state;
      } catch (error) {
        lastError = error;
        logger.warn(`[SteamAccess] CDN database route failed (${routeName(route)}):`, error.message);
      }
    }
    throw lastError || new Error('CDN DB refresh failed');
  }

  function matchIp(ip) {
    const ipInt = ipv4ToInt(ip);
    if (ipInt === null) return { matched: false };
    const matched = cidrRanges.some(range => ((ipInt & range.mask) >>> 0) === range.base);
    return { matched, suspect: !matched, source: state.source, updatedAt: state.updatedAt };
  }

  function snapshot() {
    return Object.assign({}, state, { cidrs: state.cidrs.slice(0, 16) });
  }

  return {
    filePath,
    load,
    save,
    refresh,
    matchIp,
    snapshot,
  };
}

module.exports = {
  DEFAULT_FILENAME,
  DEFAULT_SOURCE,
  DEFAULT_PROVIDER,
  parseCidrs,
  ipv4ToInt,
  cidrContainsIpv4,
  compileCidrRanges,
  createCdnIpDatabase,
};
