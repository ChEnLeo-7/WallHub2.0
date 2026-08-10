'use strict';

function createSettingsHandlers(options = {}) {
  const {
    jsonRes,
    readBody,
    isReadAllowed,
    isMutationAllowed,
    getSettings,
    setSettings,
    getRuntimeSettings,
    saveSettings,
    settingsSnapshot,
    steamAccessGateway,
    clearWorkshopCaches,
    updateService,
    hostsUpdater,
    warmupSteamAccessGatewayCore,
    warmupSteamAccessGatewayCdnBackground,
    logSteamAccessResolvedRoutes,
    cleanupDepotStreamCache,
    depotStreamCacheCleanupTarget,
    stopAllDepotStreamWorkers,
    stopSteamKitQueryBridge = () => {},
    warmupDepotStreamDownloader,
    triggerQueue,
    clearDepotStreamCacheNow,
    getSteamCdnRouteStrategy,
    getSteamKitMaxDownloads,
    truncateClientEventValue,
    shouldLogClientEvent,
    debugEnabled,
    logger = console,
  } = options;

  function rejectUntrustedSettingsRequest(req, res, isAllowed = isMutationAllowed) {
    if (isAllowed(req)) return false;
    jsonRes(res, 403, {
      error: 'Cross-site settings requests are not allowed',
      code: 'SETTINGS_ORIGIN_DENIED',
    });
    return true;
  }

  async function handleSteamAccessHostsFetch(req, res) {
    if (!isMutationAllowed(req)) {
      return jsonRes(res, 403, {
        success: false,
        error: 'Cross-site Hosts requests are not allowed',
        code: 'HOSTS_ORIGIN_DENIED',
      });
    }
    try {
      const data = JSON.parse(await readBody(req));
      if (typeof data.save !== 'boolean') {
        return jsonRes(res, 400, { success: false, error: 'Hosts save choice is required' });
      }
      jsonRes(res, 200, await hostsUpdater.fetchAndMaybeSave(data.url, data.save));
    } catch (error) {
      jsonRes(res, 400, { success: false, error: error.message || 'Hosts fetch failed' });
    }
  }

  async function handleClientEvent(req, res) {
    try {
      const payload = JSON.parse(await readBody(req));
      const experimental = getRuntimeSettings().getSteamAccessExperimental();
      const eventName = truncateClientEventValue(payload.event || payload.type || 'event', 48);
      if (shouldLogClientEvent(eventName, experimental, debugEnabled)) {
        const action = truncateClientEventValue(payload.action || '', 48);
        const id = truncateClientEventValue(payload.id || payload.publishedfileid || '', 32).replace(/[^0-9]/g, '');
        const source = truncateClientEventValue(payload.source || '', 48);
        const itemType = truncateClientEventValue(payload.itemType || '', 48);
        const title = truncateClientEventValue(payload.title || '', 120);
        logger.log(`[ClientEvent] event=${eventName || 'event'} action=${action || '-'} id=${id || '-'} source=${source || '-'} itemType=${itemType || '-'} title="${title.replace(/"/g, "'")}"`);
      }
      jsonRes(res, 200, { success: true });
    } catch (error) {
      jsonRes(res, 400, { success: false, error: error.message || 'Invalid client event' });
    }
  }

  async function handleVideoCacheSettingsGet(req, res) {
    if (rejectUntrustedSettingsRequest(req, res, isReadAllowed)) return;
    jsonRes(res, 200, settingsSnapshot());
  }

  async function handleVideoCacheSettingsDetailsGet(req, res) {
    if (rejectUntrustedSettingsRequest(req, res, isReadAllowed)) return;
    jsonRes(res, 200, {
      wallhubSteamAccessHosts: String(getSettings().wallhubSteamAccessHosts || ''),
      wallhubSteamAccessHostsDeferred: false,
    });
  }

  async function handleDepotStreamCacheClear(_req, res) {
    jsonRes(res, 200, clearDepotStreamCacheNow());
  }

  async function handleVideoCacheSettingsPost(req, res) {
    if (rejectUntrustedSettingsRequest(req, res)) return;
    try {
      const data = JSON.parse(await readBody(req));
      const currentSettings = getSettings();
      const previousStreamSettings = {
        steamCdnRouteStrategy: getSteamCdnRouteStrategy(),
        steamHttpProxyUrl: currentSettings.steamHttpProxyUrl || '',
        steamKitMaxDownloads: getSteamKitMaxDownloads(),
        steamKitDepotStreaming: !!currentSettings.steamKitDepotStreaming,
      };
      getRuntimeSettings().setState(currentSettings);
      const patchResult = getRuntimeSettings().applyPatch(data);
      setSettings(patchResult.settings);
      const workshopSearchSettingsChanged = patchResult.steamApiKeyChanged ||
        patchResult.steamDataSourceChanged ||
        patchResult.steamAccessResolverChanged ||
        patchResult.steamAccessEnhanceChanged ||
        patchResult.steamAccessDirectWebApiChanged;
      if (patchResult.steamAccessEnhanceChanged) {
        steamAccessGateway.clear();
      } else {
        if (patchResult.steamAccessResolverChanged) steamAccessGateway.clear(['resolver']);
        if (patchResult.steamAccessHostsChanged) steamAccessGateway.clear(['hosts']);
      }
      if (patchResult.steamAccessEnhanceChanged || patchResult.steamAccessDirectWebApiChanged) {
        stopSteamKitQueryBridge('steam-access-settings-changed');
      }
      if (workshopSearchSettingsChanged) clearWorkshopCaches();

      saveSettings();
      updateService.scheduleSoon();
      if (patchResult.steamAccessHostsChanged) hostsUpdater.schedule();
      const nextSettings = getSettings();
      const steamAccessShouldWarm = !!nextSettings.wallhubSteamAccessEnhance || getRuntimeSettings().steamAccessStaticCdnEnhanceEnabled();
      if (steamAccessShouldWarm) {
        if (nextSettings.wallhubSteamAccessEnhance) warmupSteamAccessGatewayCore('settings-core', { forceRefresh: false });
        setTimeout(() => warmupSteamAccessGatewayCdnBackground('settings-cdn').catch(() => {}), 8000).unref?.();
        if (nextSettings.wallhubSteamAccessMode === 'hosts' && patchResult.steamAccessHostsChanged) {
          logSteamAccessResolvedRoutes('HOSTS applied').catch(error => logger.warn('[SteamAccess] hosts route log failed:', error.message));
        }
      }
      setTimeout(() => cleanupDepotStreamCache({
        force: true,
        targetWatermark: depotStreamCacheCleanupTarget,
      }), 100).unref?.();
      const nextStreamSettings = {
        steamCdnRouteStrategy: getSteamCdnRouteStrategy(),
        steamHttpProxyUrl: nextSettings.steamHttpProxyUrl || '',
        steamKitMaxDownloads: getSteamKitMaxDownloads(),
        steamKitDepotStreaming: !!nextSettings.steamKitDepotStreaming,
      };
      if (JSON.stringify(previousStreamSettings) !== JSON.stringify(nextStreamSettings)) {
        stopAllDepotStreamWorkers('settings-changed');
      }
      warmupDepotStreamDownloader('settings');
      triggerQueue();

      jsonRes(res, 200, settingsSnapshot({ success: true }));
    } catch (error) {
      jsonRes(res, 400, { error: error.message || 'Invalid JSON' });
    }
  }

  return {
    handleSteamAccessHostsFetch,
    handleClientEvent,
    handleVideoCacheSettingsGet,
    handleVideoCacheSettingsDetailsGet,
    handleDepotStreamCacheClear,
    handleVideoCacheSettingsPost,
  };
}

module.exports = { createSettingsHandlers };
