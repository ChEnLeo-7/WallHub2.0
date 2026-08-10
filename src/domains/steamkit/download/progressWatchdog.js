'use strict';

const { steamKitIdleTimeoutForStage, steamKitIdleWatchdogState } = require('./watchdog');

function createProgressWatchdog({ task, processHandle, state, logger = console }) {
  if (!task) return null;
  const baseIdleTimeout = steamKitIdleTimeoutForStage('', false);

  return setInterval(() => {
    const now = Date.now();
    const watchdogState = steamKitIdleWatchdogState({
      task,
      stageKey: state.lastStageKey,
      hasResumeCheckpoint: state.resumeCheckpointAtStart,
      hasEnteredContent: state.hasEnteredContent,
      hasPostContentReconnect: state.hasPostContentReconnect,
      lastOutputAt: state.lastOutputAt,
      lastHandledResumeAt: state.lastHandledLiveResumeAt,
      now,
    });
    state.lastOutputAt = watchdogState.lastOutputAt;
    state.lastHandledLiveResumeAt = watchdogState.lastHandledResumeAt;
    if (watchdogState.suspended) {
      state.lastIdleLogAt = now;
      return;
    }

    const idleMs = now - state.lastOutputAt;
    const idleLimit = watchdogState.idleLimit;
    const contentLikeIdle = idleLimit > baseIdleTimeout;
    if (idleMs > 15000 && now - state.lastIdleLogAt > 15000) {
      state.lastIdleLogAt = now;
      const seconds = Math.round(idleMs / 1000);
      const limitSeconds = Math.round(idleLimit / 1000);
      logger.warn(`[SteamKit idle] ${seconds}s without DepotDownloader output; last stage: ${state.lastStageText}; limit=${limitSeconds}s`);
      task.progressStage = contentLikeIdle
        ? `${state.lastStageText}，可能正在续传校验或等待 SteamPipe CDN，已 ${seconds}s 无新输出`
        : `${state.lastStageText}，已 ${seconds}s 无新输出`;
    }
    if (idleMs <= idleLimit) return;

    const idleStage = contentLikeIdle ? 'content' : 'control';
    task._depotIdleTimeout = true;
    task._depotIdleStage = idleStage;
    task.progressStage = contentLikeIdle
      ? `SteamPipe CDN/续传校验长时间没有输出，正在中止；最后阶段：${state.lastStageText}`
      : `SteamKit 下载器长时间没有输出，正在中止；最后阶段：${state.lastStageText}`;
    logger.warn(`[SteamKit idle] aborting after ${Math.round(idleMs / 1000)}s without output; idleStage=${idleStage}; last stage: ${state.lastStageText}`);
    if (processHandle && processHandle.kill) processHandle.kill();
  }, 5000);
}

module.exports = { createProgressWatchdog };
