'use strict';

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(String(value || '').trim(), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function isSteamKitContentStageKey(key) {
  const value = String(key || '');
  return value === 'content-download' || value === 'manifest-download' || value === 'resume-validation' || value.startsWith('cdn:') || value.startsWith('manifest-retry:');
}

function isSteamKitContentStageText(stage) {
  return /文件内容|续传校验|校验本地文件|SteamPipe\s+CDN|Depot\s+Manifest|Manifest|正在连接\s+[^\s]+:\d+/i.test(String(stage || ''));
}

function steamKitPreSpawnWarmupTimeoutMs(env = process.env) {
  return Math.max(0, parsePositiveInt(env.WALLHUB_STEAMKIT_PRESPAWN_WARMUP_TIMEOUT || '2500', 2500));
}

function steamKitIdleTimeoutForStage(stageKey, hasResumeCheckpoint, env = process.env, hasPostContentReconnect = false) {
  const base = Math.max(30000, parsePositiveInt(env.WALLHUB_DEPOT_IDLE_TIMEOUT || '60000', 60000));
  const content = Math.max(base, parsePositiveInt(env.WALLHUB_DEPOT_CONTENT_IDLE_TIMEOUT || '300000', 300000));
  if (hasPostContentReconnect) {
    const recovery = Math.max(base, parsePositiveInt(env.WALLHUB_DEPOT_RECOVERY_IDLE_TIMEOUT || '75000', 75000));
    return Math.min(content, recovery);
  }
  return (hasResumeCheckpoint || isSteamKitContentStageKey(stageKey)) ? content : base;
}

function steamKitIdleWatchdogState(options = {}) {
  const task = options.task || {};
  const now = Number(options.now || Date.now());
  const resumeAt = Math.max(0, Number(task._livePauseResumedAt || 0));
  const previousResumeAt = Math.max(0, Number(options.lastHandledResumeAt || 0));
  const resumed = resumeAt > previousResumeAt;
  const lastOutputAt = resumed ? Math.max(Number(options.lastOutputAt || 0), resumeAt) : Number(options.lastOutputAt || 0);
  const hasContent = !!options.hasResumeCheckpoint || !!options.hasEnteredContent;
  return { now, suspended: !!task.livePaused, resumed, lastOutputAt, lastHandledResumeAt: resumed ? resumeAt : previousResumeAt, idleLimit: steamKitIdleTimeoutForStage(options.stageKey, hasContent, options.env || process.env, !!options.hasPostContentReconnect) };
}

module.exports = { parsePositiveInt, isSteamKitContentStageKey, isSteamKitContentStageText, steamKitPreSpawnWarmupTimeoutMs, steamKitIdleTimeoutForStage, steamKitIdleWatchdogState };
