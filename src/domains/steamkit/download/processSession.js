'use strict';

const { stripWallhubDiagnosticOutput } = require('../depotTools');
const { classifySteamKitControlPlaneOutput } = require('./controlPlane');
const { isSteamKitContentStageKey } = require('./watchdog');
const { createProgressWatchdog } = require('./progressWatchdog');

function createProcessSession(deps, auth, resume, throwIfDownloadCancelled) {
  const {
    STEAM_CREDENTIALS,
    DEPOT_CONFIG_DIR,
    createWallhubDepotProgressReader,
    createWallhubDepotCdnLogReader,
    appendTaskProcessOutput,
    applyTaskByteProgress,
    runProcess,
    buildSteamContentEnv,
    buildDepotDotnetEnv,
    markSteamAccessControlPlaneFailure = () => {},
    setValidatedPersistentLogin,
    isDepotLoginVerifiedDespiteCanceled,
    logger = console,
  } = deps;

  function createOutputHandler(context, state) {
    const { publishedFileId, appId, options, rawRoot, resumeSeed } = context;
    const readDepotProgress = createWallhubDepotProgressReader();
    const readDepotCdnLog = createWallhubDepotCdnLogReader('[SteamKit CDN]', { source: 'download', mode: 'steamkit' });

    function recordStage(diagnostic) {
      if (!diagnostic || !diagnostic.stage) return;
      if (diagnostic.event === 'api-connect-failed' && diagnostic.host && diagnostic.ip) {
        markSteamAccessControlPlaneFailure(diagnostic.host, diagnostic.ip, diagnostic.detail || 'depotdownloader-webapi-failed', {
          source: 'depotdownloader',
          stage: 'steamkit-webapi',
          port: diagnostic.port || 443,
        });
      }
      state.lastStageText = diagnostic.stage;
      if (diagnostic.key === 'steam3-login') state.hasSteam3LoginStarted = true;
      if (isSteamKitContentStageKey(diagnostic.key)) state.hasEnteredContent = true;
      if (state.hasTrustedContentProgress && (
        diagnostic.key === 'steam3-connect' ||
        diagnostic.key === 'steam3-login' ||
        diagnostic.key === 'steam3-licenses' ||
        diagnostic.key === 'api-broker-required:CMWebSocket'
      )) {
        state.hasPostContentReconnect = true;
      }
      if (options.task) {
        options.task.progressStage = diagnostic.stage;
        if (state.resumeCheckpointAtStart && options.task.progressStageMode !== 'progress') options.task.progressStageMode = 'loading';
      }
      if (diagnostic.key === state.lastStageKey) return;
      state.lastStageKey = diagnostic.key;
      const detail = diagnostic.detail ? ` · ${diagnostic.detail}` : '';
      const line = `[SteamKit stage] +${Date.now() - state.spawnStartedAt}ms ${diagnostic.stage}${detail}`;
      if (diagnostic.level === 'warn' && logger.warn) logger.warn(line);
      else logger.log(line);
    }

    return (chunk) => {
      readDepotCdnLog(chunk);
      state.lastOutputAt = Date.now();
      recordStage(classifySteamKitControlPlaneOutput(chunk));
      if (!options.task) return;
      appendTaskProcessOutput(options.task, chunk);
      const byteProgress = readDepotProgress(chunk);
      if (!byteProgress) return;
      if (!resume.isTrustedProgress(rawRoot, appId, publishedFileId, byteProgress)) {
        if (resumeSeed.source === 'checkpoint') {
          options.task.progressIndeterminate = false;
          options.task.progressStageMode = 'loading';
        } else {
          options.task.progressIndeterminate = true;
          if (state.resumeCheckpointAtStart) options.task.progressStageMode = 'loading';
        }
        options.task.progressStage = 'SteamKit 正在校验本地文件，等待真实下载进度';
        logger.log(`[SteamKit resume] item ${publishedFileId}: ignored untrusted progress downloaded=${Math.max(0, Math.floor(Number(byteProgress.downloaded || 0)))} total=${Math.max(0, Math.floor(Number(byteProgress.total || 0)))} networkSession=${Math.max(0, Math.floor(Number(byteProgress.networkDownloaded || 0)))}`);
        return;
      }

      state.hasEnteredContent = true;
      state.hasTrustedContentProgress = true;
      const visibleProgress = resume.normalizeProgress(byteProgress, resumeSeed);
      resume.writeTrustedResumeCheckpoint(rawRoot, appId, publishedFileId, visibleProgress);
      const now = Date.now();
      if (!state.lastResumeProgressLogAt || now - state.lastResumeProgressLogAt > 5000 || visibleProgress.downloaded >= visibleProgress.total) {
        state.lastResumeProgressLogAt = now;
        const percent = visibleProgress.total > 0 ? ((visibleProgress.downloaded / visibleProgress.total) * 100).toFixed(1) : '0.0';
        logger.log(`[SteamKit resume] item ${publishedFileId}: progress downloaded=${visibleProgress.downloaded} total=${visibleProgress.total} progress=${percent}% networkSession=${Math.max(0, Math.floor(Number(byteProgress.networkDownloaded || 0)))}`);
      }
      options.task.progressStageMode = 'progress';
      applyTaskByteProgress(options.task, visibleProgress.downloaded, visibleProgress.total, {
        stage: 'SteamKit 正在下载文件',
        stageMode: 'progress',
        speedBytes: byteProgress.networkDownloaded,
      });
    };
  }

  async function run(context) {
    const { options, depotLogin, built, command, loginSlotLease } = context;
    const spawnStartedAt = Date.now();
    const state = {
      spawnStartedAt,
      lastOutputAt: spawnStartedAt,
      lastStageKey: '',
      lastStageText: 'SteamKit 子进程已启动，等待 Steam3 控制面输出',
      lastIdleLogAt: 0,
      lastHandledLiveResumeAt: 0,
      lastResumeProgressLogAt: 0,
      hasEnteredContent: false,
      hasTrustedContentProgress: false,
      hasPostContentReconnect: false,
      hasSteam3LoginStarted: false,
      resumeCheckpointAtStart: context.resumeCheckpointAtStart,
    };
    let watchdog = null;
    let abortListener = null;

    try {
      const childEnv = buildSteamContentEnv(Object.assign({}, process.env, buildDepotDotnetEnv()));
      if (options.steam3ProtocolOverride) childEnv.WALLHUB_DEPOT_STEAM3_PROTOCOL = String(options.steam3ProtocolOverride);
      throwIfDownloadCancelled(options, 'before spawning DepotDownloader');
      const onOutput = createOutputHandler(context, state);
      const processHandle = runProcess(command, built.args, 0, {
        cwd: DEPOT_CONFIG_DIR,
        inputLines: built.inputLines,
        closeStdin: true,
        env: childEnv,
        replaceEnv: true,
        preparedEnv: true,
        onStdout: onOutput,
        onStderr: onOutput,
        sanitizeErrorOutput: (text) => stripWallhubDiagnosticOutput(text),
      });
      if (options.task) options.task.processPromise = processHandle;
      if (options.signal && typeof options.signal.addEventListener === 'function' && processHandle && processHandle.kill) {
        abortListener = () => {
          if (options.task) options.task.progressStage = '任务已取消，正在停止 SteamKit 下载器';
          processHandle.kill();
        };
        if (options.signal.aborted) abortListener();
        else options.signal.addEventListener('abort', abortListener, { once: true });
      }
      watchdog = createProgressWatchdog({ task: options.task, processHandle, state, logger });
      try {
        await processHandle;
      } finally {
        if (abortListener && options.signal && typeof options.signal.removeEventListener === 'function') {
          options.signal.removeEventListener('abort', abortListener);
        }
        if (watchdog) clearInterval(watchdog);
      }

      throwIfDownloadCancelled(options, 'DepotDownloader');
      if (depotLogin.user && depotLogin.isPersistent) setValidatedPersistentLogin(depotLogin.user, 'steamkit');
      if (STEAM_CREDENTIALS.username && (STEAM_CREDENTIALS.password || STEAM_CREDENTIALS.steamGuardCode)) {
        STEAM_CREDENTIALS.password = '';
        STEAM_CREDENTIALS.steamGuardCode = '';
        STEAM_CREDENTIALS.isPersistent = true;
      }
    } catch (error) {
      if (isDepotLoginVerifiedDespiteCanceled(error && error.message || error)) {
        // A canceled helper can still leave a valid persisted account session.
      } else if (options.task && options.task._depotIdleTimeout) {
        if (options.task._depotIdleStage === 'content') {
          throw auth.codedError(
            'SteamKit 已进入文件内容下载/续传校验阶段，但 SteamPipe CDN 长时间没有继续输出。已避免误判为 Steam3 登录超时；请稍后重试或在设置中切换 Steam CDN 路由/降低并发后重试。',
            'STEAM_CONTENT_STALLED',
            504
          );
        }
        throw auth.makeNetworkError('DepotDownloader 卡在 Steam3 连接或下载器无输出超时。请检查 Steam3 网络连通性、代理设置，或在设置中切换 Steam CDN 路由后重试。');
      } else {
        throw auth.normalizeError(error, {
          lastStageText: state.lastStageText,
          hasSteam3LoginStarted: state.hasSteam3LoginStarted,
        });
      }
    } finally {
      auth.releaseSteamKitLoginSlot(loginSlotLease);
      if (options.task) {
        options.task.speed = 0;
        delete options.task._depotIdleTimeout;
      }
    }
  }

  return { run };
}

module.exports = { createProcessSession };
