'use strict';

const fs = require('fs');
const path = require('path');
const githubSource = require('../../githubSource');

function createSourceDownload(deps, buildEnvironment) {
  const {
    env = process.env,
    logger = console,
    GITHUB_ACCELERATOR_MODE,
    UA,
    GET,
    ensureDir,
    runProcess,
    psQuote,
  } = deps;
  let googleReachabilityPromise = null;

  function googlePingArgs() {
    const host = 'www.google.com';
    if (process.platform === 'win32') return ['-n', '1', '-w', '2000', host];
    if (process.platform === 'darwin') return ['-c', '1', '-W', '2000', host];
    return ['-c', '1', '-W', '2', host];
  }

  async function checkGoogleReachability() {
    if (googleReachabilityPromise) return googleReachabilityPromise;
    googleReachabilityPromise = (async () => {
      try {
        logger.log('[GitHub] Pinging www.google.com before selecting a DepotDownloader source route');
        await runProcess('ping', googlePingArgs(), 5000);
        logger.log('[GitHub] Google ping succeeded');
        return true;
      } catch (error) {
        logger.warn(`[GitHub] Google ping failed; using GitHub accelerator: ${error.message || error}`);
        return false;
      }
    })();
    return googleReachabilityPromise;
  }

  function parseCsvEnv(name) {
    return githubSource.parseCsvEnv(env, name);
  }

  function isGithubDownloadUrl(url) {
    return githubSource.isGithubDownloadUrl(url);
  }

  function buildGithubProxyUrl(proxy, url) {
    return githubSource.buildGithubProxyUrl(proxy, url);
  }

  function githubProxyCandidates(url) {
    return githubSource.githubProxyCandidates(url, { env, acceleratorMode: GITHUB_ACCELERATOR_MODE });
  }

  async function chooseGithubDownloadRoutes(url) {
    return githubSource.chooseGithubDownloadRoutes(url, {
      env,
      acceleratorMode: GITHUB_ACCELERATOR_MODE,
      logger,
      checkGoogleReachability,
    });
  }

  async function downloadFileBuffer(url, dest) {
    return githubSource.downloadFileBuffer(url, dest, {
      env,
      acceleratorMode: GITHUB_ACCELERATOR_MODE,
      logger,
      GET,
      userAgent: UA,
      timeoutMs: 120000,
      checkGoogleReachability,
    });
  }

  async function downloadGithubRouteToFile(routes, dest) {
    return githubSource.downloadGithubRouteToFile(routes, dest, {
      logger,
      GET,
      userAgent: UA,
      timeoutMs: 120000,
    });
  }

  function looksLikeZipBuffer(buffer) {
    return githubSource.looksLikeZipBuffer(buffer);
  }

  async function extractZip(zipPath, destDir) {
    ensureDir(destDir);
    if (process.platform === 'win32') {
      const cmd = `Expand-Archive -Path '${psQuote(zipPath)}' -DestinationPath '${psQuote(destDir)}' -Force`;
      await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', cmd], 240000);
      return;
    }
    const unzip = buildEnvironment.commandExists('unzip');
    if (unzip) {
      await runProcess(unzip, ['-o', zipPath, '-d', destDir], 240000);
      return;
    }
    const python = buildEnvironment.commandExists(env.PYTHON || '') ||
      buildEnvironment.commandExists(env.PYTHON3 || '') ||
      buildEnvironment.commandExists('python3') ||
      buildEnvironment.commandExists('python');
    if (python) {
      const script = [
        'import sys, zipfile',
        'zip_path, dest_dir = sys.argv[1], sys.argv[2]',
        'with zipfile.ZipFile(zip_path) as z:',
        '    z.extractall(dest_dir)',
      ].join('\n');
      await runProcess(python, ['-c', script, zipPath, destDir], 240000);
      return;
    }
    throw new Error('未找到 unzip 或 Python zipfile。Linux/Termux 请安装 unzip 或 python3。');
  }

  function findFileRecursive(root, name) {
    if (!root || !fs.existsSync(root)) return '';
    const target = String(name || '').toLowerCase();
    const stack = [root];
    while (stack.length) {
      const dir = stack.pop();
      let entries = [];
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { continue; }
      for (const entry of entries) {
        const file = path.join(dir, entry.name);
        if (entry.isDirectory()) stack.push(file);
        else if (entry.isFile() && entry.name.toLowerCase() === target) return file;
      }
    }
    return '';
  }

  return {
    parseCsvEnv,
    isGithubDownloadUrl,
    buildGithubProxyUrl,
    githubProxyCandidates,
    checkGoogleReachability,
    chooseGithubDownloadRoutes,
    downloadFileBuffer,
    downloadGithubRouteToFile,
    looksLikeZipBuffer,
    extractZip,
    findFileRecursive,
  };
}

module.exports = { createSourceDownload };
