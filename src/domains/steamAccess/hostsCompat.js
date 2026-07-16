'use strict';

const net = require('net');

const COMMUNITY_AKAMAI_HOSTS = [
  'steamcommunity-a.akamaihd.net.edgesuite.net',
  'steamcommunity-a.akamaihd.net',
  'community.akamai.steamstatic.com',
];

const STORE_AKAMAI_HOSTS = [
  'steamstore-a.akamaihd.net.edgesuite.net',
  'steamstore-a.akamaihd.net',
  'store.akamai.steamstatic.com',
];

const USER_IMAGES_AKAMAI_HOSTS = [
  'steamuserimages-a.akamaihd.net.edgesuite.net',
  'steamuserimages-a.akamaihd.net',
  'steamusercontent-a.akamaihd.net',
  'images.akamai.steamusercontent.com',
];

const STATIC_AKAMAI_BY_PREFIX = {
  community: ['community.akamai.steamstatic.com', 'steamcommunity-a.akamaihd.net', 'steamcommunity-a.akamaihd.net.edgesuite.net'],
  avatars: ['avatars.akamai.steamstatic.com'],
  store: STORE_AKAMAI_HOSTS,
  cdn: ['cdn.akamai.steamstatic.com', 'steamcdn-a.akamaihd.net'],
  shared: ['shared.akamai.steamstatic.com'],
  clan: ['clan.akamai.steamstatic.com'],
  video: ['video.akamai.steamstatic.com', 'steamvideo-a.akamaihd.net'],
};

function normalizeHost(hostname) {
  return String(hostname || '').trim().toLowerCase();
}

function isValidHostsName(host) {
  return !!host && !host.includes('/') && !host.includes('://') && !/\s/.test(host);
}

function parseHostsText(text) {
  const map = new Map();
  for (const rawLine of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const line = String(rawLine || '').trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    const body = line.split(/\s+#|\s+;/, 1)[0].trim();
    const parts = body.split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;
    const ip = parts[0];
    const family = net.isIP(ip);
    if (family !== 4 && family !== 6) continue;
    for (const item of parts.slice(1)) {
      const host = normalizeHost(item);
      if (!isValidHostsName(host)) continue;
      map.set(host, { ip, host, family });
    }
  }
  return map;
}

function unique(items) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const host = normalizeHost(item);
    if (!host || seen.has(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out;
}

function compatibleHostnamesFor(hostname) {
  const h = normalizeHost(hostname);
  const out = [h];

  if (h === 'steamcommunity.com' || h === 'www.steamcommunity.com' || h.endsWith('.steamcommunity.com')) {
    out.push(...COMMUNITY_AKAMAI_HOSTS);
  }

  if (h === 'api.steampowered.com' || h === 'community.steam-api.com' || h === 'help.steampowered.com' || h === 'login.steampowered.com' || h === 'support.steampowered.com') {
    out.push(...COMMUNITY_AKAMAI_HOSTS);
  }

  if (h === 'store.steampowered.com' || h === 'checkout.steampowered.com' || h === 'media.steampowered.com' || h === 'store.akamai.steamstatic.com') {
    out.push(...STORE_AKAMAI_HOSTS);
  }

  if (h === 'images.steamusercontent.com' || h.endsWith('.steamusercontent.com') || h === 'steamuserimages-a.akamaihd.net' || /^steamuserimages-[a-z0-9-]+\.akamaihd\.net$/i.test(h)) {
    out.push(...USER_IMAGES_AKAMAI_HOSTS);
  }

  if (h === 'steamcdn-a.akamaihd.net' || h === 'cdn.akamai.steamstatic.com' || h === 'cdn.cloudflare.steamstatic.com') {
    out.push('steamcdn-a.akamaihd.net', 'cdn.akamai.steamstatic.com', 'cdn.cloudflare.steamstatic.com');
  }

  if (h === 'steambroadcast.akamaized.net') out.push('steambroadcast.akamaized.net');
  if (h === 'steamvideo-a.akamaihd.net') out.push('steamvideo-a.akamaihd.net', 'video.akamai.steamstatic.com');
  if (h === 'steam-chat.com') out.push('steam-chat.com');
  if (h === 'steamgames.com') out.push('steamgames.com');

  const staticMatch = h.match(/^([a-z0-9-]+)\.steamstatic\.com$/i) || h.match(/^([a-z0-9-]+)\.(?:akamai|cloudflare|fastly)\.steamstatic\.com$/i);
  if (staticMatch && STATIC_AKAMAI_BY_PREFIX[staticMatch[1]]) {
    out.push(...STATIC_AKAMAI_BY_PREFIX[staticMatch[1]]);
  }

  return unique(out);
}

function selectHostsRoute(textOrMap, hostname) {
  const hostsMap = textOrMap instanceof Map ? textOrMap : parseHostsText(textOrMap);
  const aliases = compatibleHostnamesFor(hostname);
  for (let index = 0; index < aliases.length; index += 1) {
    const matchedHost = aliases[index];
    const entry = hostsMap.get(matchedHost);
    if (!entry) continue;
    const family = net.isIP(entry.ip);
    if (family !== 4 && family !== 6) continue;
    return {
      ip: entry.ip,
      family,
      host: normalizeHost(hostname),
      matchedHost,
      exact: index === 0,
      source: index === 0 ? 'hosts' : 'hosts-compatible',
    };
  }
  return null;
}

module.exports = {
  parseHostsText,
  compatibleHostnamesFor,
  selectHostsRoute,
};
