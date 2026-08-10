'use strict';

function isUrlProxyPath(pn) {
  return pn === '/url/proxy' || pn === '/url/proxy/' || pn.startsWith('/url/proxy/') || pn === '/proxy' || pn === '/proxy/';
}

function isSteamCommunityShortcutPath(pn, base) {
  return pn === base || new RegExp(`^${base}(?:/|$)`, 'i').test(pn);
}

function hasVirtualSteamHost(req, virtualHostParam) {
  try { return !!new URL(req.url, 'http://x').searchParams.get(virtualHostParam); } catch { return false; }
}

function rewriteToSteamCommunity(req, virtualHostParam) {
  const target = new URL(req.url, 'http://x');
  if (!target.searchParams.get(virtualHostParam)) {
    target.searchParams.set(virtualHostParam, 'steamcommunity.com');
  }
  req.url = target.pathname + target.search;
}

function createProxyRoutes(deps) {
  const {
    virtualHostParam,
    isWallhubProxyVirtualSteamPath,
    handleWallhubUrlProxy,
    handleWallhubVirtualSteamProxy,
    handleWallhubSteamAppRelativeAsset,
  } = deps;

  return async function handleProxyRoutes(req, res, pn) {
    if (isUrlProxyPath(pn)) {
      await handleWallhubUrlProxy(req, res);
      return true;
    }

    if (isWallhubProxyVirtualSteamPath(pn) || hasVirtualSteamHost(req, virtualHostParam)) {
      if (await handleWallhubVirtualSteamProxy(req, res)) return true;
    }

    if (isSteamCommunityShortcutPath(pn, '/chat')) {
      rewriteToSteamCommunity(req, virtualHostParam);
      if (await handleWallhubVirtualSteamProxy(req, res)) return true;
    }

    if (isSteamCommunityShortcutPath(pn, '/my')) {
      rewriteToSteamCommunity(req, virtualHostParam);
      if (await handleWallhubVirtualSteamProxy(req, res)) return true;
    }

    if (/(?:^|\/)(?:javascript|css)\/applications\//i.test(pn) || /(?:^|\/)shared\//i.test(pn)) {
      if (await handleWallhubSteamAppRelativeAsset(req, res)) return true;
    }

    return false;
  };
}

module.exports = { createProxyRoutes };
