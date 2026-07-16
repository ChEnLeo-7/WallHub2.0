'use strict';

const fs = require('fs');

const DEFAULT_GITHUB_PROXY_URLS = [
  'https://gh-proxy.com/',
  'https://ghproxy.net/',
];

function parseCsvEnv(env, name) {
  return String((env || process.env)[name] || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);
}

function isGithubDownloadUrl(url) {
  try {
    const parsed = new URL(url);
    return /(^|\.)github\.com$/i.test(parsed.hostname) ||
      /(^|\.)githubusercontent\.com$/i.test(parsed.hostname) ||
      /objects\.githubusercontent\.com$/i.test(parsed.hostname);
  } catch {
    return false;
  }
}

function buildGithubProxyUrl(proxy, url) {
  const value = String(proxy || '').trim();
  if (!value || value.toLowerCase() === 'direct') return url;
  if (value.includes('{url}')) return value.replace(/\{url\}/g, encodeURIComponent(url));
  return `${value.replace(/\/+$/, '')}/${url}`;
}

function githubProxyCandidates(url, options = {}) {
  const env = options.env || process.env;
  const mode = String(options.acceleratorMode || env.WALLHUB_GITHUB_ACCELERATOR || 'auto').trim().toLowerCase();
  if (mode === 'off' || mode === '0' || mode === 'false' || mode === 'direct') return [{ name: 'direct', url }];
  if (!isGithubDownloadUrl(url)) return [{ name: 'direct', url }];

  const custom = parseCsvEnv(env, 'WALLHUB_GITHUB_PROXY_URLS').concat(parseCsvEnv(env, 'GITHUB_PROXY_URLS'));
  const proxies = custom.length ? custom : (options.defaultProxyUrls || DEFAULT_GITHUB_PROXY_URLS);
  const rows = [];
  const seen = new Set();
  for (const proxy of proxies) {
    const candidateUrl = buildGithubProxyUrl(proxy, url);
    if (seen.has(candidateUrl)) continue;
    seen.add(candidateUrl);
    rows.push({ name: proxy, url: candidateUrl });
  }
  if (!seen.has(url)) rows.push({ name: 'direct', url });
  return rows;
}

function looksLikeZipBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) return false;
  return buffer[0] === 0x50 && buffer[1] === 0x4b &&
    (buffer[2] === 0x03 || buffer[2] === 0x05 || buffer[2] === 0x07) &&
    (buffer[3] === 0x04 || buffer[3] === 0x06 || buffer[3] === 0x08);
}

async function chooseGithubDownloadRoutes(url, options = {}) {
  const candidates = githubProxyCandidates(url, options);
  if (candidates.length <= 1) return candidates;

  const logger = options.logger || console;
  const directRoute = candidates.find(candidate => candidate.name === 'direct');
  const acceleratorRoutes = candidates.filter(candidate => candidate.name !== 'direct');
  const checkGoogleReachability = options.checkGoogleReachability;

  if (typeof checkGoogleReachability === 'function') {
    let googleReachable = false;

    try {
      googleReachable = !!(await checkGoogleReachability());
    } catch (error) {
      if (typeof logger.warn === 'function') {
        logger.warn(`[GitHub] Google reachability check failed; using GitHub accelerator: ${error.message}`);
      }
    }

    if (googleReachable && directRoute) {
      logger.log('[GitHub] Google is reachable; downloading DepotDownloader directly from GitHub');
      return [directRoute];
    }

    if (acceleratorRoutes.length) {
      const order = acceleratorRoutes.map(candidate => candidate.name).join(' -> ');
      logger.log(`[GitHub] Google is unavailable; DepotDownloader route order: ${order}${directRoute ? ' -> direct' : ''}`);
      return directRoute ? acceleratorRoutes.concat(directRoute) : acceleratorRoutes;
    }
  }

  const order = candidates.map(candidate => candidate.name === 'direct' ? 'direct' : candidate.name).join(' -> ');
  logger.log(`[GitHub] DepotDownloader route order: ${order}`);
  return candidates;
}

async function downloadGithubRouteToFile(routes, dest, options = {}) {
  const GET = options.GET;
  if (typeof GET !== 'function') throw new Error('GET function is required');
  const logger = options.logger || console;
  const userAgent = options.userAgent || 'WallHub';
  let lastError = null;
  for (const route of routes) {
    try {
      logger.log(`[GitHub] Downloading DepotDownloader via ${route.name === 'direct' ? 'direct' : route.name}`);
      const buffer = await GET(route.url, {
        Accept: 'application/octet-stream',
        'User-Agent': userAgent,
      }, options.timeoutMs || 120000);
      if (!looksLikeZipBuffer(buffer)) {
        const sample = buffer.toString('utf8', 0, Math.min(buffer.length, 120)).replace(/\s+/g, ' ').trim();
        throw new Error(`response is not a zip (${buffer.length} bytes${sample ? `, starts with: ${sample}` : ''})`);
      }
      fs.writeFileSync(dest, buffer);
      return route;
    } catch (error) {
      lastError = error;
      logger.warn(`[GitHub] Route failed (${route.name === 'direct' ? 'direct' : route.name}): ${error.message}`);
    }
  }
  throw lastError || new Error('All GitHub download routes failed');
}

async function downloadFileBuffer(url, dest, options = {}) {
  const routes = await chooseGithubDownloadRoutes(url, options);
  await downloadGithubRouteToFile(routes, dest, options);
}

module.exports = {
  DEFAULT_GITHUB_PROXY_URLS,
  parseCsvEnv,
  isGithubDownloadUrl,
  buildGithubProxyUrl,
  githubProxyCandidates,
  looksLikeZipBuffer,
  chooseGithubDownloadRoutes,
  downloadGithubRouteToFile,
  downloadFileBuffer,
};
