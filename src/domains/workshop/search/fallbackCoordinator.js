'use strict';

function createFallbackCoordinator(options = {}) {
  let fallbackReason = '';
  let steamWebApiWarning = false;

  function markSteamWebApiWarning(error) {
    const message = String(error && error.message || error || '').toLowerCase();
    if (!message || /abort/.test(message)) return;
    if (message.includes('api.steampowered.com') || message.includes('timeout') || message.includes('timed out') || message.includes('steamapi') || message.includes('filedetails')) {
      steamWebApiWarning = true;
    }
  }

  function noteSourceData(sourceData = {}) {
    if (sourceData.warningCode !== 'STEAM_WEBAPI_SLOW_OR_FAILED') return;
    steamWebApiWarning = true;
    fallbackReason = sourceData.fallbackReason || 'STEAM_WEBAPI_FAILED';
  }

  function setSteamWebApiWarning() {
    steamWebApiWarning = true;
  }

  function withWarnings(response) {
    const next = steamWebApiWarning
      ? Object.assign({}, response, { warningCode: 'STEAM_WEBAPI_SLOW_OR_FAILED' })
      : Object.assign({}, response);
    if (fallbackReason && !next.source) {
      const responseBody = next.response || {};
      const total = Number(responseBody.total || 0);
      next.source = options.steamApiKey ? 'webapi-fallback' : 'community-dom-fallback';
      next.officialApproximation = 'steam-community-workshop';
      next.fallbackUsed = true;
      next.total = total;
      next.totalPages = Math.max(0, Math.ceil(total / options.numperpage));
      next.page = options.page;
      next.pageSize = options.numperpage;
      next.diagnostics = Object.assign({}, next.diagnostics || {}, { fallbackReason });
    }
    return next;
  }

  return { markSteamWebApiWarning, noteSourceData, setSteamWebApiWarning, withWarnings };
}

module.exports = { createFallbackCoordinator };
