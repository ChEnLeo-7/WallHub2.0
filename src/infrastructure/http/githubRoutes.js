'use strict';

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

module.exports = {
  DEFAULT_GITHUB_PROXY_URLS,
  parseCsvEnv,
  isGithubDownloadUrl,
  buildGithubProxyUrl,
  githubProxyCandidates,
};
