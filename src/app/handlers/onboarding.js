'use strict';

const {
  normalizeOnboardingNetworkSettings,
  createOnboardingSteamAccessGateway,
} = require('../../domains/onboarding/networkSettings');
const { requestWorkshopWithRetry } = require('../../domains/onboarding/workshopRetry');

const WORKSHOP_TEST_URL = 'https://steamcommunity.com/workshop/browse/?appid=431960&browsesort=trend&section=readytouseitems&p=1&numperpage=1';
const ONBOARDING_NETWORK_CHECK_TIMEOUT_MS = 15000;

function createOnboardingHandlers(options = {}) {
  const {
    jsonRes,
    readBody,
    isReadAllowed,
    isMutationAllowed,
    getSession,
    getSettings,
    getSteamAccessExperimental,
    hostsUpdater,
    configDir,
    isGatewayHost,
    isStaticCdnHost,
    requestDirect,
    userAgent,
    getCachedUsername,
    isLoginUsable,
    checkAppOwnership,
    normalizeLoginError,
    setAppOwnership,
    persistCompletion,
    clearGateway,
    clearWorkshopCaches,
    scheduleHostsUpdate,
    networkCheckTimeoutMs = ONBOARDING_NETWORK_CHECK_TIMEOUT_MS,
    logger = console,
  } = options;

  function noStoreJson(res, statusCode, value) {
    if (typeof res.setHeader === 'function') res.setHeader('Cache-Control', 'no-store');
    jsonRes(res, statusCode, value);
  }

  function rejectUntrustedRequest(req, res, isAllowed = isMutationAllowed) {
    if (isAllowed(req)) return false;
    noStoreJson(res, 403, {
      error: 'Cross-site onboarding requests are not allowed',
      code: 'ONBOARDING_ORIGIN_DENIED',
    });
    return true;
  }

  async function readPayload(req, res, fallback = '{}') {
    try {
      const value = JSON.parse(await readBody(req) || fallback);
      return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    } catch {
      noStoreJson(res, 400, { error: 'Bad JSON' });
      return null;
    }
  }

  async function handleStatus(req, res) {
    if (rejectUntrustedRequest(req, res, isReadAllowed)) return;
    noStoreJson(res, 200, getSession().snapshot());
  }

  async function handleNetworkCheck(req, res) {
    if (rejectUntrustedRequest(req, res)) return;
    const payload = await readPayload(req, res);
    if (!payload) return;
    const session = getSession();
    try {
      session.assertInstance(payload.instanceId);
    } catch (error) {
      return noStoreJson(res, error.statusCode || 409, { error: error.message, code: error.code || '' });
    }

    const enhanced = !!payload.enableEnhance;
    const checkId = session.beginNetworkCheck({
      route: enhanced ? 'enhanced' : 'direct',
      phase: enhanced ? 'saving-settings' : 'requesting-workshop',
      progress: enhanced ? 5 : 35,
    });
    const startedAt = Date.now();
    const timeoutMs = Math.max(10, Number(networkCheckTimeoutMs) || ONBOARDING_NETWORK_CHECK_TIMEOUT_MS);
    const checkController = new AbortController();
    let testedNetworkSettings = null;
    let onboardingGateway = null;
    let timeoutTimer = null;
    try {
      const deadline = new Promise((resolve, reject) => {
        timeoutTimer = setTimeout(() => {
          checkController.abort();
          reject(Object.assign(new Error(`Steam Community connection quality is poor: check exceeded ${Math.round(timeoutMs / 1000)} seconds`), {
            code: 'ONBOARDING_NETWORK_TIMEOUT',
          }));
        }, timeoutMs);
        timeoutTimer.unref?.();
      });
      const operation = (async () => {
        if (enhanced) {
          let networkSettingsInput = payload.networkSettings || {};
          if (String(networkSettingsInput.wallhubSteamAccessMode || '') === 'hosts' &&
            !String(networkSettingsInput.wallhubSteamAccessHosts || '').trim() &&
            String(networkSettingsInput.wallhubSteamAccessHostsUrl || '').trim()) {
            const fetched = await hostsUpdater.fetchAndMaybeSave(networkSettingsInput.wallhubSteamAccessHostsUrl, false);
            networkSettingsInput = Object.assign({}, networkSettingsInput, {
              wallhubSteamAccessHosts: fetched.hosts,
              wallhubSteamAccessHostsLastUpdatedAt: fetched.lastUpdatedAt,
              wallhubSteamAccessHostsLastError: '',
            });
          }
          testedNetworkSettings = normalizeOnboardingNetworkSettings(getSettings(), networkSettingsInput, { logger });
          onboardingGateway = createOnboardingSteamAccessGateway(testedNetworkSettings, {
            configDir,
            logger,
            isGatewayHost,
            isStaticCdnHost,
            experimental: getSteamAccessExperimental(),
          });
          session.updateNetworkProgress(checkId, { phase: 'resolving-routes', progress: 20 });
          let acceptWarmupProgress = true;
          let completedHosts = 0;
          let totalHosts = 0;
          let availableRoutes = 0;
          const warmup = await onboardingGateway.ensureReady('onboarding-community', Math.min(12000, timeoutMs), {
            forceEnhance: true,
            onProgress: ({ completed, total, ok }) => {
              if (!acceptWarmupProgress) return;
              completedHosts = Math.max(completedHosts, Number(completed || 0));
              totalHosts = Math.max(totalHosts, Number(total || 0));
              availableRoutes = Math.max(availableRoutes, Number(ok || 0));
              const ratio = totalHosts ? Math.min(1, completedHosts / totalHosts) : 0;
              session.updateNetworkProgress(checkId, {
                phase: completedHosts ? 'validating-routes' : 'resolving-routes',
                progress: Math.round(20 + ratio * 55),
                completedHosts,
                totalHosts,
                availableRoutes,
              });
            },
          });
          acceptWarmupProgress = false;
          completedHosts = Math.max(completedHosts, Number(warmup.completed || 0));
          totalHosts = Math.max(totalHosts, Number(warmup.total || 0));
          availableRoutes = Math.max(availableRoutes, Number(warmup.ok || 0));
          session.updateNetworkProgress(checkId, {
            phase: 'requesting-workshop', progress: 82, completedHosts, totalHosts, availableRoutes,
          });
        }

        const html = (await requestWorkshopWithRetry(async ({ signal, attempt }) => (enhanced
          ? onboardingGateway.request({
            protocol: 'https:', hostname: 'steamcommunity.com', port: 443,
            path: '/workshop/browse/?appid=431960&browsesort=trend&section=readytouseitems&p=1&numperpage=1',
            method: 'GET', headers: { 'User-Agent': userAgent, Accept: 'text/html,*/*' },
            routeOptions: {
              forceEnhance: true, requireApplicationProbe: true, requireAuthorizedCertificate: true,
              certificateHostname: 'steamcommunity.com', connectionReuse: false,
              backgroundRefresh: false, forceRefresh: attempt > 1,
            },
            signal,
          }, null, timeoutMs)
          : requestDirect(WORKSHOP_TEST_URL, { wallhubDisableSteamAccessGateway: true, signal }, timeoutMs)), {
          timeoutMs,
          maxAttempts: enhanced ? 3 : 1,
          signal: checkController.signal,
          onAttempt: ({ attempt, maxAttempts, retryCount, lastError }) => {
            session.updateNetworkProgress(checkId, {
              phase: attempt > 1 ? 'retrying-workshop' : 'requesting-workshop',
              progress: Math.min(92, 82 + (attempt - 1) * 4), workshopAttempt: attempt,
              workshopMaxAttempts: maxAttempts, workshopRetryCount: retryCount,
              workshopLastError: lastError && lastError.message || '',
            });
          },
          onFailure: ({ attempt, maxAttempts, error, willRetry }) => {
            session.updateNetworkProgress(checkId, {
              phase: willRetry ? 'retrying-workshop' : 'requesting-workshop',
              workshopAttempt: attempt, workshopMaxAttempts: maxAttempts,
              workshopRetryCount: Math.max(0, attempt - 1), workshopLastError: error.message || String(error),
            });
          },
        })).toString('utf8');
        session.updateNetworkProgress(checkId, { phase: 'validating-response', progress: 95 });
        if (!/(?:steamcommunity|steam community)/i.test(html) || !/workshop/i.test(html)) {
          throw new Error('Steam Community returned an unexpected response');
        }
        return {
          checkId, status: 'connected', route: enhanced ? 'enhanced' : 'direct', enhanceEnabled: enhanced,
          accessMode: enhanced ? testedNetworkSettings.wallhubSteamAccessMode : undefined,
          resolverProtocol: enhanced && testedNetworkSettings.wallhubSteamAccessMode === 'resolver'
            ? testedNetworkSettings.wallhubSteamAccessResolverProtocol : undefined,
          latencyMs: Date.now() - startedAt,
        };
      })();
      const result = await Promise.race([operation, deadline]);
      if (!session.completeNetworkCheck(checkId, result, enhanced ? testedNetworkSettings : null)) {
        return noStoreJson(res, 409, { error: '连接检测已被新的检测替代', code: 'ONBOARDING_NETWORK_CHECK_SUPERSEDED' });
      }
      noStoreJson(res, 200, result);
    } catch (error) {
      const result = {
        checkId,
        status: 'unreachable',
        route: enhanced ? 'enhanced' : 'direct',
        enhanceEnabled: enhanced,
        latencyMs: Date.now() - startedAt,
        error: error.message || 'Steam Community connection failed',
      };
      if (!session.completeNetworkCheck(checkId, result)) {
        return noStoreJson(res, 409, { error: '连接检测已被新的检测替代', code: 'ONBOARDING_NETWORK_CHECK_SUPERSEDED' });
      }
      noStoreJson(res, 200, result);
    } finally {
      clearTimeout(timeoutTimer);
      checkController.abort();
      onboardingGateway?.clear();
    }
  }

  async function handleAccountCheck(req, res) {
    if (rejectUntrustedRequest(req, res)) return;
    const payload = await readPayload(req, res);
    if (!payload) return;
    const session = getSession();
    try {
      session.assertInstance(payload.instanceId);
    } catch (error) {
      return noStoreJson(res, error.statusCode || 409, { error: error.message, code: error.code || '' });
    }

    const username = getCachedUsername();
    if (!username || !isLoginUsable()) {
      const result = { status: 'login-required', username: username || '' };
      session.recordAccount(result);
      return noStoreJson(res, 200, result);
    }
    try {
      const ownership = await checkAppOwnership(username, 431960);
      setAppOwnership({ username, status: ownership.status, checkedAt: Date.now(), error: '' });
      const result = { status: ownership.status, username, appId: 431960 };
      session.recordAccount(result);
      noStoreJson(res, 200, result);
    } catch (error) {
      const normalized = normalizeLoginError(error);
      const result = {
        status: normalized.requiresSteamLogin ? 'login-required' : 'unknown',
        username,
        appId: 431960,
        error: normalized.message || '无法确认 Wallpaper Engine 权限',
        code: normalized.code || '',
      };
      setAppOwnership({ username, status: result.status, checkedAt: Date.now(), error: result.error });
      session.recordAccount(result);
      noStoreJson(res, 200, result);
    }
  }

  async function handleComplete(req, res) {
    if (rejectUntrustedRequest(req, res)) return;
    const payload = await readPayload(req, res, '');
    if (!payload) return;
    const session = getSession();
    try {
      const result = session.validateCompletion(Object.assign({}, payload, {
        currentUsername: getCachedUsername(),
        loginUsable: isLoginUsable(),
      }));
      await persistCompletion({ payload, result, session });
      const completed = session.commitCompletion(result.completedAt);
      try { clearGateway(); } catch (error) { logger.warn('[Onboarding] failed to clear Steam access gateway:', error.message); }
      try { clearWorkshopCaches(); } catch (error) { logger.warn('[Onboarding] failed to clear Workshop caches:', error.message); }
      try { scheduleHostsUpdate(); } catch (error) { logger.warn('[Onboarding] failed to schedule Hosts updates:', error.message); }
      noStoreJson(res, 200, completed);
    } catch (error) {
      noStoreJson(res, error.statusCode || 400, { error: error.message, code: error.code || '' });
    }
  }

  return {
    handleServerOnboardingStatus: handleStatus,
    handleServerOnboardingNetworkCheck: handleNetworkCheck,
    handleServerOnboardingAccountCheck: handleAccountCheck,
    handleServerOnboardingComplete: handleComplete,
  };
}

module.exports = { ONBOARDING_NETWORK_CHECK_TIMEOUT_MS, createOnboardingHandlers };
