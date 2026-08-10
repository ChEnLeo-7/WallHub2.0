'use strict';

const {
  DEFAULT_CACHE_SETTINGS,
  DEFAULT_STEAM_ACCESS_STATIC_CDN_HOSTS,
} = require('./defaults');
const {
  migrateSteamCdnRouteSettings,
  pruneLegacySteamCdnSettings,
  pruneRemovedSteamAccessSettings,
} = require('./migrations');
const {
  normalizeHostsText,
  normalizeLoadedCacheSettings,
  normalizeMpkgTextureProfile,
  normalizeSteamAccessExperimental,
  normalizeSteamAccessHostList,
  normalizeSteamAccessStaticCdnHosts,
  normalizeSteamDataSource,
  normalizeWallhubLogLevel,
  parseSteamHostsText,
} = require('./normalizers');
const { applyCacheSettingsPatch } = require('./patch');

module.exports = {
  DEFAULT_CACHE_SETTINGS,
  DEFAULT_STEAM_ACCESS_STATIC_CDN_HOSTS,
  migrateSteamCdnRouteSettings,
  pruneLegacySteamCdnSettings,
  pruneRemovedSteamAccessSettings,
  normalizeLoadedCacheSettings,
  applyCacheSettingsPatch,
  normalizeSteamAccessExperimental,
  normalizeSteamAccessHostList,
  normalizeSteamAccessStaticCdnHosts,
  normalizeSteamDataSource,
  normalizeWallhubLogLevel,
  normalizeMpkgTextureProfile,
  normalizeHostsText,
  parseSteamHostsText,
};
