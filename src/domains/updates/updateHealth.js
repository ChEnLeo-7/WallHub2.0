'use strict';

const crypto = require('crypto');
const http = require('http');
const https = require('https');
const { spawn } = require('child_process');
const { run } = require('./updaterProcess');

function startRestartProcess(request) {
  if (!request.restartCommand) return;
  const restartEnv = Object.assign({}, process.env, {
    WALLHUB_UPDATE_HELPER: '',
    WALLHUB_UPDATE_RESTART: '1',
    WALLHUB_UPDATE_HEALTH_TOKEN: request.healthToken || '',
  });
  delete restartEnv.WALLHUB_UPDATE_NPM_PROXY;
  const cp = spawn(request.restartCommand, Array.isArray(request.restartArgs) ? request.restartArgs : [], {
    cwd: request.restartCwd || request.projectRoot,
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
    env: restartEnv,
  });
  if (!Number.isInteger(cp.pid) || cp.pid <= 1) throw new Error('Could not restart WallHub after the update');
  cp.on('error', () => {});
  return cp;
}

function healthCheck(url, expectedToken) {
  return new Promise(resolve => {
    let settled = false;
    const finish = value => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    try {
      const client = String(url).startsWith('https:') ? https : http;
      const request = client.get(url, { timeout: 2000 }, response => {
        response.resume();
        const actualToken = String(response.headers['x-wallhub-health-token'] || '');
        finish(response.statusCode === 200 && !!expectedToken && actualToken === String(expectedToken));
      });
      request.on('timeout', () => { request.destroy(); finish(false); });
      request.on('error', () => finish(false));
    } catch {
      finish(false);
    }
  });
}

function stopProcessTree(pid) {
  if (!Number.isInteger(pid) || pid <= 1) return;
  if (process.platform === 'win32') {
    try { run('taskkill', ['/pid', String(pid), '/T', '/F']); } catch {}
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch {
    try { process.kill(pid, 'SIGKILL'); } catch {}
  }
}

async function restartAndWait(request, timeoutMs = 60000) {
  if (!request.healthToken) request.healthToken = crypto.randomBytes(32).toString('hex');
  const cp = startRestartProcess(request);
  const deadline = Date.now() + timeoutMs;
  let consecutive = 0;
  while (Date.now() < deadline) {
    if (cp.exitCode !== null || cp.signalCode !== null) break;
    if (await healthCheck(request.healthUrl || 'http://127.0.0.1:3090/health', request.healthToken)) {
      consecutive += 1;
      if (consecutive >= 3) {
        cp.unref();
        return cp;
      }
    } else {
      consecutive = 0;
    }
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  stopProcessTree(cp.pid);
  throw new Error('Updated WallHub did not pass its startup health check');
}

module.exports = {
  startRestartProcess,
  healthCheck,
  restartAndWait,
  stopProcessTree,
};
