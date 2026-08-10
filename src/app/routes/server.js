'use strict';

const { methodIs } = require('./request');

function createServerRoutes(deps) {
  const {
    handleInternalSteamResolve,
    handleInternalSteamWebApi,
    handleDebug,
    handleServerRuntime,
    handleServerRuntimeDiagnostics,
    handleServerOnboardingStatus,
    handleServerOnboardingNetworkCheck,
    handleServerOnboardingAccountCheck,
    handleServerOnboardingComplete,
    handleServerUpdateStatus,
    handleServerUpdateCheck,
    handleServerUpdateDownload,
    handleServerUpdateInstall,
    handleServerRestart,
    handleServerShutdown,
  } = deps;

  return async function handleServerRoutes(req, res, pn) {
    if (pn === '/api/internal/steam/resolve' && typeof handleInternalSteamResolve === 'function') { await handleInternalSteamResolve(req, res); return true; }
    if (pn === '/api/internal/steam/webapi' && typeof handleInternalSteamWebApi === 'function') { await handleInternalSteamWebApi(req, res); return true; }
    if (pn === '/api/debug') { await handleDebug(res); return true; }
    if (pn === '/api/server/runtime/diagnostics' && methodIs(req, 'GET') && typeof handleServerRuntimeDiagnostics === 'function') { await handleServerRuntimeDiagnostics(req, res); return true; }
    if (pn === '/api/server/runtime' && methodIs(req, 'GET')) { await handleServerRuntime(req, res); return true; }
    if (pn === '/api/server/onboarding' && methodIs(req, 'GET') && typeof handleServerOnboardingStatus === 'function') { await handleServerOnboardingStatus(req, res); return true; }
    if (pn === '/api/server/onboarding/network-check' && methodIs(req, 'POST') && typeof handleServerOnboardingNetworkCheck === 'function') { await handleServerOnboardingNetworkCheck(req, res); return true; }
    if (pn === '/api/server/onboarding/account-check' && methodIs(req, 'POST') && typeof handleServerOnboardingAccountCheck === 'function') { await handleServerOnboardingAccountCheck(req, res); return true; }
    if (pn === '/api/server/onboarding/complete' && methodIs(req, 'POST') && typeof handleServerOnboardingComplete === 'function') { await handleServerOnboardingComplete(req, res); return true; }
    if (pn === '/api/server/update' && methodIs(req, 'GET') && typeof handleServerUpdateStatus === 'function') { await handleServerUpdateStatus(req, res); return true; }
    if (pn === '/api/server/update/check' && methodIs(req, 'POST') && typeof handleServerUpdateCheck === 'function') { await handleServerUpdateCheck(req, res); return true; }
    if (pn === '/api/server/update/download' && methodIs(req, 'POST') && typeof handleServerUpdateDownload === 'function') { await handleServerUpdateDownload(req, res); return true; }
    if (pn === '/api/server/update/install' && methodIs(req, 'POST') && typeof handleServerUpdateInstall === 'function') { await handleServerUpdateInstall(req, res); return true; }
    if (pn === '/api/server/restart' && methodIs(req, 'POST')) { await handleServerRestart(req, res); return true; }
    if (pn === '/api/server/shutdown' && methodIs(req, 'POST')) { await handleServerShutdown(req, res); return true; }
    return false;
  };
}

module.exports = { createServerRoutes };
