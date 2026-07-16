'use strict';

const https = require('https');
const tls = require('tls');
const net = require('net');
const { servernameForSni, httpProbePath } = require('./routes');

function testTlsIp(ip, port, servername, timeoutMs) {
  return new Promise((resolve) => {
    const family = net.isIP(ip);
    if (!family) return resolve(Number.POSITIVE_INFINITY);
    const startedAt = Date.now();
    const socket = tls.connect({
      host: ip,
      port: port || 443,
      family,
      servername: String(servername || ''),
      rejectUnauthorized: false,
      ALPNProtocols: ['http/1.1'],
      timeout: timeoutMs,
    });
    const done = (ok) => {
      try { socket.destroy(); } catch {}
      resolve(ok ? Date.now() - startedAt : Number.POSITIVE_INFINITY);
    };
    socket.once('secureConnect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function testTcpIp(ip, port, timeoutMs) {
  return new Promise((resolve) => {
    const family = net.isIP(ip);
    if (!family) return resolve(Number.POSITIVE_INFINITY);
    const startedAt = Date.now();
    const socket = net.connect({ host: ip, port: port || 443, family, timeout: timeoutMs });
    const done = (ok) => {
      try { socket.destroy(); } catch {}
      resolve(ok ? Date.now() - startedAt : Number.POSITIVE_INFINITY);
    };
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function applicationProbeOk(hostname, statusCode, headers, body) {
  if (statusCode < 200 || statusCode >= 500) return false;
  const host = String(hostname || '').toLowerCase();
  if (host === 'api.steampowered.com' || host === 'community.steam-api.com') {
    return statusCode === 200 && /^\s*\{/.test(String(body || ''));
  }
  const text = String(body || '').toLowerCase();
  if (host.includes('steamcommunity') || host.includes('steampowered')) {
    return text.includes('steam') || text.includes('workshop') || text.includes('<html');
  }
  return true;
}

function testHttpIp(hostname, ip, port, sni, timeoutMs, userAgent, application = false) {
  return new Promise((resolve) => {
    const family = net.isIP(ip);
    if (!family) return resolve(Number.POSITIVE_INFINITY);
    const startedAt = Date.now();
    const req = https.request({
      protocol: 'https:',
      hostname: ip,
      servername: servernameForSni(sni, hostname),
      port: port || 443,
      family,
      path: httpProbePath(hostname),
      method: 'GET',
      headers: {
        Host: hostname,
        'User-Agent': userAgent || 'WallHub',
        Accept: '*/*',
        'Accept-Encoding': 'identity',
      },
      timeout: timeoutMs,
      rejectUnauthorized: false,
      agent: false,
    }, (rs) => {
      const chunks = [];
      let size = 0;
      rs.on('data', (chunk) => {
        if (size < 4096) chunks.push(Buffer.from(chunk));
        size += chunk.length;
        if (size > 4096) rs.destroy();
      });
      rs.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const ok = application ? applicationProbeOk(hostname, rs.statusCode || 0, rs.headers || {}, body) : (rs.statusCode >= 200 && rs.statusCode < 500);
        resolve(ok ? Date.now() - startedAt : Number.POSITIVE_INFINITY);
      });
      rs.on('close', () => {
        if (size > 4096) {
          const body = Buffer.concat(chunks).toString('utf8');
          const ok = application ? applicationProbeOk(hostname, rs.statusCode || 0, rs.headers || {}, body) : (rs.statusCode >= 200 && rs.statusCode < 500);
          resolve(ok ? Date.now() - startedAt : Number.POSITIVE_INFINITY);
        }
      });
      rs.on('error', () => resolve(Number.POSITIVE_INFINITY));
    });
    req.on('timeout', () => req.destroy(new Error('HTTP probe timeout')));
    req.on('error', () => resolve(Number.POSITIVE_INFINITY));
    req.end();
  });
}

function createProbe(options = {}) {
  const userAgent = options.userAgent || 'WallHub';
  const logger = options.logger || console;

  async function probeIp(hostname, ip, port, sni, timeoutMs, requireHttp = false, level = '') {
    const probeLevel = level || (requireHttp ? 'http' : 'tls');
    if (probeLevel === 'tcp') {
      const tcpMs = await testTcpIp(ip, port, timeoutMs);
      return { ok: Number.isFinite(tcpMs), tcpMs, tlsMs: tcpMs, httpMs: tcpMs, rttMs: tcpMs, probeLevel };
    }
    const tlsMs = await testTlsIp(ip, port, servernameForSni(sni, hostname), timeoutMs);
    if (!Number.isFinite(tlsMs)) return { ok: false, tlsOk: false, httpOk: false, applicationOk: false, tlsMs, httpMs: Number.POSITIVE_INFINITY, rttMs: Number.POSITIVE_INFINITY, probeLevel };
    if (!requireHttp && probeLevel !== 'http' && probeLevel !== 'application') return { ok: true, tlsOk: true, httpOk: false, applicationOk: false, tlsMs, httpMs: tlsMs, rttMs: tlsMs, probeLevel };
    const httpMs = await testHttpIp(hostname, ip, port, sni, timeoutMs, userAgent, probeLevel === 'application');
    if (!Number.isFinite(httpMs)) return { ok: false, tlsOk: true, httpOk: false, applicationOk: false, tlsMs, httpMs, rttMs: Number.POSITIVE_INFINITY, probeLevel };
    return { ok: true, tlsOk: true, httpOk: true, applicationOk: probeLevel === 'application', tlsMs, httpMs, rttMs: httpMs, probeLevel };
  }

  async function stressIp(hostname, ip, port, sni, timeoutMs, optionsForStress = {}) {
    const rounds = Math.max(2, Math.min(5, Number(optionsForStress.rounds || 3)));
    const results = [];
    for (let index = 0; index < rounds; index += 1) {
      results.push(await probeIp(hostname, ip, port, sni, timeoutMs, true, optionsForStress.level || 'application'));
    }
    const ok = results.filter(item => item.ok).length;
    const rtts = results.filter(item => Number.isFinite(item.rttMs)).map(item => item.rttMs).sort((a, b) => a - b);
    return { ok: ok === rounds, success: ok, rounds, rttMs: rtts.length ? rtts[Math.floor(rtts.length / 2)] : Number.POSITIVE_INFINITY, probeLevel: 'stress' };
  }

  async function rankIps(hostname, ips, port, sni, optionsForRank = {}) {
    const limit = Math.max(1, Number(optionsForRank.limit || ips.length || 1));
    const timeoutMs = Math.max(500, Number(optionsForRank.timeoutMs || 2500));
    const requireHttp = !!optionsForRank.requireHttp;
    const level = optionsForRank.probeLevel || (requireHttp ? 'application' : 'tls');
    const out = [];
    for (const ip of ips.slice(0, limit)) {
      const result = await probeIp(hostname, ip, port, sni, timeoutMs, requireHttp, level);
      out.push(Object.assign({ ip, family: net.isIP(ip) }, result));
    }
    out.sort((a, b) => (a.rttMs || Number.POSITIVE_INFINITY) - (b.rttMs || Number.POSITIVE_INFINITY));
    logger.log(`[SteamAccess] probe ${hostname} checked=${out.length} ok=${out.filter(item => item.ok).length} mode=${level}`);
    return out;
  }

  return {
    probeIp,
    stressIp,
    rankIps,
  };
}

module.exports = {
  createProbe,
  testTcpIp,
  testTlsIp,
  testHttpIp,
  applicationProbeOk,
};
