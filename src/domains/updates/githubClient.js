'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const githubRoutes = require('../../infrastructure/http/githubRoutes');
const {
  assertTrustedGithubUrl,
  googlePingArgs,
  prioritizeGithubRoutes,
} = require('./routePolicy');

const MAX_RELEASE_RESPONSE_BYTES = 4 * 1024 * 1024;
const MAX_UPDATE_ASSET_BYTES = 4 * 1024 * 1024 * 1024;

function curlProxyArgs(proxyUrl) {
  const value = String(proxyUrl || '').trim();
  return value ? ['--proxy', value] : [];
}

function canRetryWithoutCertificateRevocation(stderr, options = {}) {
  return process.platform === 'win32' &&
    !options.revocationFallback &&
    process.env.WALLHUB_CURL_NO_REVOKE !== '1' &&
    /(?:0x80092013|revocation (?:server|function).*offline|CRYPT_E_REVOCATION_OFFLINE)/i.test(String(stderr || ''));
}

function pingGoogle(options = {}) {
  const platform = options.platform || process.platform;
  const spawnProcess = options.spawnProcess || spawn;
  return new Promise((resolve, reject) => {
    const cp = spawnProcess('ping', googlePingArgs(platform), { windowsHide: true, stdio: 'ignore' });
    let settled = false;
    const finish = (error, reachable) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(reachable);
    };
    const timer = setTimeout(() => {
      try { cp.kill(); } catch {}
      finish(new Error('Google ping timed out'));
    }, 5000);
    timer.unref?.();
    cp.once('error', error => finish(error));
    cp.once('close', code => finish(null, code === 0));
  });
}

function requestBufferWithCurl(url, options = {}) {
  return new Promise((resolve, reject) => {
    const args = [
      '--fail', '--location', '--silent', '--show-error',
      '--proto', '=https', '--proto-redir', '=https',
      '--max-time', String(Math.max(5, Math.ceil(Number(options.timeoutMs || 30000) / 1000))),
      ...curlProxyArgs(options.proxyUrl),
      '--header', 'Accept: application/vnd.github+json',
      '--header', `User-Agent: ${options.userAgent || 'WallHub-Updater'}`,
    ];
    if (process.platform === 'win32' && (options.revocationFallback || process.env.WALLHUB_CURL_NO_REVOKE === '1')) args.push('--ssl-no-revoke');
    if (options.token) args.push('--header', `Authorization: Bearer ${options.token}`);
    args.push(String(url));
    const cp = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', args, { windowsHide: true });
    const chunks = [];
    let bytes = 0;
    let stderr = '';
    cp.stdout.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > (options.maxBytes || MAX_RELEASE_RESPONSE_BYTES)) {
        try { cp.kill(); } catch {}
        return;
      }
      chunks.push(Buffer.from(chunk));
    });
    cp.stderr.on('data', chunk => { stderr += chunk.toString(); });
    cp.on('error', reject);
    cp.on('close', code => {
      if (bytes > (options.maxBytes || MAX_RELEASE_RESPONSE_BYTES)) return reject(new Error('GitHub response is too large'));
      if (code !== 0 && canRetryWithoutCertificateRevocation(stderr, options)) {
        return requestBufferWithCurl(url, Object.assign({}, options, { revocationFallback: true })).then(resolve, reject);
      }
      if (code !== 0) return reject(new Error((stderr || `curl exit ${code}`).trim().slice(-1200)));
      resolve(Buffer.concat(chunks));
    });
  });
}

function downloadFileWithCurl(url, destination, options = {}) {
  return new Promise((resolve, reject) => {
    const partial = `${destination}.part`;
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    try { fs.rmSync(partial, { force: true }); } catch {}
    const args = [
      '--fail', '--location', '--silent', '--show-error',
      '--proto', '=https', '--proto-redir', '=https',
      '--max-time', String(Math.max(60, Math.ceil(Number(options.timeoutMs || 30 * 60 * 1000) / 1000))),
      '--max-filesize', String(Math.max(1, Number(options.maxBytes || MAX_UPDATE_ASSET_BYTES))),
      ...curlProxyArgs(options.proxyUrl),
      '--header', `User-Agent: ${options.userAgent || 'WallHub-Updater'}`,
    ];
    if (process.platform === 'win32' && (options.revocationFallback || process.env.WALLHUB_CURL_NO_REVOKE === '1')) args.push('--ssl-no-revoke');
    if (options.token) args.push('--header', `Authorization: Bearer ${options.token}`);
    args.push('--output', partial, String(url));
    const cp = spawn(process.platform === 'win32' ? 'curl.exe' : 'curl', args, { windowsHide: true });
    let stderr = '';
    const timer = setInterval(() => {
      try {
        const downloaded = fs.statSync(partial).size;
        options.onProgress?.(downloaded, Number(options.totalBytes || 0));
      } catch {}
    }, 250);
    timer.unref?.();
    cp.stderr.on('data', chunk => { stderr += chunk.toString(); });
    cp.on('error', error => {
      clearInterval(timer);
      reject(error);
    });
    cp.on('close', code => {
      clearInterval(timer);
      if (code !== 0) {
        try { fs.rmSync(partial, { force: true }); } catch {}
        if (canRetryWithoutCertificateRevocation(stderr, options)) {
          return downloadFileWithCurl(url, destination, Object.assign({}, options, { revocationFallback: true })).then(resolve, reject);
        }
        return reject(new Error((stderr || `curl exit ${code}`).trim().slice(-1200)));
      }
      options.onProgress?.(fs.statSync(partial).size, Number(options.totalBytes || 0));
      const size = fs.statSync(partial).size;
      if (size > Number(options.maxBytes || MAX_UPDATE_ASSET_BYTES)) {
        try { fs.rmSync(partial, { force: true }); } catch {}
        return reject(new Error('Downloaded update exceeds the allowed size'));
      }
      if (Number(options.totalBytes || 0) > 0 && size !== Number(options.totalBytes)) {
        try { fs.rmSync(partial, { force: true }); } catch {}
        return reject(new Error(`Downloaded update size ${size} does not match the release metadata ${options.totalBytes}`));
      }
      fs.renameSync(partial, destination);
      resolve(destination);
    });
  });
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const input = fs.createReadStream(filePath);
    input.on('data', chunk => hash.update(chunk));
    input.on('error', reject);
    input.on('end', () => resolve(hash.digest('hex')));
  });
}

function createGithubClient(options = {}) {
  const env = options.env || process.env;
  const logger = options.logger || console;
  const requestBuffer = options.requestBuffer || requestBufferWithCurl;
  const downloadFile = options.downloadFile || downloadFileWithCurl;
  const checkGoogleReachability = options.checkGoogleReachability || (() => pingGoogle({ platform: options.platform }));
  const acceleratorMode = options.acceleratorMode || env.WALLHUB_GITHUB_ACCELERATOR || 'auto';
  let googleReachable = null;

  function networkOptions(extra = {}) {
    return Object.assign({
      token: env.GITHUB_TOKEN || '',
      proxyUrl: options.getProxyUrl ? options.getProxyUrl() : '',
      userAgent: options.userAgent || 'WallHub-Updater',
    }, extra);
  }

  function routes(url) {
    const candidates = githubRoutes.githubProxyCandidates(url, { env, acceleratorMode });
    return prioritizeGithubRoutes(candidates, googleReachable);
  }

  async function selectRoutes(repository) {
    logger.log('[Update] Pinging google.com before checking for updates');
    try {
      googleReachable = !!(await checkGoogleReachability());
    } catch (error) {
      googleReachable = false;
      logger.warn(`[Update] Google ping failed; using GitHub accelerator: ${error.message || error}`);
    }
    if (googleReachable) {
      logger.log('[Update] Google is reachable; using GitHub directly with accelerator fallback');
      return;
    }
    const candidates = routes(`https://api.github.com/repos/${repository}/releases/latest`);
    logger.log(`[Update] Google is unavailable; GitHub route order: ${candidates.map(route => route.name).join(' -> ')}`);
  }

  async function requestTrustedBuffer(url, extra = {}, validate) {
    const trustedUrl = assertTrustedGithubUrl(url, ['api.github.com', 'github.com']);
    const body = await requestBuffer(trustedUrl, networkOptions(Object.assign({}, extra, {
      token: env.GITHUB_TOKEN || '',
    })));
    await validate?.(body);
    return body;
  }

  async function downloadTrustedFile(url, destination, extra = {}, validate) {
    assertTrustedGithubUrl(url, ['github.com', 'objects.githubusercontent.com', 'release-assets.githubusercontent.com']);
    let lastError = null;
    for (const route of routes(url)) {
      try {
        await downloadFile(route.url, destination, networkOptions(Object.assign({}, extra, {
          token: route.name === 'direct' ? (env.GITHUB_TOKEN || '') : '',
        })));
        await validate?.(destination);
        return destination;
      } catch (error) {
        lastError = error;
        logger.warn(`[Update] GitHub route failed (${route.name}): ${error.message || error}`);
      }
    }
    throw lastError || new Error('All GitHub update routes failed');
  }

  return { selectRoutes, requestTrustedBuffer, downloadTrustedFile };
}

module.exports = {
  MAX_RELEASE_RESPONSE_BYTES,
  MAX_UPDATE_ASSET_BYTES,
  pingGoogle,
  requestBufferWithCurl,
  downloadFileWithCurl,
  sha256File,
  createGithubClient,
};
