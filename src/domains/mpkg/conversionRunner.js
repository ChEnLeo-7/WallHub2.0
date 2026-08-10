'use strict';

const fs = require('fs');
const path = require('path');

const { normalizeMpkgTextureProfile } = require('./normalizers');

function normalizeConversionError(error, options = {}) {
  const message = String(error && error.message || error || '').trim();
  if (/Pillow is required|No module named ['"]PIL|ModuleNotFoundError.*PIL/i.test(message)) return 'MPKG 转换需要 Python Pillow：pip install Pillow';
  if (/lz4 is required|No module named ['"]lz4|ModuleNotFoundError.*lz4/i.test(message)) return 'MPKG 转换需要 Python lz4：pip install lz4';
  if (/not recognized|not found|ENOENT|No such file or directory/i.test(message)) {
    return options.isVideo ? '未找到 Python，请先安装 Python 3。' : '未找到 Python，请先安装 Python 3，并安装 Pillow、lz4。';
  }
  return message || 'MPKG 转换失败';
}

function createMpkgConversionRunner(options = {}) {
  const toolDir = options.toolDir;
  const toolScript = options.toolScript;
  const ensureDir = options.ensureDir;
  const runProcess = options.runProcess;
  const findPythonExecutable = options.findPythonExecutable;
  const getPythonLastError = options.getPythonLastError;
  const isVideoWorkshopDir = options.isVideoWorkshopDir;
  const logger = options.logger || console;
  const debugEnabled = options.debugEnabled;
  const verboseDebugEnabled = options.verboseDebugEnabled;
  const debugLog = options.debugLog;

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

  async function buildForItem(itemDir, id, outputPath, textureProfile = 'fast') {
    const itemLabel = String(id || path.basename(itemDir) || 'unknown');
    const isVideoProject = isVideoWorkshopDir(itemDir);
    const profile = isVideoProject ? 'fast' : normalizeMpkgTextureProfile(textureProfile);
    const sourceLabel = isVideoProject ? 'video -> MPKG' : 'PKG -> MPKG';
    const startedAt = Date.now();
    const python = findPythonExecutable({ requireSceneDependencies: !isVideoProject });
    if (!python) {
      const pythonLastError = getPythonLastError();
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
        onStderr: chunk => logToolChunk(chunk, 'warn'),
      });
      debugLog(`conversion process exited item=${itemLabel} elapsedMs=${Date.now() - startedAt} stdoutBytes=${Buffer.byteLength(String(result && result.out || ''), 'utf8')} stderrBytes=${Buffer.byteLength(String(result && result.err || ''), 'utf8')}`);
    } catch (error) {
      debugLog(`conversion process failed item=${itemLabel} elapsedMs=${Date.now() - startedAt} error=${String(error && error.message || error || 'unknown')}`);
      try { fs.rmSync(tempPath, { force: true }); } catch {}
      throw Object.assign(new Error(normalizeConversionError(error, { isVideo: isVideoProject })), { statusCode: error.statusCode || 500 });
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

  return {
    normalizeError: normalizeConversionError,
    buildForItem,
  };
}

module.exports = {
  normalizeConversionError,
  createMpkgConversionRunner,
};
