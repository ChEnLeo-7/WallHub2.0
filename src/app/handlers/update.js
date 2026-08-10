'use strict';

function createUpdateHandlers(options = {}) {
  const { jsonRes, isMutationAllowed, updateService } = options;

  function rejectUntrustedMutation(req, res) {
    if (isMutationAllowed(req)) return false;
    jsonRes(res, 403, {
      error: 'Cross-site update requests are not allowed',
      code: 'UPDATE_ORIGIN_DENIED',
    });
    return true;
  }

  async function handleServerUpdateStatus(_req, res) {
    jsonRes(res, 200, updateService.snapshot());
  }

  async function handleServerUpdateCheck(req, res) {
    if (rejectUntrustedMutation(req, res)) return;
    try {
      const cached = new URL(req.url, 'http://x').searchParams.get('cached') === '1';
      jsonRes(res, 200, await updateService.checkNow(cached ? { maxAgeMs: 5 * 60 * 1000 } : {}));
    } catch (error) {
      jsonRes(res, 502, {
        error: error.message || 'Update check failed',
        code: error.code || 'UPDATE_CHECK_FAILED',
      });
    }
  }

  async function handleServerUpdateDownload(req, res) {
    if (rejectUntrustedMutation(req, res)) return;
    try {
      jsonRes(res, 202, updateService.startDownload());
    } catch (error) {
      jsonRes(res, 400, {
        error: error.message || 'Update download failed',
        code: error.code || 'UPDATE_DOWNLOAD_FAILED',
      });
    }
  }

  async function handleServerUpdateInstall(req, res) {
    if (rejectUntrustedMutation(req, res)) return;
    try {
      jsonRes(res, 202, updateService.installDownloaded());
    } catch (error) {
      const statusCode = error.code === 'UPDATE_BUSY' ? 409 : 400;
      jsonRes(res, statusCode, {
        error: error.message || 'Update installation failed',
        code: error.code || 'UPDATE_INSTALL_FAILED',
      });
    }
  }

  return {
    handleServerUpdateStatus,
    handleServerUpdateCheck,
    handleServerUpdateDownload,
    handleServerUpdateInstall,
  };
}

module.exports = { createUpdateHandlers };
