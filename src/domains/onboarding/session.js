'use strict';

const crypto = require('node:crypto');

function createStartupOnboardingSession(options = {}) {
  const now = typeof options.now === 'function' ? options.now : Date.now;
  const instanceId = String(options.instanceId || crypto.randomBytes(16).toString('hex'));
  const startedAt = now();
  const persistedCompletedAt = Number(options.completedAt || 0);
  let completedAt = Number.isFinite(persistedCompletedAt) && persistedCompletedAt > 0
    ? Math.floor(persistedCompletedAt)
    : 0;
  let network = null;
  let account = null;
  let networkProgress = null;
  let pendingNetworkSettings = null;
  let networkCheckSequence = 0;

  function snapshot() {
    return {
      instanceId,
      required: completedAt === 0,
      completed: completedAt > 0,
      startedAt,
      completedAt,
      network,
      account,
      networkProgress,
    };
  }

  function assertInstance(value) {
    if (String(value || '') === instanceId) return;
    const error = new Error('启动引导已失效，请刷新页面后重试');
    error.code = 'ONBOARDING_INSTANCE_CHANGED';
    error.statusCode = 409;
    throw error;
  }

  function recordNetwork(value, settings = null) {
    network = Object.assign({}, value || {}, { checkedAt: now() });
    pendingNetworkSettings = settings ? cloneValue(settings) : null;
    return snapshot();
  }

  function cloneValue(value) {
    return JSON.parse(JSON.stringify(value));
  }

  function testedNetworkSettings() {
    return pendingNetworkSettings ? cloneValue(pendingNetworkSettings) : null;
  }

  function beginNetworkCheck(value = {}) {
    network = null;
    pendingNetworkSettings = null;
    const checkId = `${instanceId}:${++networkCheckSequence}`;
    const timestamp = now();
    networkProgress = Object.assign({
      checkId,
      active: true,
      route: 'direct',
      phase: 'requesting-workshop',
      progress: 0,
      startedAt: timestamp,
      updatedAt: timestamp,
      completedHosts: 0,
      totalHosts: 0,
      availableRoutes: 0,
      workshopAttempt: 0,
      workshopMaxAttempts: 3,
      workshopRetryCount: 0,
      workshopLastError: '',
    }, value, { checkId, active: true, startedAt: timestamp, updatedAt: timestamp });
    return checkId;
  }

  function updateNetworkProgress(checkId, value = {}) {
    if (!networkProgress || !networkProgress.active || networkProgress.checkId !== checkId) return false;
    networkProgress = Object.assign({}, networkProgress, value, {
      checkId,
      updatedAt: now(),
    });
    return true;
  }

  function finishNetworkCheck(checkId, value = {}) {
    return updateNetworkProgress(checkId, Object.assign({ active: false }, value));
  }

  function completeNetworkCheck(checkId, value, settings = null) {
    if (!finishNetworkCheck(checkId, {
      phase: value && value.status === 'connected' ? 'complete' : 'failed',
      progress: value && value.status === 'connected' ? 100 : networkProgress && networkProgress.progress,
    })) return false;
    recordNetwork(Object.assign({}, value || {}, { checkId }), settings);
    return true;
  }

  function recordAccount(value) {
    account = Object.assign({}, value || {}, { checkedAt: now() });
    return snapshot();
  }

  function complete(input = {}) {
    assertInstance(input.instanceId);
    if (completedAt) return snapshot();
    const steamDecision = String(input.steamDecision || '');
    const networkDecision = String(input.networkDecision || '');
    if (!['login', 'skip'].includes(steamDecision)) {
      const error = new Error('请选择是否登录 Steam');
      error.code = 'ONBOARDING_STEAM_DECISION_REQUIRED';
      error.statusCode = 400;
      throw error;
    }
    if (networkProgress && networkProgress.active) {
      const error = new Error('连接检测仍在进行，请等待检测完成');
      error.code = 'ONBOARDING_NETWORK_CHECK_ACTIVE';
      error.statusCode = 409;
      throw error;
    }
    if (!network || !network.status) {
      const error = new Error('请先检测 Steam 社区连接');
      error.code = 'ONBOARDING_NETWORK_CHECK_REQUIRED';
      error.statusCode = 400;
      throw error;
    }
    if (!input.networkCheckId || input.networkCheckId !== network.checkId) {
      const error = new Error('连接检测结果已失效，请重新检测');
      error.code = 'ONBOARDING_NETWORK_CHECK_CHANGED';
      error.statusCode = 409;
      throw error;
    }
    if (!['connected', 'enhanced', 'continue'].includes(networkDecision)) {
      const error = new Error('请选择 Steam 社区连接方案');
      error.code = 'ONBOARDING_NETWORK_DECISION_REQUIRED';
      error.statusCode = 400;
      throw error;
    }
    const expectedRoute = networkDecision === 'connected' ? 'direct' : networkDecision;
    const matchesNetworkCheck = networkDecision === 'continue'
      ? network.status === 'unreachable'
      : network.status === 'connected' && network.route === expectedRoute;
    if (!matchesNetworkCheck) {
      const error = new Error('Steam 社区连接方案与最近一次检测结果不匹配');
      error.code = 'ONBOARDING_NETWORK_DECISION_MISMATCH';
      error.statusCode = 400;
      throw error;
    }
    if (networkDecision === 'enhanced' && !pendingNetworkSettings) {
      const error = new Error('请先使用所选增强配置完成连接检测');
      error.code = 'ONBOARDING_NETWORK_SETTINGS_REQUIRED';
      error.statusCode = 400;
      throw error;
    }
    if (steamDecision === 'login') {
      const currentUsername = String(input.currentUsername || '').trim();
      const checkedUsername = String(account && account.username || '').trim();
      if (!account || !account.status || account.status === 'login-required' || input.loginUsable !== true) {
        const error = new Error('请先登录 Steam 并检测 Wallpaper Engine 账号权限');
        error.code = 'ONBOARDING_ACCOUNT_CHECK_REQUIRED';
        error.statusCode = 400;
        throw error;
      }
      if (!currentUsername || checkedUsername !== currentUsername) {
        const error = new Error('Steam 登录账号已变化，请重新检测 Wallpaper Engine 账号权限');
        error.code = 'ONBOARDING_ACCOUNT_CHANGED';
        error.statusCode = 409;
        throw error;
      }
    }
    completedAt = now();
    return snapshot();
  }

  function validateCompletion(input = {}) {
    const previousCompletedAt = completedAt;
    const result = complete(input);
    completedAt = previousCompletedAt;
    return result;
  }

  function commitCompletion(value) {
    const timestamp = Number(value || 0);
    if (!Number.isFinite(timestamp) || timestamp <= 0) throw new Error('Invalid onboarding completion timestamp');
    if (!completedAt) completedAt = Math.floor(timestamp);
    return snapshot();
  }

  return {
    snapshot,
    assertInstance,
    testedNetworkSettings,
    beginNetworkCheck,
    updateNetworkProgress,
    finishNetworkCheck,
    completeNetworkCheck,
    recordAccount,
    validateCompletion,
    commitCompletion,
    complete,
  };
}

module.exports = { createStartupOnboardingSession };
