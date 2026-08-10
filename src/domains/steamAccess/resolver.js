'use strict';

const https = require('https');
const tls = require('tls');
const net = require('net');
const { URL } = require('url');
const {
  normalizeSteamAccessResolverProtocol,
  normalizeSteamAccessDohEndpoint,
  normalizeSteamAccessDotEndpoint,
  normalizeSteamAccessEndpointList,
  normalizeSteamAccessResolverMode,
} = require('../../config/normalizers');

const MAX_DOH_RESPONSE_BYTES = 1024 * 1024;

function createRequestDeadline(req, timeoutMs, message) {
  const timer = setTimeout(() => req.destroy(new Error(message)), Math.max(1, Number(timeoutMs || 1)));
  timer.unref?.();
  const clear = () => clearTimeout(timer);
  req.once('close', clear);
  req.once('error', clear);
  return clear;
}

function collectDohResponse(rs, reject) {
  const chunks = [];
  let size = 0;
  rs.on('data', (chunk) => {
    const buffer = Buffer.from(chunk);
    size += buffer.length;
    if (size > MAX_DOH_RESPONSE_BYTES) {
      rs.destroy(new Error('DoH response too large'));
      return;
    }
    chunks.push(buffer);
  });
  rs.on('error', reject);
  return chunks;
}

function encodeDnsName(hostname) {
  const labels = String(hostname || '').split('.').filter(Boolean);
  const parts = [];
  for (const label of labels) {
    const bytes = Buffer.from(label, 'ascii');
    if (!bytes.length || bytes.length > 63) throw new Error('invalid DNS label');
    parts.push(Buffer.from([bytes.length]), bytes);
  }
  parts.push(Buffer.from([0]));
  return Buffer.concat(parts);
}

function buildDnsQuery(hostname, qtype = 1) {
  const header = Buffer.alloc(12);
  header.writeUInt16BE(0x5748, 0);
  header.writeUInt16BE(0x0100, 2);
  header.writeUInt16BE(1, 4);
  const question = Buffer.alloc(4);
  question.writeUInt16BE(qtype, 0);
  question.writeUInt16BE(1, 2);
  return Buffer.concat([header, encodeDnsName(hostname), question]);
}

function skipDnsName(buffer, offset) {
  let pos = offset;
  while (pos < buffer.length) {
    const len = buffer[pos];
    if ((len & 0xc0) === 0xc0) return pos + 2;
    if (len === 0) return pos + 1;
    pos += len + 1;
  }
  throw new Error('invalid DNS name');
}

function formatIpv6(bytes) {
  const parts = [];
  for (let i = 0; i < 16; i += 2) parts.push(bytes.readUInt16BE(i).toString(16));
  return parts.join(':').replace(/(?:^|:)0(?::0)+(?::|$)/, '::');
}

function parseDnsRecords(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 12) throw new Error('invalid DNS response');
  let offset = 12;
  const qdCount = buffer.readUInt16BE(4);
  const anCount = buffer.readUInt16BE(6);
  for (let i = 0; i < qdCount; i += 1) offset = skipDnsName(buffer, offset) + 4;
  const answers = [];
  for (let i = 0; i < anCount && offset < buffer.length; i += 1) {
    offset = skipDnsName(buffer, offset);
    if (offset + 10 > buffer.length) break;
    const rrType = buffer.readUInt16BE(offset);
    const rrClass = buffer.readUInt16BE(offset + 2);
    const rdLength = buffer.readUInt16BE(offset + 8);
    offset += 10;
    if (offset + rdLength > buffer.length) break;
    if (rrClass === 1 && rrType === 1 && rdLength === 4) {
      answers.push({ data: Array.from(buffer.slice(offset, offset + 4)).join('.'), type: 'A' });
    }
    if (rrClass === 1 && rrType === 28 && rdLength === 16) {
      answers.push({ data: formatIpv6(buffer.slice(offset, offset + 16)), type: 'AAAA' });
    }
    if (rrClass === 1 && rrType === 65) {
      answers.push({ data: buffer.slice(offset, offset + rdLength).toString('base64'), type: 'HTTPS', raw: buffer.slice(offset, offset + rdLength).toString('base64') });
    }
    offset += rdLength;
  }
  return answers;
}

function dohEndpointUrl(endpoint, hostname, type = 'A') {
  const url = new URL(endpoint);
  url.searchParams.set('name', hostname);
  url.searchParams.set('type', type);
  return url.toString();
}

function queryDohWire(endpoint, hostname, qtype, userAgent, timeoutMs) {
  const body = buildDnsQuery(hostname, qtype);
  return new Promise((resolve, reject) => {
    const req = https.request(endpoint, {
      method: 'POST',
      family: 4,
      headers: {
        Accept: 'application/dns-message',
        'Content-Type': 'application/dns-message',
        'Content-Length': body.length,
        'User-Agent': userAgent,
      },
      timeout: timeoutMs,
    }, (rs) => {
      const chunks = collectDohResponse(rs, reject);
      rs.on('end', () => {
        if (rs.statusCode < 200 || rs.statusCode >= 300) return reject(new Error(`DoH HTTP ${rs.statusCode || 0}`));
        try {
          resolve(parseDnsRecords(Buffer.concat(chunks)));
        } catch (error) {
          reject(error);
        }
      });
    });
    createRequestDeadline(req, timeoutMs, 'DoH timeout');
    req.on('timeout', () => req.destroy(new Error('DoH timeout')));
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function queryDohJson(endpoint, hostname, type, userAgent, timeoutMs) {
  const url = dohEndpointUrl(endpoint, hostname, type);
  return new Promise((resolve, reject) => {
    const req = https.request(url, {
      method: 'GET',
      family: 4,
      headers: {
        Accept: 'application/dns-json',
        'User-Agent': userAgent,
      },
      timeout: timeoutMs,
    }, (rs) => {
      const chunks = collectDohResponse(rs, reject);
      rs.on('end', () => {
        if (rs.statusCode < 200 || rs.statusCode >= 300) return reject(new Error(`DoH HTTP ${rs.statusCode || 0}`));
        try {
          const data = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(Array.isArray(data.Answer) ? data.Answer : []);
        } catch (error) {
          reject(error);
        }
      });
    });
    createRequestDeadline(req, timeoutMs, 'DoH timeout');
    req.on('timeout', () => req.destroy(new Error('DoH timeout')));
    req.on('error', reject);
    req.end();
  });
}

function parseDotEndpoint(endpoint) {
  const normalized = normalizeSteamAccessDotEndpoint(endpoint);
  const index = normalized.lastIndexOf(':');
  return {
    host: normalized.slice(0, index),
    port: parseInt(normalized.slice(index + 1), 10) || 853,
    endpoint: normalized,
  };
}

function queryDot(endpoint, hostname, qtype, timeoutMs) {
  const parsed = parseDotEndpoint(endpoint);
  const query = buildDnsQuery(hostname, qtype);
  const body = Buffer.concat([Buffer.from([query.length >> 8, query.length & 0xff]), query]);
  return new Promise((resolve, reject) => {
    const socket = tls.connect({
      host: parsed.host,
      port: parsed.port,
      servername: net.isIP(parsed.host) ? undefined : parsed.host,
      ALPNProtocols: ['dot'],
      timeout: timeoutMs,
    });
    const chunks = [];
    socket.once('secureConnect', () => socket.write(body));
    socket.on('data', chunk => {
      chunks.push(Buffer.from(chunk));
      const buffer = Buffer.concat(chunks);
      if (buffer.length < 2) return;
      const length = buffer.readUInt16BE(0);
      if (buffer.length < length + 2) return;
      try {
        const answers = parseDnsRecords(buffer.slice(2, length + 2));
        socket.destroy();
        resolve(answers);
      } catch (error) {
        socket.destroy();
        reject(error);
      }
    });
    socket.once('timeout', () => socket.destroy(new Error('DoT timeout')));
    socket.once('error', reject);
    socket.once('end', () => {
      const buffer = Buffer.concat(chunks);
      if (buffer.length < 2) reject(new Error('DoT empty response'));
    });
  });
}

function createResolver(options = {}) {
  const userAgent = options.userAgent || 'WallHub';
  const timeoutMs = options.timeoutMs || 2500;
  const logger = options.logger || console;
  const endpointHealth = new Map();

  function healthKey(protocol, endpoint) {
    return `${protocol}:${endpoint}`;
  }

  function recordEndpoint(protocol, endpoint, ok, elapsedMs) {
    const key = healthKey(protocol, endpoint);
    const current = endpointHealth.get(key) || { ok: 0, fail: 0, avgMs: 0, cooldownUntil: 0, lastOkAt: 0, lastFailAt: 0 };
    const now = Date.now();
    if (ok) {
      current.ok += 1;
      current.fail = 0;
      current.lastOkAt = now;
      current.cooldownUntil = 0;
      current.avgMs = current.avgMs ? Math.round(current.avgMs * 0.7 + Math.max(1, elapsedMs) * 0.3) : Math.max(1, elapsedMs);
    } else {
      current.fail += 1;
      current.lastFailAt = now;
      current.cooldownUntil = now + Math.max(30_000, Math.min(10 * 60_000, current.fail * 60_000));
    }
    endpointHealth.set(key, current);
  }

  function endpointScore(protocol, endpoint) {
    const current = endpointHealth.get(healthKey(protocol, endpoint));
    if (!current) return 1000;
    if (current.cooldownUntil > Date.now()) return 100000 + current.fail * 1000;
    return (current.avgMs || 1000) - Math.min(current.ok, 10) * 20 + current.fail * 100;
  }

  function resolveSelectedEndpoints(protocol, selectors = {}) {
    const normalizedProtocol = normalizeSteamAccessResolverProtocol(protocol);
    const mode = normalizeSteamAccessResolverMode(normalizedProtocol === 'dot'
      ? (selectors.dotMode || selectors.mode)
      : (selectors.dohMode || selectors.mode));
    const current = normalizedProtocol === 'dot'
      ? normalizeSteamAccessEndpointList([selectors.dotEndpoint], normalizedProtocol)
      : normalizeSteamAccessEndpointList([selectors.dohEndpoint], normalizedProtocol);
    const builtin = normalizeSteamAccessEndpointList(normalizedProtocol === 'dot' ? (options.dotEndpoints || []) : (options.dohEndpoints || []), normalizedProtocol);
    const selected = normalizeSteamAccessEndpointList(normalizedProtocol === 'dot'
      ? (selectors.selectedDotEndpoints || [])
      : (selectors.selectedDohEndpoints || []), normalizedProtocol);
    const custom = normalizeSteamAccessEndpointList(normalizedProtocol === 'dot'
      ? (selectors.customDotEndpoints || [])
      : (selectors.customDohEndpoints || []), normalizedProtocol, { limit: 32 });
    const ordered = [];
    const push = (value) => {
      if (!value || ordered.includes(value)) return;
      ordered.push(value);
    };
    if (mode === 'fixed') {
      current.forEach(push);
      return ordered;
    }
    selected.forEach(push);
    if (!ordered.length) current.forEach(push);
    if (!ordered.length) custom.forEach(push);
    if (!ordered.length) builtin.forEach(push);
    return ordered.sort((a, b) => endpointScore(normalizedProtocol, a) - endpointScore(normalizedProtocol, b));
  }

  async function queryEndpoint(endpoint, hostname, protocol, qtype) {
    const normalizedProtocol = normalizeSteamAccessResolverProtocol(protocol);
    const startedAt = Date.now();
    try {
      let answers;
      if (normalizedProtocol === 'dot') {
        answers = await queryDot(endpoint, hostname, qtype === 'AAAA' ? 28 : 1, timeoutMs);
      } else {
        const parsed = new URL(endpoint);
        answers = /\/dns-query(?:$|[/?#])/i.test(parsed.pathname)
          ? await queryDohWire(endpoint, hostname, qtype === 'AAAA' ? 28 : 1, userAgent, timeoutMs)
          : await queryDohJson(endpoint, hostname, qtype, userAgent, timeoutMs);
      }
      recordEndpoint(normalizedProtocol, endpoint, true, Date.now() - startedAt);
      return (answers || []).map(item => ({
        data: item && item.data,
        ip: item && item.data,
        endpoint,
        resolver: endpoint,
        protocol: normalizedProtocol,
        type: item && item.type || qtype,
        recordType: item && item.type || qtype,
        source: normalizedProtocol,
        elapsedMs: Date.now() - startedAt,
        confidence: 0.8,
      }));
    } catch (error) {
      recordEndpoint(normalizedProtocol, endpoint, false, Date.now() - startedAt);
      logger.warn(`[SteamAccess] ${normalizedProtocol.toUpperCase()} ${qtype} failed ${endpoint} ${hostname}: ${error.message}`);
      return [];
    }
  }

  async function resolveHost(hostname, optionsForResolve = {}) {
    const protocol = normalizeSteamAccessResolverProtocol(optionsForResolve.protocol || 'doh');
    const includeIpv6 = !!optionsForResolve.includeIpv6;
    const endpoints = resolveSelectedEndpoints(protocol, optionsForResolve);
    const qtypes = includeIpv6 ? ['A', 'AAAA'] : ['A'];
    const seen = new Set();
    const ips = [];
    const answers = [];
    const usedEndpoints = [];
    const tasks = [];
    for (const endpoint of endpoints) {
      for (const qtype of qtypes) tasks.push(queryEndpoint(endpoint, hostname, protocol, qtype));
    }
    const results = await Promise.all(tasks);
    for (const result of results) {
      for (const answer of result) {
        const ip = String(answer.data || '').trim();
        const family = net.isIP(ip);
        if (!family || seen.has(ip)) continue;
        seen.add(ip);
        ips.push(ip);
        answers.push(Object.assign({
          ip,
          family,
          resolvedHost: hostname,
        }, answer));
        if (!usedEndpoints.includes(answer.endpoint)) usedEndpoints.push(answer.endpoint);
      }
      if (ips.length >= (optionsForResolve.minIps || 8)) break;
    }
    return {
      ips,
      answers,
      endpoints: usedEndpoints,
      protocol,
      source: 'resolver',
      resolverHealth: endpoints.slice(0, 8).map(endpoint => {
        const current = endpointHealth.get(healthKey(protocol, endpoint)) || {};
        return {
          endpoint,
          protocol,
          ok: (current.fail || 0) === 0,
          failures: current.fail || 0,
          avgMs: current.avgMs || 0,
          cooldownUntil: current.cooldownUntil || 0,
        };
      }),
    };
  }

  async function resolveEch(hostname, optionsForResolve = {}) {
    const protocol = normalizeSteamAccessResolverProtocol(optionsForResolve.protocol || 'doh');
    if (protocol !== 'doh') return { host: hostname, echSupported: false, answers: [], source: protocol, error: 'ech-diagnostics-require-doh-json-or-wire' };
    const endpoints = resolveSelectedEndpoints(protocol, optionsForResolve).slice(0, 2);
    const answers = [];
    for (const endpoint of endpoints) {
      const result = await queryEndpoint(endpoint, hostname, protocol, 'HTTPS');
      answers.push(...result);
      if (answers.length) break;
    }
    const text = JSON.stringify(answers).toLowerCase();
    return {
      host: hostname,
      echSupported: text.includes('ech='),
      answers,
      source: protocol,
    };
  }

  return {
    resolveHost,
    resolveEch,
    resolveSelectedEndpoints,
    endpointHealthSnapshot: () => Array.from(endpointHealth.entries()),
  };
}

module.exports = {
  createResolver,
  buildDnsQuery,
  dohEndpointUrl,
  queryDohWire,
  queryDohJson,
  queryDot,
  parseDnsRecords,
  createRequestDeadline,
};
