'use strict';

const { isSteamCdnHost, isSteamEnhancedHost } = require('../../infrastructure/steam/networkPolicy');

function normalizeHost(hostname) {
  return String(hostname || '').toLowerCase();
}

function isSteamHost(hostname) {
  const h = normalizeHost(hostname);
  return h === 'steamcommunity.com' || h.endsWith('.steamcommunity.com') ||
    h === 'steampowered.com' || h.endsWith('.steampowered.com') ||
    h === 'steam-api.com' || h.endsWith('.steam-api.com') ||
    h === 'steamusercontent.com' || h.endsWith('.steamusercontent.com') ||
    h === 'steamcontent.com' || h.endsWith('.steamcontent.com') ||
    h === 'steamstatic.com' || h.endsWith('.steamstatic.com') ||
    h === 's.team' || h.endsWith('.s.team') ||
    h === 'steam-chat.com' || h.endsWith('.steam-chat.com') ||
    h === 'steam.tv' || h.endsWith('.steam.tv') ||
    h === 'steambroadcast.akamaized.net' ||
    h === 'steambroadcast-test.akamaized.net' ||
    h === 'steambroadcastchat.akamaized.net' ||
    h === 'steamvideo-a.akamaihd.net' || h.endsWith('.steamvideo-a.akamaihd.net') ||
    h === 'broadcast.st.dl.eccdnx.com' ||
    h === 'lv.queniujq.cn' ||
    h === 'steamgames.com' || h.endsWith('.steamgames.com') ||
    h === 'valvesoftware.com' || h.endsWith('.valvesoftware.com') ||
    h === 'steamsupport.valvesoftware.com' ||
    h === 'steamstat.us' || h.endsWith('.steamstat.us') ||
    h === 'steamstats.valve.org' ||
    h === 'akamaihd.net' || h.endsWith('.akamaihd.net') ||
    h === 'steamcdn-a.akamaihd.net' ||
    h === 'steamstatic-a.akamaihd.net' ||
    h === 'fastly.steamstatic.com' || h.endsWith('.fastly.steamstatic.com') ||
    h === 'akamai.steamstatic.com' || h.endsWith('.akamai.steamstatic.com') ||
    h === 'cloudflare.steamstatic.com' || h.endsWith('.cloudflare.steamstatic.com') ||
    h === 'steamserver.net' || h.endsWith('.steamserver.net');
}

function isSteamStaticCdnHost(hostname) {
  const h = normalizeHost(hostname);
  return h === 'steamstatic.com' || h.endsWith('.steamstatic.com') ||
    h === 'steamusercontent.com' || h.endsWith('.steamusercontent.com') ||
    h === 'akamaihd.net' || h.endsWith('.akamaihd.net') ||
    h === 'steamcdn-a.akamaihd.net' ||
    h === 'steamstatic-a.akamaihd.net' ||
    h === 'fastly.steamstatic.com' || h.endsWith('.fastly.steamstatic.com') ||
    h === 'akamai.steamstatic.com' || h.endsWith('.akamai.steamstatic.com') ||
    h === 'cloudflare.steamstatic.com' || h.endsWith('.cloudflare.steamstatic.com');
}

function isSteamBroadcastMediaCdnHost(hostname) {
  const h = normalizeHost(hostname);
  return h === 'steambroadcast.akamaized.net' ||
    h === 'steambroadcast-test.akamaized.net' ||
    h === 'steambroadcastchat.akamaized.net' ||
    h === 'steamvideo-a.akamaihd.net' || h.endsWith('.steamvideo-a.akamaihd.net') ||
    h === 'video.akamai.steamstatic.com' || h.endsWith('.video.akamai.steamstatic.com') ||
    h === 'broadcast.st.dl.eccdnx.com' ||
    h === 'lv.queniujq.cn';
}

function isSteamBroadcastResource(hostname, pathname = '/') {
  const h = normalizeHost(hostname);
  const path = String(pathname || '/').toLowerCase();
  if ((h === 'steamcontent.com' || h.endsWith('.steamcontent.com')) && /^\/broadcast(?:\/|$)/.test(path)) return true;
  if (isSteamBroadcastMediaCdnHost(h)) return true;
  if (h === 'community.fastly.steamstatic.com') {
    return /^\/public\//.test(path) && /(?:broadcast|dash_player)/.test(path) && /\.(?:js|css)(?:$|[?#])/.test(path);
  }
  return false;
}

function isSteamAccessGatewayHost(hostname) {
  const h = normalizeHost(hostname);
  return isSteamEnhancedHost(h) && !isSteamCdnHost(h);
}

function isSteamAccessStaticBypassHost(hostname) {
  const h = normalizeHost(hostname);
  return h === 'images.steamusercontent.com';
}

function isSteamCommunityHost(hostname) {
  const h = normalizeHost(hostname);
  return h === 'steamcommunity.com' || h.endsWith('.steamcommunity.com');
}

module.exports = {
  isSteamHost,
  isSteamStaticCdnHost,
  isSteamBroadcastMediaCdnHost,
  isSteamBroadcastResource,
  isSteamAccessGatewayHost,
  isSteamAccessStaticBypassHost,
  isSteamCommunityHost,
};
