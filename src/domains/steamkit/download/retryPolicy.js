'use strict';

function createDownloadRetryPolicy(deps, auth) {
  const {
    shouldRetrySteamLoginRequiredError,
    refreshPersistentSteamLoginForRetry,
    logger = console,
  } = deps;

  async function retry(error, context) {
    const { publishedFileId, appId, title, options, download } = context;
    const err = auth.normalizeError(error);
    if (!options._steamContentAutoRetry && err.code === 'STEAM_CONTENT_STALLED') {
      if (options.task) {
        options.task.progressIndeterminate = true;
        options.task.progressStage = 'SteamPipe CDN 已停滞，正在保留可信进度并快速校验续传';
        options.task.progressStageMode = 'loading';
        options.task.speed = 0;
      }
      logger.warn(`[SteamKit] Download ${publishedFileId} content stream stalled; restarting once from the trusted checkpoint.`);
      return download(publishedFileId, appId, title, Object.assign({}, options, { _steamContentAutoRetry: true }));
    }

    const configuredSteam3Protocol = String(process.env.WALLHUB_DEPOT_STEAM3_PROTOCOL || process.env.WALLHUB_STEAM3_PROTOCOL || '').trim();
    if (!options._steam3WebsocketRetry && !configuredSteam3Protocol && err.code === 'STEAM_NETWORK_UNREACHABLE') {
      if (options.task) {
        options.task.progressIndeterminate = true;
        options.task.progressStage = 'Steam3 直连超时，正在使用 websocket 重试';
        options.task.speed = 0;
      }
      logger.warn(`[SteamKit] Download ${publishedFileId} Steam3 connection timed out; retrying once with websocket protocol.`);
      return download(publishedFileId, appId, title, Object.assign({}, options, {
        _steam3WebsocketRetry: true,
        steam3ProtocolOverride: 'websocket',
      }));
    }

    if (!options._steamLoginAutoRetry && shouldRetrySteamLoginRequiredError(err)) {
      if (options.task) {
        options.task.progressIndeterminate = true;
        options.task.progressStage = 'SteamKit saved session needs a retry; validating local login';
        options.task.speed = 0;
      }
      logger.warn(`[SteamKit] Download ${publishedFileId} reported login required despite cached account; retrying once.`);
      const refreshed = await refreshPersistentSteamLoginForRetry(`download:${publishedFileId}`);
      if (refreshed) {
        return download(publishedFileId, appId, title, Object.assign({}, options, { _steamLoginAutoRetry: true }));
      }
    }
    throw err;
  }

  return { retry };
}

module.exports = { createDownloadRetryPolicy };
