'use strict';

const {
  DEFAULT_STEAM_ACCESS_DOH_ENDPOINT,
  DEFAULT_STEAM_ACCESS_DOT_ENDPOINT,
  STEAM_ACCESS_SELECTED_ENDPOINT_LIMIT,
  STEAM_ACCESS_CUSTOM_ENDPOINT_LIMIT,
  normalizeSteamCdnRouteStrategy,
  normalizeSteamHttpProxyUrl,
  normalizeSteamKitMaxDownloads,
  normalizeDepotStreamCacheMaxMb,
  normalizeSteamAccessDohEndpoint,
  normalizeSteamAccessDotEndpoint,
  normalizeSteamAccessMode,
  normalizeSteamAccessResolverProtocol,
  normalizeSteamAccessResolverMode,
  normalizeSteamAccessEndpointList,
  normalizeSteamAccessHostsUrl,
  normalizeSteamAccessHostsUpdateIntervalHours,
} = require('../../config/normalizers');
const { DEFAULT_CACHE_SETTINGS } = require('./defaults');
const { pruneRemovedSteamAccessSettings } = require('./migrations');
const {
  anyStaticCdnHostEnhanceEnabled,
  includeEndpoint,
  normalizeHostsText,
  normalizeMpkgTextureProfile,
  normalizeSteamAccessEndpointSettings,
  normalizeSteamAccessExperimental,
  normalizeSteamAccessHostList,
  normalizeSteamAccessStaticCdnHosts,
  normalizeSteamDataSource,
  normalizeSteamWebApiHost,
  normalizeSteamWebApiProtocol,
  normalizeSteamWebApiRoute,
  normalizeTimestamp,
  normalizeWallhubLogLevel,
  stableStringify,
} = require('./normalizers');

function steamAccessSnapshot(settings) {
  return {
    enhance: !!settings.wallhubSteamAccessEnhance,
    webApiRoute: normalizeSteamWebApiRoute(settings.wallhubSteamWebApiRoute || (settings.wallhubSteamAccessDirectWebApi ? 'direct' : 'follow')),
    webApiProtocol: normalizeSteamWebApiProtocol(settings.wallhubSteamWebApiProtocol),
    webApiHost: normalizeSteamWebApiHost(settings.wallhubSteamWebApiHost),
    mode: normalizeSteamAccessMode(settings.wallhubSteamAccessMode),
    hosts: String(settings.wallhubSteamAccessHosts || ''),
    hostsUrl: String(settings.wallhubSteamAccessHostsUrl || ''),
    hostsAutoUpdate: !!settings.wallhubSteamAccessHostsAutoUpdateEnabled,
    hostsInterval: normalizeSteamAccessHostsUpdateIntervalHours(settings.wallhubSteamAccessHostsUpdateIntervalHours),
    protocol: normalizeSteamAccessResolverProtocol(settings.wallhubSteamAccessResolverProtocol),
    selectedDoh: normalizeSteamAccessEndpointList(settings.wallhubSteamAccessSelectedDohEndpoints, 'doh'),
    customDoh: normalizeSteamAccessEndpointList(settings.wallhubSteamAccessCustomDohEndpoints, 'doh'),
    selectedDot: normalizeSteamAccessEndpointList(settings.wallhubSteamAccessSelectedDotEndpoints, 'dot'),
    customDot: normalizeSteamAccessEndpointList(settings.wallhubSteamAccessCustomDotEndpoints, 'dot'),
    dohEndpoint: String(settings.wallhubSteamAccessDohEndpoint || DEFAULT_STEAM_ACCESS_DOH_ENDPOINT),
    dohMode: normalizeSteamAccessResolverMode(settings.wallhubSteamAccessDohMode),
    dotEndpoint: String(settings.wallhubSteamAccessDotEndpoint || DEFAULT_STEAM_ACCESS_DOT_ENDPOINT),
    dotMode: normalizeSteamAccessResolverMode(settings.wallhubSteamAccessDotMode),
    experimental: normalizeSteamAccessExperimental(settings.wallhubSteamAccessExperimental),
    hostBlacklist: normalizeSteamAccessHostList(settings.wallhubSteamAccessHostBlacklist),
    staticCdnEnhance: !!settings.wallhubSteamAccessStaticCdnEnhance,
    staticCdnHosts: normalizeSteamAccessStaticCdnHosts(settings.wallhubSteamAccessStaticCdnHosts),
  };
}

function applyCacheSettingsPatch(settings, data, options = {}) {
  const next = pruneRemovedSteamAccessSettings(Object.assign({}, settings || {}));
  const has = (key) => Object.prototype.hasOwnProperty.call(data || {}, key);
  const previousSteamApiKey = String(settings && settings.steamApiKey || '').trim();
  const previousSteamDataSource = normalizeSteamDataSource(settings && settings.steamDataSource);
  const previousSteamAccessSnapshot = steamAccessSnapshot(next);

  if (has('wallhubLogLevel')) next.wallhubLogLevel = normalizeWallhubLogLevel(data.wallhubLogLevel);
  else next.wallhubLogLevel = normalizeWallhubLogLevel(next.wallhubLogLevel);
  if (has('wallhubAutoUpdateEnabled')) next.wallhubAutoUpdateEnabled = !!data.wallhubAutoUpdateEnabled;
  else next.wallhubAutoUpdateEnabled = !!next.wallhubAutoUpdateEnabled;
  next.wallhubOnboardingCompletedAt = normalizeTimestamp(next.wallhubOnboardingCompletedAt);
  if (has('mpkgTextureProfile')) next.mpkgTextureProfile = normalizeMpkgTextureProfile(data.mpkgTextureProfile);
  else next.mpkgTextureProfile = normalizeMpkgTextureProfile(next.mpkgTextureProfile);
  delete next.mpkgMaxConcurrentBuilds;
  if (has('downloadDir') && typeof options.applyDownloadDir === 'function') next.downloadDir = options.applyDownloadDir(data.downloadDir);
  if (has('maxConcurrentDownloads') && typeof options.normalizeMaxConcurrentDownloads === 'function') next.maxConcurrentDownloads = options.normalizeMaxConcurrentDownloads(data.maxConcurrentDownloads);
  if (has('steamCdnRouteStrategy')) {
    next.steamCdnRouteStrategy = normalizeSteamCdnRouteStrategy(data.steamCdnRouteStrategy);
  } else if (has('steamContentCdnMode')) {
    next.steamCdnRouteStrategy = String(data.steamContentCdnMode || '').trim().toLowerCase() === 'proxy' ? 'proxy' : 'nearest';
  } else if (has('downloadProxyMode')) {
    next.steamCdnRouteStrategy = String(data.downloadProxyMode || '').trim().toLowerCase() === 'manual' ? 'proxy' : normalizeSteamCdnRouteStrategy(next.steamCdnRouteStrategy);
  }
  if (has('steamApiKey')) next.steamApiKey = String(data.steamApiKey || '').trim();
  else next.steamApiKey = String(next.steamApiKey || '').trim();
  if (has('steamDataSource')) next.steamDataSource = normalizeSteamDataSource(data.steamDataSource);
  else next.steamDataSource = normalizeSteamDataSource(next.steamDataSource);
  if (has('steamHttpProxyUrl')) next.steamHttpProxyUrl = String(data.steamHttpProxyUrl || '').trim();
  else if (has('downloadProxyUrl')) next.steamHttpProxyUrl = String(data.downloadProxyUrl || '').trim();
  if (next.steamHttpProxyUrl) {
    next.steamHttpProxyUrl = normalizeSteamHttpProxyUrl(next.steamHttpProxyUrl);
    next.steamCdnRouteStrategy = 'proxy';
  } else {
    next.steamCdnRouteStrategy = 'nearest';
  }
  if (has('steamKitMaxDownloads')) next.steamKitMaxDownloads = normalizeSteamKitMaxDownloads(data.steamKitMaxDownloads);
  if (has('steamKitDepotStreaming')) next.steamKitDepotStreaming = !!data.steamKitDepotStreaming;

  if (has('wallhubSteamAccessEnhance')) next.wallhubSteamAccessEnhance = !!data.wallhubSteamAccessEnhance;
  if (has('wallhubSteamAccessDirectWebApi') && !has('wallhubSteamWebApiRoute')) next.wallhubSteamWebApiRoute = data.wallhubSteamAccessDirectWebApi ? 'direct' : 'follow';
  if (has('wallhubSteamWebApiRoute')) next.wallhubSteamWebApiRoute = normalizeSteamWebApiRoute(data.wallhubSteamWebApiRoute);
  if (has('wallhubSteamWebApiProtocol')) next.wallhubSteamWebApiProtocol = normalizeSteamWebApiProtocol(data.wallhubSteamWebApiProtocol);
  if (has('wallhubSteamWebApiHost')) next.wallhubSteamWebApiHost = normalizeSteamWebApiHost(data.wallhubSteamWebApiHost);
  next.wallhubSteamAccessDirectWebApi = normalizeSteamWebApiRoute(next.wallhubSteamWebApiRoute) === 'direct';
  if (has('wallhubSteamAccessMode')) {
    const rawMode = String(data.wallhubSteamAccessMode || 'resolver').trim().toLowerCase();
    if (rawMode === 'dot' || rawMode === 'doh') {
      next.wallhubSteamAccessMode = 'resolver';
      next.wallhubSteamAccessResolverProtocol = rawMode;
    } else {
      next.wallhubSteamAccessMode = normalizeSteamAccessMode(rawMode);
    }
  }
  if (has('wallhubSteamAccessHosts')) next.wallhubSteamAccessHosts = normalizeHostsText(data.wallhubSteamAccessHosts);
  if (has('wallhubSteamAccessHostsUrl')) next.wallhubSteamAccessHostsUrl = normalizeSteamAccessHostsUrl(data.wallhubSteamAccessHostsUrl);
  if (has('wallhubSteamAccessHostsAutoUpdateEnabled')) next.wallhubSteamAccessHostsAutoUpdateEnabled = !!data.wallhubSteamAccessHostsAutoUpdateEnabled;
  if (has('wallhubSteamAccessHostsUpdateIntervalHours')) next.wallhubSteamAccessHostsUpdateIntervalHours = normalizeSteamAccessHostsUpdateIntervalHours(data.wallhubSteamAccessHostsUpdateIntervalHours);
  if (has('wallhubSteamAccessHostsLastUpdatedAt')) next.wallhubSteamAccessHostsLastUpdatedAt = normalizeTimestamp(data.wallhubSteamAccessHostsLastUpdatedAt);
  if (has('wallhubSteamAccessHostsLastError')) next.wallhubSteamAccessHostsLastError = String(data.wallhubSteamAccessHostsLastError || '').slice(0, 1000);
  if (has('wallhubSteamAccessResolverProtocol')) next.wallhubSteamAccessResolverProtocol = normalizeSteamAccessResolverProtocol(data.wallhubSteamAccessResolverProtocol);
  if (has('wallhubSteamAccessDohEndpoint')) {
    next.wallhubSteamAccessDohEndpoint = normalizeSteamAccessDohEndpoint(data.wallhubSteamAccessDohEndpoint);
    includeEndpoint(next.wallhubSteamAccessSelectedDohEndpoints, next.wallhubSteamAccessDohEndpoint);
  }
  if (has('wallhubSteamAccessDohMode')) next.wallhubSteamAccessDohMode = normalizeSteamAccessResolverMode(data.wallhubSteamAccessDohMode);
  if (has('wallhubSteamAccessDotEndpoint')) {
    next.wallhubSteamAccessDotEndpoint = normalizeSteamAccessDotEndpoint(data.wallhubSteamAccessDotEndpoint);
    includeEndpoint(next.wallhubSteamAccessSelectedDotEndpoints, next.wallhubSteamAccessDotEndpoint);
  }
  if (has('wallhubSteamAccessDotMode')) next.wallhubSteamAccessDotMode = normalizeSteamAccessResolverMode(data.wallhubSteamAccessDotMode);
  if (has('wallhubSteamAccessCustomDohEndpoints')) next.wallhubSteamAccessCustomDohEndpoints = normalizeSteamAccessEndpointList(data.wallhubSteamAccessCustomDohEndpoints, 'doh', { limit: STEAM_ACCESS_CUSTOM_ENDPOINT_LIMIT, strict: true });
  if (has('wallhubSteamAccessCustomDotEndpoints')) next.wallhubSteamAccessCustomDotEndpoints = normalizeSteamAccessEndpointList(data.wallhubSteamAccessCustomDotEndpoints, 'dot', { limit: STEAM_ACCESS_CUSTOM_ENDPOINT_LIMIT, strict: true });
  if (has('wallhubSteamAccessSelectedDohEndpoints')) next.wallhubSteamAccessSelectedDohEndpoints = normalizeSteamAccessEndpointList(data.wallhubSteamAccessSelectedDohEndpoints, 'doh', { limit: STEAM_ACCESS_SELECTED_ENDPOINT_LIMIT, strict: true });
  if (has('wallhubSteamAccessSelectedDotEndpoints')) next.wallhubSteamAccessSelectedDotEndpoints = normalizeSteamAccessEndpointList(data.wallhubSteamAccessSelectedDotEndpoints, 'dot', { limit: STEAM_ACCESS_SELECTED_ENDPOINT_LIMIT, strict: true });
  if (has('wallhubSteamAccessExperimental')) next.wallhubSteamAccessExperimental = normalizeSteamAccessExperimental(data.wallhubSteamAccessExperimental);
  else next.wallhubSteamAccessExperimental = normalizeSteamAccessExperimental(next.wallhubSteamAccessExperimental);
  if (has('wallhubSteamAccessHostBlacklist')) next.wallhubSteamAccessHostBlacklist = normalizeSteamAccessHostList(data.wallhubSteamAccessHostBlacklist);
  else next.wallhubSteamAccessHostBlacklist = normalizeSteamAccessHostList(next.wallhubSteamAccessHostBlacklist);
  if (has('wallhubSteamAccessStaticCdnHosts')) next.wallhubSteamAccessStaticCdnHosts = normalizeSteamAccessStaticCdnHosts(data.wallhubSteamAccessStaticCdnHosts);
  else next.wallhubSteamAccessStaticCdnHosts = normalizeSteamAccessStaticCdnHosts(next.wallhubSteamAccessStaticCdnHosts);
  if (has('wallhubSteamAccessStaticCdnEnhance')) {
    next.wallhubSteamAccessStaticCdnEnhance = !!data.wallhubSteamAccessStaticCdnEnhance;
    if (!has('wallhubSteamAccessStaticCdnHosts')) {
      next.wallhubSteamAccessStaticCdnHosts.imagesSteamusercontent.enhance = next.wallhubSteamAccessStaticCdnEnhance;
      next.wallhubSteamAccessStaticCdnHosts.sharedAkamaiSteamstatic.enhance = next.wallhubSteamAccessStaticCdnEnhance;
    }
  }
  next.wallhubSteamAccessStaticCdnEnhance = anyStaticCdnHostEnhanceEnabled(next.wallhubSteamAccessStaticCdnHosts);
  normalizeSteamAccessEndpointSettings(next, options.logger || console, { migrateSingleEndpoints: false });
  delete next.wallhubSteamResourceProxy;
  if (has('depotStreamCacheMaxMb')) next.depotStreamCacheMaxMb = normalizeDepotStreamCacheMaxMb(data.depotStreamCacheMaxMb);
  pruneRemovedSteamAccessSettings(next);

  const currentSteamAccessSnapshot = steamAccessSnapshot(next);
  const steamAccessEnhanceChanged = previousSteamAccessSnapshot.enhance !== currentSteamAccessSnapshot.enhance;
  const steamAccessDirectWebApiChanged = previousSteamAccessSnapshot.webApiRoute !== currentSteamAccessSnapshot.webApiRoute ||
    previousSteamAccessSnapshot.webApiProtocol !== currentSteamAccessSnapshot.webApiProtocol ||
    previousSteamAccessSnapshot.webApiHost !== currentSteamAccessSnapshot.webApiHost;
  const steamAccessModeChanged = previousSteamAccessSnapshot.mode !== currentSteamAccessSnapshot.mode;
  const steamAccessHostsChanged = previousSteamAccessSnapshot.hosts !== currentSteamAccessSnapshot.hosts ||
    previousSteamAccessSnapshot.hostsUrl !== currentSteamAccessSnapshot.hostsUrl ||
    previousSteamAccessSnapshot.hostsAutoUpdate !== currentSteamAccessSnapshot.hostsAutoUpdate ||
    previousSteamAccessSnapshot.hostsInterval !== currentSteamAccessSnapshot.hostsInterval;
  const steamAccessResolverChanged = previousSteamAccessSnapshot.protocol !== currentSteamAccessSnapshot.protocol ||
    previousSteamAccessSnapshot.dohEndpoint !== currentSteamAccessSnapshot.dohEndpoint ||
    previousSteamAccessSnapshot.dohMode !== currentSteamAccessSnapshot.dohMode ||
    previousSteamAccessSnapshot.dotEndpoint !== currentSteamAccessSnapshot.dotEndpoint ||
    previousSteamAccessSnapshot.dotMode !== currentSteamAccessSnapshot.dotMode ||
    stableStringify(previousSteamAccessSnapshot.selectedDoh) !== stableStringify(currentSteamAccessSnapshot.selectedDoh) ||
    stableStringify(previousSteamAccessSnapshot.customDoh) !== stableStringify(currentSteamAccessSnapshot.customDoh) ||
    stableStringify(previousSteamAccessSnapshot.selectedDot) !== stableStringify(currentSteamAccessSnapshot.selectedDot) ||
    stableStringify(previousSteamAccessSnapshot.customDot) !== stableStringify(currentSteamAccessSnapshot.customDot) ||
    stableStringify(previousSteamAccessSnapshot.experimental) !== stableStringify(currentSteamAccessSnapshot.experimental) ||
    stableStringify(previousSteamAccessSnapshot.hostBlacklist) !== stableStringify(currentSteamAccessSnapshot.hostBlacklist) ||
    previousSteamAccessSnapshot.staticCdnEnhance !== currentSteamAccessSnapshot.staticCdnEnhance ||
    stableStringify(previousSteamAccessSnapshot.staticCdnHosts) !== stableStringify(currentSteamAccessSnapshot.staticCdnHosts) ||
    steamAccessModeChanged || steamAccessHostsChanged;

  return {
    settings: next,
    steamAccessEnhanceChanged,
    steamAccessDirectWebApiChanged,
    steamAccessModeChanged,
    steamAccessHostsChanged,
    steamAccessDohChanged: steamAccessResolverChanged,
    steamAccessResolverChanged,
    steamApiKeyChanged: has('steamApiKey') && previousSteamApiKey !== next.steamApiKey,
    steamDataSourceChanged: has('steamDataSource') && previousSteamDataSource !== next.steamDataSource,
  };
}

module.exports = {
  applyCacheSettingsPatch,
};
