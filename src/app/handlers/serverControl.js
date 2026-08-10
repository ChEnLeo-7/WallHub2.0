'use strict';

function createHttpRequestTracker() {
  let activeRequests = 0;

  function activeCount() {
    return activeRequests;
  }

  function createHandler(options = {}) {
    const {
      jsonRes,
      isAllowedHost,
      getUpdateInstallPending,
      routeHttpRequest,
    } = options;

    return async function handleHttpRequest(req, res) {
      if (!isAllowedHost(req.headers && req.headers.host)) {
        return jsonRes(res, 421, {
          error: 'Unrecognized WallHub host',
          code: 'WALLHUB_HOST_DENIED',
        });
      }
      let pathname = '/';
      try { pathname = new URL(req.url, 'http://x').pathname; } catch {}
      const statusRequest = req.method === 'GET' && ['/health', '/api/server/runtime', '/api/server/update'].includes(pathname);
      const updateRequest = pathname.startsWith('/api/server/update/');
      if (getUpdateInstallPending() && !statusRequest && !updateRequest) {
        return jsonRes(res, 503, {
          error: 'WallHub is preparing to install an update',
          code: 'UPDATE_INSTALL_PENDING',
        });
      }
      if (statusRequest || updateRequest) return routeHttpRequest(req, res);

      activeRequests += 1;
      let released = false;
      const release = () => {
        if (released) return;
        released = true;
        activeRequests = Math.max(0, activeRequests - 1);
      };
      res.once('finish', release);
      res.once('close', release);
      try {
        return await routeHttpRequest(req, res);
      } catch (error) {
        release();
        throw error;
      }
    };
  }

  return { activeCount, createHandler };
}

function createServerControlHandlers(options = {}) {
  const { jsonRes, getRestartServer, getShutdownServer } = options;

  async function handleServerRestart(_req, res) {
    const result = await getRestartServer()();
    jsonRes(res, 200, {
      success: true,
      message: result.mode === 'exit' ? '服务端正在退出，请由 Docker 重启策略拉起' : '服务端正在重启',
      mode: result.mode,
      logPath: result.logPath || '',
    });
  }

  async function handleServerShutdown(_req, res) {
    const result = await getShutdownServer()();
    jsonRes(res, 200, {
      success: true,
      message: '服务端正在关闭',
      mode: result.mode,
    });
  }

  return { handleServerRestart, handleServerShutdown };
}

module.exports = { createHttpRequestTracker, createServerControlHandlers };
