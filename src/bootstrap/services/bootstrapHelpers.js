'use strict';

function assembleBootstrapHelpers(scope) {
  const fileTools = scope.require('./src/shared/files');
  const processTools = scope.require('./src/infrastructure/process/runProcess');
  const zipTools = scope.require('./src/infrastructure/archive/zip');
  const {
    mimeFromExt,
    getVideoMime,
    isVideoExt,
  } = scope.require('./src/shared/mime');
  const { buildSteamContentDirectEnv } = scope.require('./src/infrastructure/steam/contentEnv');
  const depotTools = scope.require('./src/domains/steamkit/depotTools');

  Object.assign(scope, {
    depotTools,
    safeName: fileTools.safeName,
    extFromUrl: fileTools.extFromUrl,
    extFromPath: fileTools.extFromPath,
    mimeFromExt,
    getVideoMime,
    isVideoExt,
    ensureDir: fileTools.ensureDir,
    listFilesRecursive: fileTools.listFilesRecursive,
    psQuote: zipTools.psQuote,
  });
  scope.findFirstVideoInDir = dir => fileTools.findFirstVideoInDir(dir, isVideoExt);
  const stripInternalSteamBridgeEnv = (baseEnv) => {
    const env = Object.assign({}, baseEnv || {});
    delete env.WALLHUB_DEPOT_RESOLVER_URL;
    delete env.WALLHUB_DEPOT_RESOLVER_TOKEN;
    delete env.WALLHUB_DEPOT_WEBAPI_BROKER_URL;
    delete env.WALLHUB_DEPOT_WEBAPI_BROKER_TOKEN;
    return env;
  };
  scope.runProcess = (bin, args, timeoutMs, options = {}) => {
    const preparedOptions = Object.assign({
      timeoutMessage: `进程超时: ${bin}`,
      cancelMessage: '进程已取消',
    }, options || {});
    return processTools.runProcess(bin, args, timeoutMs, preparedOptions, (baseEnv, runOptions) => {
      if (runOptions.preparedEnv === true) return baseEnv;
      const childEnv = stripInternalSteamBridgeEnv(baseEnv);
      if (runOptions.steamAuth === true) return scope.buildSteamAuthEnv(childEnv);
      if (runOptions.steamContentDirect === true || childEnv.WALLHUB_STEAM_CONTENT_DIRECT === '1') {
        return buildSteamContentDirectEnv(childEnv, scope.getSteamCdnRouteStrategy());
      }
      return runOptions.applyDownloadProxy === true ? scope.applySteamHttpProxyEnv(childEnv) : childEnv;
    });
  };
  scope.commandExists = command => scope.getSteamKitRuntimeBuildService().commandExists(command);
  scope.zipDir = (dirPath, zipPath) => zipTools.zipDir(dirPath, zipPath, {
    ensureDir: scope.ensureDir,
    commandExists: scope.commandExists,
    runProcess: scope.runProcess,
    listFilesRecursive: scope.listFilesRecursive,
    logger: console,
  });
  scope.dirSizeRecursive = root => {
    if (!root || !scope.fs.existsSync(root)) return 0;
    let total = 0;
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      let entries = [];
      try { entries = scope.fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const filePath = scope.path.join(dir, entry.name);
        try {
          if (entry.isDirectory()) stack.push(filePath);
          else if (entry.isFile()) total += scope.fs.statSync(filePath).size;
        } catch {}
      }
    }
    return total;
  };
  scope.hasFilesRecursive = root => {
    if (!root || !scope.fs.existsSync(root)) return false;
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      let entries = [];
      try { entries = scope.fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const filePath = scope.path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(filePath);
        else if (entry.isFile()) return true;
      }
    }
    return false;
  };
  scope.copyDirContents = (src, dest) => {
    scope.ensureDir(dest);
    for (const entry of scope.fs.readdirSync(src, { withFileTypes: true })) {
      const from = scope.path.join(src, entry.name);
      const to = scope.path.join(dest, entry.name);
      if (entry.isDirectory()) scope.copyDirContents(from, to);
      else if (entry.isFile()) {
        scope.ensureDir(scope.path.dirname(to));
        scope.fs.copyFileSync(from, to);
      }
    }
  };
  scope.applyTaskByteProgress = (task, downloaded, total, options = {}) => {
    if (!task) return;
    const currentBytes = Math.max(0, Math.floor(Number(downloaded || 0)));
    const totalBytes = Math.max(0, Math.floor(Number(total || task.total || task.size || 0)));
    const hasExplicitSpeedBytes = Object.prototype.hasOwnProperty.call(options, 'speedBytes');
    const currentSpeedBytes = hasExplicitSpeedBytes ? Math.max(0, Math.floor(Number(options.speedBytes || 0))) : currentBytes;
    const now = Date.now();
    const outputSpeed = Number(options.speed || 0);
    const lastBytes = Number(task._stdoutProgressLastBytes || 0);
    const lastSpeedBytes = Number(task._speedProgressLastBytes || 0);
    const speedDisabled = options.speedBytes === null || options.speedBytes === undefined && hasExplicitSpeedBytes;
    if (currentBytes < lastBytes || currentSpeedBytes < lastSpeedBytes) {
      task._speedSamples = [];
      task._stdoutProgressLastAt = 0;
      task._stdoutProgressLastBytes = 0;
      task._speedProgressLastBytes = 0;
      task._smoothedSpeed = 0;
      task.speed = 0;
    }
    if (speedDisabled) {
      task.speed = 0;
    } else if (outputSpeed > 0) {
      const maxReasonableSpeed = Math.min(
        scope.RUNTIME_TUNING.PROXY.maxDisplaySpeedBytes,
        totalBytes > 0 ? Math.max(64 * 1024 * 1024, totalBytes * 0.5) : 512 * 1024 * 1024,
      );
      const boundedSpeed = Math.min(outputSpeed, maxReasonableSpeed);
      const previous = Number(task._smoothedSpeed || 0);
      task._smoothedSpeed = previous > 0 ? previous * 0.75 + boundedSpeed * 0.25 : boundedSpeed;
      task.speed = task._smoothedSpeed;
    } else if (currentSpeedBytes >= lastSpeedBytes) {
      const samples = Array.isArray(task._speedSamples) ? task._speedSamples : [];
      const latest = samples.length ? samples[samples.length - 1] : null;
      if (!latest || now - latest.at >= 900 || currentBytes >= totalBytes) {
        samples.push({ at: now, bytes: currentSpeedBytes });
        const cutoff = now - 8000;
        while (samples.length > 2 && samples[0].at < cutoff) samples.shift();
        task._speedSamples = samples.slice(-12);
        const first = task._speedSamples[0];
        const last = task._speedSamples[task._speedSamples.length - 1];
        if (first && last && last.at > first.at && last.bytes >= first.bytes) {
          const windowSpeed = (last.bytes - first.bytes) / ((last.at - first.at) / 1000);
          const boundedWindowSpeed = Math.min(windowSpeed, scope.RUNTIME_TUNING.PROXY.maxDisplaySpeedBytes);
          task._smoothedSpeed = boundedWindowSpeed;
          task.speed = Math.max(0, boundedWindowSpeed);
        }
      }
    }
    task._stdoutProgressLastAt = now;
    task._stdoutProgressLastBytes = currentBytes;
    task._speedProgressLastBytes = currentSpeedBytes;
    task.downloaded = currentBytes;
    if (totalBytes > 0) {
      task.total = totalBytes;
      const cap = options.allowComplete ? 100 : 99.8;
      task.progress = Math.min(cap, Math.max(0, (currentBytes / totalBytes) * 100));
      task.progressIndeterminate = false;
    }
    if (options.stage) task.progressStage = options.stage;
    if (options.stageMode || options.stage) task.progressStageMode = String(options.stageMode || 'progress');
  };
  scope.appendTaskProcessOutput = (task, chunk) => {
    if (!task) return;
    const text = String(chunk || '');
    task._processOutput = `${task._processOutput || ''}${text}`.slice(-3000);
    const line = depotTools.cleanProcessLineForStage(text);
    if (line && task.progressIndeterminate) task.progressStage = line.length > 120 ? `${line.slice(0, 117)}...` : line;
  };
  scope.createWallhubDepotProgressReader = () => depotTools.createWallhubDepotProgressReader();
  scope.createWallhubDepotCdnLogReader = (prefix = '[SteamKit CDN]', meta = {}) => {
    let pending = '';
    const seen = new Set();
    return chunk => {
      pending = `${pending}${String(chunk || '')}`;
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() || '';
      for (const line of lines) {
        const match = line.match(/WALLHUB_DEPOT_CDN_HOST:(\{.+\})/);
        if (!match) continue;
        try {
          const data = JSON.parse(match[1]);
          const host = String(data.host || data.vhost || '').trim();
          if (!host) continue;
          const vhost = String(data.vhost || '').trim();
          const port = Number(data.port || 0);
          const entry = scope.updateSteamCdnStatus(Object.assign({}, meta, { host, vhost, port }));
          const key = entry ? `${entry.host}:${entry.port || 0}` : `${host}:${port || 0}`;
          if (seen.has(key)) continue;
          seen.add(key);
          console.log(`${prefix} host=${host}${vhost && vhost !== host ? ` vhost=${vhost}` : ''}${port ? ` port=${port}` : ''}`);
        } catch {}
      }
      if (pending.length > 16000) pending = pending.slice(-4000);
    };
  };
}

module.exports = { assembleBootstrapHelpers };
