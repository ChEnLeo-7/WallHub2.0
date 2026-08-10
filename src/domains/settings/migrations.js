'use strict';

const {
  normalizeSteamCdnRouteStrategy,
  normalizeSteamHttpProxyUrl,
} = require('../../config/normalizers');

function migrateSteamCdnRouteSettings(settings, logger = console) {
  const next = settings || {};
  // Legacy builds exposed CDN mode / proxy mode as separate knobs. Avoid
  // resurrecting the old CDN-route coupling from those stale fields: only keep
  // an explicitly saved steamCdnRouteStrategy, otherwise default to Steam's
  // normal CDN selection.
  if (!Object.prototype.hasOwnProperty.call(next, 'steamCdnRouteStrategy')) {
    next.steamCdnRouteStrategy = 'nearest';
  }
  next.steamCdnRouteStrategy = normalizeSteamCdnRouteStrategy(next.steamCdnRouteStrategy);

  const oldProxyUrl = String(next.downloadProxyUrl || '').trim();
  next.steamHttpProxyUrl = String(next.steamHttpProxyUrl || oldProxyUrl || '').trim();
  if (next.steamHttpProxyUrl) {
    try {
      next.steamHttpProxyUrl = normalizeSteamHttpProxyUrl(next.steamHttpProxyUrl);
      next.steamCdnRouteStrategy = 'proxy';
    } catch (proxyErr) {
      logger.warn('[Settings] Ignoring invalid Steam HTTP proxy:', proxyErr.message);
      next.steamHttpProxyUrl = '';
      next.steamCdnRouteStrategy = 'nearest';
    }
  } else {
    next.steamCdnRouteStrategy = 'nearest';
  }
  return next;
}

function pruneLegacySteamCdnSettings(settings) {
  if (!settings) return settings;
  delete settings.downloadProxyMode;
  delete settings.downloadProxyUrl;
  delete settings.steamContentCdnMode;
  delete settings.steamContentCellId;
  return settings;
}

function pruneRemovedSteamAccessSettings(settings) {
  if (!settings) return settings;
  delete settings.wallhubSteamBridgeEnabled;
  delete settings.wallhubSteamBridgeFallback;
  delete settings.wallhubSteamAccessMigrationNotice;
  delete settings.wallhubSteamAccessSniMode;
  delete settings.wallhubSteamAccessSniHostname;
  delete settings.steamRemoteSubscribeEnabled;
  delete settings.useSteamApi;
  delete settings.workshopQueryMode;
  delete settings.workshopHtmlOrderMode;
  return settings;
}

module.exports = {
  migrateSteamCdnRouteSettings,
  pruneLegacySteamCdnSettings,
  pruneRemovedSteamAccessSettings,
};
