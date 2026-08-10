'use strict';

const ENHANCED_STEAM_SUFFIXES = [
  '.steampowered.com',
  '.steam-api.com',
  '.steam-chat.com',
  '.steamgames.com',
  '.steamcommunity.com',
  '.steam.tv',
  '.s.team',
];

const CDN_SUFFIXES = [
  '.steamcontent.com',
  '.steamstatic.com',
  '.steamusercontent.com',
  '.eccdnx.com',
  '.pphimalayanrt.com',
  '.fastly.steamstatic.com',
  '.akamai.steamstatic.com',
  '.cloudflare.steamstatic.com',
];

function normalizeHost(hostname) {
  return String(hostname || '').trim().toLowerCase().replace(/^\.+|\.+$/g, '');
}

function matchesSuffix(host, suffix) {
  return host === suffix.slice(1) || host.endsWith(suffix);
}

function isSteamCdnHost(hostname) {
  const host = normalizeHost(hostname);
  if (!host) return false;
  if (CDN_SUFFIXES.some(suffix => matchesSuffix(host, suffix))) return true;
  if (host === 'steamcdn-a.akamaihd.net' || host === 'steamstatic-a.akamaihd.net') return true;
  if (host === 'steamvideo-a.akamaihd.net' || host.endsWith('.steamvideo-a.akamaihd.net')) return true;
  if (host === 'steambroadcast.akamaized.net' || host === 'steambroadcast-test.akamaized.net' || host === 'steambroadcastchat.akamaized.net') return true;
  if (host === 'broadcast.st.dl.eccdnx.com' || host === 'lv.queniujq.cn') return true;
  return /^[a-z0-9-]+\.steam\.[a-z0-9-]+\.com$/.test(host);
}

function isSteamEnhancedHost(hostname) {
  const host = normalizeHost(hostname);
  if (!host || isSteamCdnHost(host)) return false;
  if (host === 'steampowered.com' || host === 'steam-api.com' || host === 'steam-chat.com' || host === 'steamgames.com' || host === 'steamcommunity.com' || host === 'steam.tv' || host === 's.team') return true;
  return ENHANCED_STEAM_SUFFIXES.some(suffix => matchesSuffix(host, suffix));
}

function networkMode(hostname, { proxyConfigured = false, enhancementEnabled = false } = {}) {
  if (proxyConfigured) return 'proxy';
  if (isSteamEnhancedHost(hostname) && enhancementEnabled) return 'enhanced';
  return 'direct';
}

module.exports = {
  CDN_SUFFIXES,
  ENHANCED_STEAM_SUFFIXES,
  normalizeHost,
  isSteamCdnHost,
  isSteamEnhancedHost,
  networkMode,
};
