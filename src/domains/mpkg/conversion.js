'use strict';

const fs = require('fs');
const path = require('path');

const { createMpkgConversionRunner } = require('./conversionRunner');
const { normalizeMpkgId, normalizeMpkgTextureProfile } = require('./normalizers');
const {
  hasWorkshopFile,
  hasWorkshopPreview,
  isSceneWorkshopDir,
  isVideoWorkshopDir,
} = require('./projectInspection');
const { createMpkgPythonCapabilities } = require('./pythonCapabilities');
const { createMpkgSourcePreparation } = require('./sourcePreparation');

function createMpkgConversionService(options = {}) {
  const toolDir = options.toolDir;
  const toolScript = options.toolScript || (toolDir ? path.join(toolDir, 'mobile_mpkg.py') : '');
  const ensureDir = options.ensureDir;
  const commandExists = options.commandExists;
  const runProcess = options.runProcess;
  const sleep = options.sleep;
  const findDownloadedItemPath = options.findDownloadedItemPath;
  const createWorkshopQueueTask = options.createWorkshopQueueTask;
  const safeName = options.safeName;
  const logger = options.logger || console;
  const getDebugEnabled = typeof options.isDebugEnabled === 'function' ? options.isDebugEnabled : () => !!options.isDebugEnabled;
  const getVerboseDebugEnabled = typeof options.isVerboseDebugEnabled === 'function' ? options.isVerboseDebugEnabled : () => !!options.isVerboseDebugEnabled;
  const getTextureProfile = typeof options.getTextureProfile === 'function'
    ? options.getTextureProfile
    : () => process.env.WALLHUB_MPKG_TEXTURE_PROFILE;
  const buildPromises = new Map();

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

  function currentTextureProfile() {
    try {
      return normalizeMpkgTextureProfile(getTextureProfile());
    } catch {
      return 'fast';
    }
  }

  const pythonCapabilities = createMpkgPythonCapabilities({
    commandExists,
    pythonDependencyStatus: options.pythonDependencyStatus,
    logger,
  });
  const sourcePreparation = createMpkgSourcePreparation({
    findDownloadedItemPath,
    createWorkshopQueueTask,
    sleep,
  });
  const conversionRunner = createMpkgConversionRunner({
    toolDir,
    toolScript,
    ensureDir,
    runProcess,
    findPythonExecutable: pythonCapabilities.findPythonExecutable,
    getPythonLastError: pythonCapabilities.getLastError,
    isVideoWorkshopDir,
    logger,
    debugEnabled,
    verboseDebugEnabled,
    debugLog,
  });
  const {
    pythonDependencyStatus,
    findPythonExecutable,
    getCapabilities,
  } = pythonCapabilities;
  const { normalizeError } = conversionRunner;
  const { ensureDownloadedItem } = sourcePreparation;

  function outputPathForItem(itemDir, id, textureProfile = currentTextureProfile()) {
    const safeId = String(id || path.basename(itemDir || '') || 'wallpaper').replace(/[^\dA-Za-z_.-]/g, '') || 'wallpaper';
    const outDir = path.join(itemDir, 'Mpkg');
    const suffix = normalizeMpkgTextureProfile(textureProfile) === 'compact' ? '.compact' : '';
    return path.join(outDir, `${safeId}${suffix}.mpkg`);
  }

  async function buildForItem(itemDir, id, outputPath, textureProfile = currentTextureProfile()) {
    return conversionRunner.buildForItem(itemDir, id, outputPath, textureProfile);
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
    const textureProfile = isVideoProject ? 'fast' : normalizeMpkgTextureProfile(requestedTextureProfile);
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

  async function prepareDownloadFile(id, title, requestedTextureProfile = currentTextureProfile(), options = {}) {
    const wantId = normalizeMpkgId(id);
    if (!wantId) {
      const error = new Error('Invalid id');
      error.statusCode = 400;
      throw error;
    }
    const startedAt = Date.now();
    const textureProfile = normalizeMpkgTextureProfile(requestedTextureProfile);
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
    const textureProfile = isVideoWorkshopDir(itemDir) ? 'fast' : normalizeMpkgTextureProfile(requestedTextureProfile);
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
