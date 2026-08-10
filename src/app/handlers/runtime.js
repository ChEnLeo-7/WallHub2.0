'use strict';

function createRuntimeHandlers(options = {}) {
  const {
    jsonRes,
    send,
    get,
    isDockerLikeEnv,
    isTermuxLikeEnv,
    runtimeSetupSnapshot,
    steamCdnStatusSnapshot,
    steamAccessRuntimeSnapshot,
    steamAccessDiagnosticSnapshot,
    steamKitDepotStreamingEnabled,
    getDepotStreamWorkerCount,
    getDepotStreamCacheMaxMb,
    updateService,
    platform,
    arch,
    supervised,
    version,
    getDownloaderMode,
    nsfwEnabled,
    getDownloadsDir,
    resolveDepotDownloaderPath,
    depotStreamCacheDir,
    depotStreamFirstRangeBytes,
    depotStreamMaxRangeBytes,
    ensureSteamAccessGatewayReady,
    steamAccessGatewayEnabled,
  } = options;

  async function handleDebug(res) {
    try {
      const url = 'https://steamcommunity.com/workshop/browse/?appid=431960&browsesort=trend&section=readytouseitems&actualsort=trend&p=1&numperpage=3&days=30&requiredtags%5B%5D=Video';
      const html = (await get(url)).toString('utf8');
      const idxData = html.indexOf('data-publishedfileid');
      const idxHref = html.indexOf('sharedfiles/filedetails');
      const idx = idxData >= 0 ? idxData : idxHref;

      let out = '=== WallHub Debug: Steam Workshop HTML Structure ===\n';
      out += `URL: ${url}\n`;
      out += `HTML total length: ${html.length} bytes\n\n`;

      if (idx === -1) {
        out += '[Error] NO workshop item id found in HTML!\n\n';
        out += `=== First 3000 chars ===\n${html.substring(0, 3000)}`;
      } else {
        const ids = Array.from(new Set([
          ...Array.from(html.matchAll(/data-publishedfileid=["'](\d+)["']/g)).map(match => match[1]),
          ...Array.from(html.matchAll(/sharedfiles\/filedetails\/\?id=(\d+)/g)).map(match => match[1]),
          ...Array.from(html.matchAll(/sharedfiles\\\/filedetails\\\/\?id=(\d+)/g)).map(match => match[1]),
        ]));
        out += `✓ Found ${ids.length} workshop item ids\n`;
        out += `IDs: ${ids.slice(0, 10).join(', ')}\n\n`;

        const imgTags = html.substring(idx - 500, idx + 3000).match(/<img[^>]+>/g) || [];
        out += `img tags near first item: ${imgTags.length}\n`;
        imgTags.forEach((tag, index) => { out += `  [${index}] ${tag}\n`; });
        out += `\n=== Block around first item (chars ${idx - 200} to ${idx + 2500}) ===\n`;
        out += html.substring(Math.max(0, idx - 200), idx + 2500);
      }

      send(res, 200, out, 'text/plain; charset=utf-8');
    } catch (error) {
      send(res, 500, `Debug Error: ${error.message}`, 'text/plain; charset=utf-8');
    }
  }

  async function handleServerRuntime(_req, res) {
    const docker = isDockerLikeEnv();
    const setup = runtimeSetupSnapshot();
    const steamCdn = steamCdnStatusSnapshot();
    const steamAccess = steamAccessRuntimeSnapshot();
    const depotStream = {
      enabled: steamKitDepotStreamingEnabled(),
      workers: getDepotStreamWorkerCount(),
      cacheMaxMb: getDepotStreamCacheMaxMb(),
    };
    const update = updateService.snapshot();
    const revision = [
      Number(setup.updatedAt || 0),
      Number(steamCdn.updatedAt || 0),
      Number(steamAccess.updatedAt || 0),
      Number(depotStream.workers || 0),
      depotStream.enabled ? 1 : 0,
      Number(update.updatedAt || 0),
    ].join(':');
    jsonRes(res, 200, {
      revision,
      platform,
      arch,
      docker,
      termux: isTermuxLikeEnv(),
      canRestart: true,
      canShutdown: !docker,
      supervised,
      version,
      downloaderMode: getDownloaderMode(),
      effectiveDownloader: setup.mode,
      nsfwEnabled,
      runtimeSetup: setup,
      steamCdn: {
        currentHost: steamCdn.currentHost,
        currentVHost: steamCdn.currentVHost,
        currentPort: steamCdn.currentPort,
        source: steamCdn.source,
        mode: steamCdn.mode,
        strategy: steamCdn.strategy,
        updatedAt: steamCdn.updatedAt,
      },
      steamAccess,
      depotStream,
      update,
      runnerDir: setup.runnerDir,
      accountDir: setup.accountDir,
      downloadsDir: getDownloadsDir(),
      steamKitPath: resolveDepotDownloaderPath() || '',
    });
  }

  async function handleServerRuntimeDiagnostics(_req, res) {
    const setup = runtimeSetupSnapshot();
    const steamCdn = steamCdnStatusSnapshot();
    const steamAccess = steamAccessDiagnosticSnapshot();
    const revision = [
      Number(setup.updatedAt || 0),
      Number(steamCdn.updatedAt || 0),
      Number(steamAccess.generatedAt || 0),
    ].join(':');
    jsonRes(res, 200, {
      revision,
      generatedAt: Date.now(),
      runtimeSetup: setup,
      steamCdn,
      steamAccess,
      depotStream: {
        enabled: steamKitDepotStreamingEnabled(),
        workers: getDepotStreamWorkerCount(),
        cacheDir: depotStreamCacheDir,
        cacheMaxMb: getDepotStreamCacheMaxMb(),
        firstRangeBytes: depotStreamFirstRangeBytes,
        rangeBytes: depotStreamMaxRangeBytes,
      },
    });
  }

  async function handleSteamAccessReady(_req, res) {
    const result = await ensureSteamAccessGatewayReady('frontend', 15000);
    jsonRes(res, 200, {
      enabled: steamAccessGatewayEnabled(),
      ready: !steamAccessGatewayEnabled() || !!result.ready,
      ok: result.ok || 0,
      total: result.total || 0,
      timeout: !!result.timeout,
    });
  }

  async function handleSteamAccessDiagnostics(_req, res) {
    jsonRes(res, 200, steamAccessDiagnosticSnapshot());
  }

  return {
    handleDebug,
    handleServerRuntime,
    handleServerRuntimeDiagnostics,
    handleSteamAccessReady,
    handleSteamAccessDiagnostics,
  };
}

module.exports = { createRuntimeHandlers };
