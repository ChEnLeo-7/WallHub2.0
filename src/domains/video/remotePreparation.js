'use strict';

const { createRemoteVideoStreamProxy } = require('./remoteStream');

function createRemoteVideoPreparation(deps = {}) {
  const {
    registry,
    userAgent,
    updateSteamCdnStatus,
    steamCdnStatusSnapshot,
    extFromUrl,
    mimeFromExt,
    getProxyCandidates,
    isSocksProxyProtocol,
    connectViaSocksProxy,
    proxyAuth,
    jsonRes,
    logger = console,
  } = deps;
  let streamProxy = null;

  function getStreamProxy() {
    if (!streamProxy) {
      streamProxy = createRemoteVideoStreamProxy({
        userAgent,
        getRemoteVideoStream: registry.getRemote,
        updateSteamCdnStatus,
        cleanupRemoteVideoStreams: registry.cleanup,
        extFromUrl,
        mimeFromExt,
        getProxyCandidates,
        isSocksProxyProtocol,
        connectViaSocksProxy,
        proxyAuth,
        jsonRes,
      });
    }
    return streamProxy;
  }

  function prepare(source, id) {
    let host = '';
    try { host = new URL(source.url).hostname; } catch {}
    const token = registry.createRemote(source);
    if (host) updateSteamCdnStatus({ host, port: 443, source: 'remote', mode: 'steamkit' });
    logger.log(`[Video Source] id=${id} source=file_url host=${host || 'unknown'} filename="${source.filename || ''}"`);
    return {
      success: true,
      status: 'ready',
      streamUrl: `/api/video/remote?token=${encodeURIComponent(token)}`,
      source: 'file_url',
      cdnHost: host || steamCdnStatusSnapshot().currentHost || '',
    };
  }

  function proxy(req, res, token) {
    return getStreamProxy().proxy(req, res, token);
  }

  return { prepare, proxy };
}

module.exports = {
  createRemoteVideoPreparation,
};
