'use strict';

const net = require('net');

function assertTrustedGithubUrl(value, expectedHosts) {
  let parsed;
  try {
    parsed = new URL(String(value || ''));
  } catch {
    throw new Error('GitHub release returned an invalid asset URL');
  }
  const hosts = new Set(expectedHosts || []);
  if (parsed.protocol !== 'https:' || !hosts.has(parsed.hostname.toLowerCase()) || parsed.username || parsed.password) {
    throw new Error('GitHub release returned an untrusted asset URL');
  }
  return parsed.href;
}

function googlePingArgs(platform = process.platform) {
  const host = 'google.com';
  if (platform === 'win32') return ['-n', '1', '-w', '2000', host];
  if (platform === 'darwin') return ['-c', '1', '-W', '2000', host];
  return ['-c', '1', '-W', '2', host];
}

function prioritizeGithubRoutes(candidates, googleReachable) {
  if (!googleReachable) return candidates;
  const direct = candidates.find(candidate => candidate.name === 'direct');
  return direct
    ? [direct].concat(candidates.filter(candidate => candidate !== direct))
    : candidates;
}

function isLoopbackAddress(value) {
  const address = String(value || '').trim().toLowerCase();
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1';
}

function requestHostname(value) {
  try {
    return new URL(`http://${String(value || '').trim()}`).hostname.replace(/^\[|\]$/g, '').toLowerCase();
  } catch {
    return '';
  }
}

function isAllowedWallhubHost(value, allowedHosts = process.env.WALLHUB_ALLOWED_HOSTS || '') {
  const hostname = requestHostname(value);
  if (!hostname) return false;
  if (!String(allowedHosts || '').trim()) return true;
  if (hostname === 'localhost' || net.isIP(hostname)) return true;
  const configured = String(allowedHosts || '').split(',').map(requestHostname).filter(Boolean);
  return configured.includes(hostname);
}

function isWallhubReadAllowed(req, options = {}) {
  const headers = req && req.headers ? req.headers : {};
  const fetchSite = String(headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') return false;
  if (!isAllowedWallhubHost(headers.host, options.allowedHosts)) return false;
  const origin = String(headers.origin || '').trim();
  if (!origin) return true;
  try {
    return new URL(origin).host.toLowerCase() === String(headers.host || '').toLowerCase();
  } catch {
    return false;
  }
}

function isUpdateMutationAllowed(req, options = {}) {
  const headers = req && req.headers ? req.headers : {};
  const fetchSite = String(headers['sec-fetch-site'] || '').toLowerCase();
  if (fetchSite === 'cross-site') return false;
  if (!isAllowedWallhubHost(headers.host, options.allowedHosts)) return false;
  if (fetchSite === 'same-origin') return true;
  const origin = String(headers.origin || '').trim();
  if (!origin) {
    const remoteAddress = req && req.socket && req.socket.remoteAddress;
    return isLoopbackAddress(remoteAddress);
  }
  try {
    return new URL(origin).host.toLowerCase() === String(headers.host || '').toLowerCase();
  } catch {
    return false;
  }
}

module.exports = {
  assertTrustedGithubUrl,
  googlePingArgs,
  prioritizeGithubRoutes,
  isLoopbackAddress,
  isAllowedWallhubHost,
  isWallhubReadAllowed,
  isUpdateMutationAllowed,
};
