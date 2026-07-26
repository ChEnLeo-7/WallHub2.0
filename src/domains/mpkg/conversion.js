'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function createMpkgConversionService(options = {}) {
  const toolDir = options.toolDir;
  const toolScript = options.toolScript || (toolDir ? path.join(toolDir, 'mobile_mpkg.py') : '');
  const ensureDir = options.ensureDir;
  const commandExists = options.commandExists;
  const runProcess = options.runProcess;
  const sleep = options.sleep;
  const findDownloadedItemPath = options.findDownloadedItemPath;
  const checkPythonDependencies = typeof options.pythonDependencyStatus === 'function' ? options.pythonDependencyStatus : pythonDependencyStatus;
  const createWorkshopQueueTask = options.createWorkshopQueueTask;
  const safeName = options.safeName;
  const logger = options.logger || console;
  const getDebugEnabled = typeof options.isDebugEnabled === 'function' ? options.isDebugEnabled : () => !!options.isDebugEnabled;
  const getVerboseDebugEnabled = typeof options.isVerboseDebugEnabled === 'function' ? options.isVerboseDebugEnabled : () => !!options.isVerboseDebugEnabled;
  const getTextureProfile = typeof options.getTextureProfile === 'function'
    ? options.getTextureProfile
    : () => process.env.WALLHUB_MPKG_TEXTURE_PROFILE;
  const buildPromises = new Map();
  let pythonLastError = '';

  function debugEnabled() {
    try {
      if (getDebugEnabled()) return true;
    } catch {}
    return /^(?:1|true|yes|on|debug)$/i.test(String(process.env.WALLHUB_MPKG_DEBUG || '').trim());
  }

  function debugLog(message) {
    if (!debugEnabled()) return;
    logger.log(`[MPKG] Debug ${message}`);
  }

  function verboseDebugEnabled() {
    if (!debugEnabled()) return false;
    try {
      if (getVerboseDebugEnabled()) return true;
    } catch {}
    return /^(?:1|true|yes|on|debug)$/i.test(String(process.env.WALLHUB_MPKG_DEBUG_VERBOSE || '').trim());
  }

  function normalizeTextureProfile(value) {
    return String(value || '').trim().toLowerCase() === 'compact' ? 'compact' : 'fast';
  }

  function currentTextureProfile() {
    try {
      return normalizeTextureProfile(getTextureProfile());
    } catch {
      return 'fast';
    }
  }

  function pythonDependencyStatus(python, options = {}) {
    const command = String(python || '').trim();
    if (!command) return { ok: false, error: 'empty python command' };
    const requireSceneDependencies = options.requireSceneDependencies !== false;
    try {
      const script = [
        'import json',
        'import sys',
        'missing=[]',
        ...(requireSceneDependencies ? [
          'try:',
          ' from PIL import Image',
          'except Exception:',
          ' missing.append("Pillow")',
          'try:',
          ' import lz4.block',
          'except Exception:',
          ' missing.append("lz4")',
        ] : []),
        'accelerated_dxt=False',
        'etcpak_available=False',
        ...(requireSceneDependencies ? [
          'try:',
          ' import texture2ddecoder',
          ' accelerated_dxt=hasattr(texture2ddecoder, "decode_bc3")',
          'except Exception:',
          ' pass',
          'try:',
          ' import etcpak',
          ' etcpak_available=True',
          'except Exception:',
          ' pass',
        ] : []),
        'print(json.dumps({"executable": sys.executable, "acceleratedDxt": accelerated_dxt, "etcpakAvailable": etcpak_available}))',
        'raise SystemExit(1 if missing else 0)',
      ].join('\n');
      const out = execFileSync(command, ['-c', script], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, PYTHONPATH: '', PYTHONHOME: '' },
      });
      const lastLine = String(out || '').trim().split(/\r?\n/).pop() || '';
      const status = JSON.parse(lastLine);
      return {
        ok: true,
        executable: String(status.executable || command),
        acceleratedDxt: status.acceleratedDxt === true,
        etcpakAvailable: status.etcpakAvailable === true,
      };
    } catch (error) {
      const output = `${error.stdout || ''}\n${error.stderr || ''}`.trim();
      return { ok: false, error: output || error.message || 'dependency check failed' };
    }
  }

  function findPythonExecutable(options = {}) {
    const requireSceneDependencies = options.requireSceneDependencies !== false;
    const candidates = [
      process.env.PYTHON || '',
      process.env.PYTHON3 || '',
      'python3',
      'python',
      process.platform === 'win32' ? 'py' : ''
    ].filter(Boolean);
    const missing = [];
    pythonLastError = '';
    for (const candidate of candidates) {
      const found = commandExists(candidate);
      if (!found) continue;
      const status = checkPythonDependencies(found, { requireSceneDependencies });
      if (status.ok) {
        if (requireSceneDependencies && status.acceleratedDxt === false) {
          logger.warn('[MPKG] Selected Python lacks texture2ddecoder; DXT1/DXT5 conversion will be much slower. Install it with: pip install texture2ddecoder');
        }
        return found;
      }
      missing.push(`${found}: ${status.error}`);
    }
    pythonLastError = missing.join(' | ');
    if (missing.length) {
      const requirement = requireSceneDependencies ? 'Pillow/lz4' : 'the standard library';
      logger.warn(`[MPKG] No Python with ${requirement} found. Checked: ${pythonLastError}`);
    }
    return '';
  }

  function getCapabilities() {
    const python = findPythonExecutable();
    if (!python) {
      return {
        compactAvailable: false,
        compactUnavailableReason: '未找到可用于 MPKG 转换的 Python，无法使用紧凑档。',
      };
    }
    const status = checkPythonDependencies(python);
    if (status.ok && status.etcpakAvailable === true) {
      return { compactAvailable: true, compactUnavailableReason: '' };
    }
    return {
      compactAvailable: false,
      compactUnavailableReason: '缺少 Python etcpak，无法使用紧凑档。请安装：pip install etcpak',
    };
  }

  function hasWorkshopFile(dir, name) {
    try {
      const filePath = path.join(dir, name);
      return !!dir && fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  function hasWorkshopPreview(dir) {
    try {
      if (!dir || !fs.existsSync(dir)) return false;
      return fs.readdirSync(dir).some(name => /^preview\.(gif|jpe?g|png|webp)$/i.test(name));
    } catch {
      return false;
    }
  }

  function readWorkshopProject(dir) {
    try {
      if (!hasWorkshopFile(dir, 'project.json')) return null;
      const raw = fs.readFileSync(path.join(dir, 'project.json'), 'utf8').replace(/^\uFEFF/, '');
      const project = JSON.parse(raw);
      return project && typeof project === 'object' && !Array.isArray(project) ? project : null;
    } catch {
      return null;
    }
  }

  function hasWorkshopProjectFile(dir, fileName) {
    try {
      const root = path.resolve(String(dir || ''));
      const rawName = String(fileName || '').trim();
      if (!root || !rawName || path.isAbsolute(rawName)) return false;
      const relativeName = rawName.replace(/[\\/]+/g, path.sep);
      const filePath = path.resolve(root, relativeName);
      const relativePath = path.relative(root, filePath);
      if (!relativePath || relativePath === '..' || relativePath.startsWith(`..${path.sep}`) || path.isAbsolute(relativePath)) return false;
      return fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    } catch {
      return false;
    }
  }

  function isSceneWorkshopDir(dir) {
    return hasWorkshopFile(dir, 'scene.pkg') && hasWorkshopFile(dir, 'project.json') && hasWorkshopPreview(dir);
  }

  function isVideoWorkshopDir(dir) {
    const project = readWorkshopProject(dir);
    return !!(
      project &&
      String(project.type || '').trim().toLowerCase() === 'video' &&
      hasWorkshopPreview(dir) &&
      hasWorkshopProjectFile(dir, project.file)
    );
  }

  function outputPathForItem(itemDir, id, textureProfile = currentTextureProfile()) {
    const safeId = String(id || path.basename(itemDir || '') || 'wallpaper').replace(/[^\dA-Za-z_.-]/g, '') || 'wallpaper';
    const outDir = path.join(itemDir, 'Mpkg');
    const suffix = textureProfile === 'compact' ? '.compact' : '';
    return path.join(outDir, `${safeId}${suffix}.mpkg`);
  }

  function normalizeError(error, options = {}) {
    const message = String(error && error.message || error || '').trim();
    if (/Pillow is required|No module named ['"]PIL|ModuleNotFoundError.*PIL/i.test(message)) return 'MPKG 转换需要 Python Pillow：pip install Pillow';
    if (/lz4 is required|No module named ['"]lz4|ModuleNotFoundError.*lz4/i.test(message)) return 'MPKG 转换需要 Python lz4：pip install lz4';
    if (/not recognized|not found|ENOENT|No such file or directory/i.test(message)) {
      return options.isVideo ? '未找到 Python，请先安装 Python 3。' : '未找到 Python，请先安装 Python 3，并安装 Pillow、lz4。';
    }
    return message || 'MPKG 转换失败';
  }

  function logToolChunk(chunk, level = 'log') {
    String(chunk || '')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)
      .forEach(line => {
        const message = `[MPKG] ${line}`;
        if (level === 'warn' && typeof logger.warn === 'function') logger.warn(message);
        else logger.log(message);
      });
  }

  async function buildForItem(itemDir, id, outputPath, textureProfile = currentTextureProfile()) {
    const itemLabel = String(id || path.basename(itemDir) || 'unknown');
    const isVideoProject = isVideoWorkshopDir(itemDir);
    const profile = isVideoProject ? 'fast' : (textureProfile === 'compact' ? 'compact' : 'fast');
    const sourceLabel = isVideoProject ? 'video -> MPKG' : 'PKG -> MPKG';
    const startedAt = Date.now();
    const python = findPythonExecutable({ requireSceneDependencies: !isVideoProject });
    if (!python) {
      const detail = pythonLastError ? `；已检查：${pythonLastError}` : '';
      const requirement = isVideoProject ? '请安装 Python 3' : '请安装 Pillow 和 lz4：pip install Pillow lz4';
      throw Object.assign(new Error(`未找到可用于 MPKG 转换的 Python，${requirement}${detail}`), { statusCode: 500 });
    }
    ensureDir(path.dirname(outputPath));
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      debugLog(`existing MPKG reused item=${itemLabel} bytes=${fs.statSync(outputPath).size}`);
      return outputPath;
    }

    const tempPath = `${outputPath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    try { fs.rmSync(tempPath, { force: true }); } catch {}
    const args = [
      '-u',
      toolScript,
      'convert',
      itemDir,
      '--output', tempPath,
      '--overwrite',
      '--include-sounds',
      '--texture-profile', profile,
    ];
    const timeoutMs = Math.max(60000, parseInt(process.env.WALLHUB_MPKG_TIMEOUT || '900000', 10) || 900000);
    try {
      logger.log(`[MPKG] Starting ${profile} ${sourceLabel} conversion for item ${itemLabel}: ${itemDir} -> ${outputPath}`);
      debugLog(`conversion process start item=${itemLabel} python=selected timeoutMs=${timeoutMs} tempFile=${path.basename(tempPath)}`);
      const result = await runProcess(python, args, timeoutMs, {
        cwd: toolDir,
        closeStdin: true,
        env: {
          PYTHONUNBUFFERED: '1',
          PYTHONPATH: '',
          PYTHONHOME: '',
          WALLHUB_MPKG_DEBUG: debugEnabled() ? '1' : '0',
          WALLHUB_MPKG_DEBUG_VERBOSE: verboseDebugEnabled() ? '1' : '0',
        },
        onStdout: chunk => logToolChunk(chunk, 'log'),
        onStderr: chunk => logToolChunk(chunk, 'warn')
      });
      debugLog(`conversion process exited item=${itemLabel} elapsedMs=${Date.now() - startedAt} stdoutBytes=${Buffer.byteLength(String(result && result.out || ''), 'utf8')} stderrBytes=${Buffer.byteLength(String(result && result.err || ''), 'utf8')}`);
    } catch (error) {
      debugLog(`conversion process failed item=${itemLabel} elapsedMs=${Date.now() - startedAt} error=${String(error && error.message || error || 'unknown')}`);
      try { fs.rmSync(tempPath, { force: true }); } catch {}
      throw Object.assign(new Error(normalizeError(error, { isVideo: isVideoProject })), { statusCode: error.statusCode || 500 });
    }
    if (!fs.existsSync(tempPath) || fs.statSync(tempPath).size <= 0) {
      try { fs.rmSync(tempPath, { force: true }); } catch {}
      throw Object.assign(new Error('MPKG 转换结束但未生成有效文件'), { statusCode: 500 });
    }
    const tempStat = fs.statSync(tempPath);
    debugLog(`temporary MPKG verified item=${itemLabel} bytes=${tempStat.size}`);
    try { fs.rmSync(outputPath, { force: true }); } catch {}
    fs.renameSync(tempPath, outputPath);
    const outputStat = fs.statSync(outputPath);
    debugLog(`MPKG output published item=${itemLabel} bytes=${outputStat.size} elapsedMs=${Date.now() - startedAt}`);
    logger.log(`[MPKG] Finished ${sourceLabel} conversion for item ${itemLabel}: ${outputPath} (${outputStat.size} bytes)`);
    return outputPath;
  }

  async function ensureForItem(itemDir, id, requestedTextureProfile = currentTextureProfile()) {
    if (!itemDir || !fs.existsSync(itemDir) || !fs.statSync(itemDir).isDirectory()) {
      throw Object.assign(new Error('项目文件夹不存在，无法转换 MPKG'), { statusCode: 404 });
    }
    const isVideoProject = isVideoWorkshopDir(itemDir);
    const isSceneProject = isSceneWorkshopDir(itemDir);
    if (!isSceneProject && !isVideoProject) {
      throw Object.assign(new Error('仅场景类或视频类 Wallpaper 项目支持 MPKG 转换；场景项目需要 scene.pkg、project.json 和 preview.*，视频项目需要 project.json 指向的视频文件和 preview.*'), { statusCode: 400 });
    }
    if (!fs.existsSync(toolScript)) {
      throw Object.assign(new Error('MPKG 转换工具缺失：tools/mpkg/mobile_mpkg.py'), { statusCode: 500 });
    }
    const textureProfile = isVideoProject ? 'fast' : normalizeTextureProfile(requestedTextureProfile);
    const outputPath = outputPathForItem(itemDir, id, textureProfile);
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
      debugLog(`existing MPKG ready item=${id} bytes=${fs.statSync(outputPath).size}`);
      return outputPath;
    }

    const buildKey = `${path.resolve(itemDir)}|${String(id || '')}|${textureProfile}`;
    const existing = buildPromises.get(buildKey);
    if (existing) {
      logger.log(`[MPKG] Reusing active conversion for item ${id}`);
      debugLog(`joining active conversion item=${id}`);
      return existing;
    }
    const promise = buildForItem(itemDir, id, outputPath, textureProfile)
      .finally(() => { buildPromises.delete(buildKey); });
    buildPromises.set(buildKey, promise);
    return promise;
  }

  function notifyPreparationStage(options, stage) {
    try {
      if (typeof options?.onStageChange === 'function') options.onStageChange(stage);
    } catch {}
  }

  async function ensureDownloadedItem(id, title, options = {}) {
    const existing = findDownloadedItemPath(id);
    if (existing && fs.existsSync(existing)) {
      const dir = fs.statSync(existing).isDirectory() ? existing : path.dirname(existing);
      notifyPreparationStage(options, 'converting');
      return { itemDir: dir, title: title || `Wallpaper ${id}` };
    }
    const task = await createWorkshopQueueTask(id, title, { isVideo: false, videoOnly: false });
    notifyPreparationStage(options, 'downloading');
    const startedAt = Date.now();
    while (true) {
      const sourcePath = findDownloadedItemPath(id);
      if (sourcePath && fs.existsSync(sourcePath)) {
        const dir = fs.statSync(sourcePath).isDirectory() ? sourcePath : path.dirname(sourcePath);
        notifyPreparationStage(options, 'converting');
        return { itemDir: dir, title: task.title || title || `Wallpaper ${id}` };
      }
      if (task.status === 'error') {
        const error = new Error(task.errorMsg || 'Download failed before MPKG conversion');
        error.statusCode = task.requiresSteamLogin || task.requiresSteamGuard ? 401 : 500;
        error.code = task.errorCode || '';
        error.requiresSteamLogin = !!task.requiresSteamLogin;
        error.requiresSteamGuard = !!task.requiresSteamGuard;
        throw error;
      }
      if (task.status === 'paused' || task.status === 'cancelled') {
        throw Object.assign(new Error('下载已暂停或取消，无法转换 MPKG'), { statusCode: 409, code: 'DOWNLOAD_NOT_RUNNING' });
      }
      if (Date.now() - startedAt > 30 * 60 * 1000) {
        throw Object.assign(new Error('等待下载完成超时，无法转换 MPKG'), { statusCode: 504, code: 'DOWNLOAD_TIMEOUT' });
      }
      await sleep(1000);
    }
  }

  async function prepareDownloadFile(id, title, requestedTextureProfile = currentTextureProfile(), options = {}) {
    const wantId = parseInt(id);
    if (!wantId) {
      const error = new Error('Invalid id');
      error.statusCode = 400;
      throw error;
    }
    const startedAt = Date.now();
    const textureProfile = normalizeTextureProfile(requestedTextureProfile);
    debugLog(`prepare request item=${wantId} profile=${textureProfile}`);
    const { itemDir, title: resolvedTitle } = await ensureDownloadedItem(wantId, title, options);
    debugLog(`source ready item=${wantId} source=available`);
    const mpkgPath = await ensureForItem(itemDir, wantId, textureProfile);
    const stat = fs.statSync(mpkgPath);
    debugLog(`prepare complete item=${wantId} filename=${path.basename(mpkgPath)} bytes=${stat.size} elapsedMs=${Date.now() - startedAt}`);
    return {
      filePath: mpkgPath,
      fileName: path.basename(mpkgPath) || `${safeName(resolvedTitle)}-${wantId}.mpkg`,
      deleteAfterSend: false
    };
  }

  function isBuildingForDir(itemDir, id, requestedTextureProfile = currentTextureProfile()) {
    if (!itemDir) return false;
    const textureProfile = isVideoWorkshopDir(itemDir) ? 'fast' : normalizeTextureProfile(requestedTextureProfile);
    const buildKey = `${path.resolve(itemDir)}|${String(id || '')}|${textureProfile}`;
    return buildPromises.has(buildKey);
  }

  return {
    buildPromises,
    pythonDependencyStatus,
    findPythonExecutable,
    getCapabilities,
    hasWorkshopFile,
    hasWorkshopPreview,
    isVideoWorkshopDir,
    isSceneWorkshopDir,
    outputPathForItem,
    normalizeError,
    buildForItem,
    ensureForItem,
    ensureDownloadedItem,
    prepareDownloadFile,
    isBuildingForDir,
  };
}

module.exports = {
  createMpkgConversionService,
};
