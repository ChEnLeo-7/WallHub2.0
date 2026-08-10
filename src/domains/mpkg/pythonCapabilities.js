'use strict';

const { execFileSync } = require('child_process');

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

function createMpkgPythonCapabilities(options = {}) {
  const commandExists = options.commandExists;
  const checkPythonDependencies = typeof options.pythonDependencyStatus === 'function'
    ? options.pythonDependencyStatus
    : pythonDependencyStatus;
  const logger = options.logger || console;
  let lastError = '';

  function findPythonExecutable(options = {}) {
    const requireSceneDependencies = options.requireSceneDependencies !== false;
    const candidates = [
      process.env.PYTHON || '',
      process.env.PYTHON3 || '',
      'python3',
      'python',
      process.platform === 'win32' ? 'py' : '',
    ].filter(Boolean);
    const missing = [];
    lastError = '';
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
    lastError = missing.join(' | ');
    if (missing.length) {
      const requirement = requireSceneDependencies ? 'Pillow/lz4' : 'the standard library';
      logger.warn(`[MPKG] No Python with ${requirement} found. Checked: ${lastError}`);
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

  return {
    pythonDependencyStatus,
    findPythonExecutable,
    getCapabilities,
    getLastError: () => lastError,
  };
}

module.exports = {
  pythonDependencyStatus,
  createMpkgPythonCapabilities,
};
