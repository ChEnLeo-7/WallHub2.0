'use strict';

const fs = require('fs');
const { fork, execFileSync } = require('child_process');

function createServerLifecycle(options = {}) {
  const {
    server,
    port,
    host = '0.0.0.0',
    entryFile,
    projectRoot,
    isSupervisorChild = false,
    isRestartChild = false,
    logger = console,
    env = process.env,
    argv = process.argv,
    execArgv = process.execArgv,
    platform = process.platform,
    onHttpListening = () => {},
    markServerStopping = () => {},
    stopAllDepotStreamWorkers = () => {},
    buildDepotRuntime = async () => ({}),
    exit = (code) => process.exit(code),
    sendProcessMessage = (msg) => {
      if (typeof process.send === 'function') process.send(msg);
    },
    canSendProcessMessage = () => typeof process.send === 'function',
  } = options;

  function isDockerLikeEnv() {
    if (env.DOCKER_CONTAINER || env.CONTAINER || env.KUBERNETES_SERVICE_HOST) return true;
    try {
      if (fs.existsSync('/.dockerenv')) return true;
      if (fs.existsSync('/proc/1/cgroup')) {
        const cgroup = fs.readFileSync('/proc/1/cgroup', 'utf8');
        if (/docker|containerd|kubepods/i.test(cgroup)) return true;
      }
    } catch (e) {}
    return false;
  }

  function shouldRunSupervisorParent() {
    if (isSupervisorChild) return false;
    if (isRestartChild) return false;
    if (env.WALLHUB_SUPERVISOR === '0') return false;
    if (argv.slice(2).some(arg => String(arg || '').toLowerCase() === '--no-supervisor')) return false;
    return true;
  }

  function startSupervisorParent() {
    let child = null;
    let requestedAction = '';
    let stopping = false;
    let restartTimer = null;

    const supervisorLog = (message) => {
      logger.log(`[Supervisor] ${message}`);
    };
    const childArgs = argv.slice(2).filter(arg => String(arg || '').toLowerCase() !== '--no-supervisor');

    const killChildProcess = (proc, reason) => {
      if (!proc || proc.killed) return;
      supervisorLog(`stopping worker pid=${proc.pid}${reason ? ` (${reason})` : ''}`);
      try {
        if (proc.connected) proc.send({ type: 'wallhub:stop', reason: reason || 'supervisor' });
      } catch {}
      setTimeout(() => {
        if (!proc.killed && proc.exitCode === null && proc.signalCode === null) {
          try { proc.kill('SIGTERM'); } catch {}
        }
      }, 1200);
      if (platform === 'win32') {
        setTimeout(() => {
          if (!proc.killed && proc.exitCode === null && proc.signalCode === null) {
            try { execFileSync('taskkill', ['/pid', String(proc.pid), '/T', '/F'], { stdio: 'ignore' }); } catch {}
          }
        }, 4500);
      } else {
        setTimeout(() => {
          if (!proc.killed && proc.exitCode === null && proc.signalCode === null) {
            try { proc.kill('SIGKILL'); } catch {}
          }
        }, 4500);
      }
    };

    const spawnWorker = (reason) => {
      const childEnv = Object.assign({}, env, {
        WALLHUB_SUPERVISOR_CHILD: '1',
        WALLHUB_RESTART_CHILD: ''
      });
      delete childEnv.WALLHUB_RESTART_CHILD;
      supervisorLog(`starting worker${reason ? ` (${reason})` : ''}`);
      child = fork(entryFile, childArgs, {
        cwd: projectRoot,
        env: childEnv,
        execArgv,
        stdio: ['inherit', 'inherit', 'inherit', 'ipc'],
        windowsHide: true
      });
      child.on('message', (msg) => {
        const type = String((msg && msg.type) || '');
        if (type === 'wallhub:restart') {
          requestedAction = 'restart';
          supervisorLog(`restart requested by worker pid=${child.pid}`);
          const target = child;
          setTimeout(() => killChildProcess(target, 'restart'), 800);
        } else if (type === 'wallhub:shutdown') {
          requestedAction = 'shutdown';
          stopping = true;
          supervisorLog(`shutdown requested by worker pid=${child.pid}`);
          const target = child;
          setTimeout(() => killChildProcess(target, 'shutdown'), 800);
        }
      });
      child.on('exit', (code, signal) => {
        supervisorLog(`worker exited code=${code ?? ''} signal=${signal || ''}`);
        const action = requestedAction;
        child = null;
        requestedAction = '';
        if (action === 'restart') {
          restartTimer = setTimeout(() => spawnWorker('restart'), 600);
          return;
        }
        if (action === 'shutdown' || stopping) {
          supervisorLog('supervisor exiting');
          exit(0);
          return;
        }
        restartTimer = setTimeout(() => spawnWorker('unexpected exit'), 1200);
      });
    };

    const shutdownSupervisor = () => {
      if (stopping) return;
      stopping = true;
      if (restartTimer) clearTimeout(restartTimer);
      if (child) {
        requestedAction = 'shutdown';
        killChildProcess(child, 'parent signal');
      } else {
        exit(0);
      }
    };

    process.on('SIGINT', shutdownSupervisor);
    process.on('SIGTERM', shutdownSupervisor);
    process.on('exit', () => {
      if (child && !child.killed) {
        try { child.kill('SIGTERM'); } catch {}
      }
    });

    spawnWorker('initial');
  }

  async function restartServer() {
    markServerStopping();
    stopAllDepotStreamWorkers('server-restart');
    if (isSupervisorChild && canSendProcessMessage()) {
      sendProcessMessage({ type: 'wallhub:restart' });
      return { mode: 'supervisor' };
    }
    if (isDockerLikeEnv()) {
      setTimeout(() => exit(0), 800);
      return { mode: 'exit' };
    }
    logger.warn('[Restart] Running without supervisor; exiting for external restart.');
    setTimeout(() => exit(0), 800);
    return { mode: 'exit' };
  }

  async function shutdownServer() {
    markServerStopping();
    stopAllDepotStreamWorkers('server-shutdown');
    if (isSupervisorChild && canSendProcessMessage()) {
      sendProcessMessage({ type: 'wallhub:shutdown' });
      return { mode: 'supervisor' };
    }
    setTimeout(() => exit(0), 800);
    return { mode: 'exit' };
  }

  function startHttpServer() {
    server.listen(port, host, onHttpListening);
  }

  function closeHttpServerAndExit(code) {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      exit(code || 0);
    };
    try {
      server.close(finish);
    } catch {
      finish();
    }
    setTimeout(finish, 1800).unref();
  }

  function installProcessExitHook() {
    process.once('exit', () => {
      markServerStopping();
      stopAllDepotStreamWorkers('process-exit');
    });
  }

  function installWorkerStopMessageHandler() {
    if (!isSupervisorChild || typeof process.on !== 'function') return;
    process.on('message', (msg) => {
      if (msg && msg.type === 'wallhub:stop') {
        closeHttpServerAndExit(0);
      }
    });
  }

  function installServerErrorHandler() {
    server.on('error', err => {
      if (err.code === 'EADDRINUSE') logger.error(`\n[Error] Port ${port} is already in use\n`);
      else logger.error('\n[Error]', err.message);
      exit(1);
    });
  }

  async function buildDepotRuntimeAndExit() {
    try {
      const result = await buildDepotRuntime();
      logger.log(`[Build] SteamKit JSON progress runtime: ${result.json}`);
      logger.log(`[Build] SteamKit depot stream runtime: ${result.stream}`);
      exit(0);
    } catch (e) {
      logger.error('[Build] Depot runtime build failed:', e && e.stack ? e.stack : e);
      exit(1);
    }
  }

  return {
    isDockerLikeEnv,
    shouldRunSupervisorParent,
    startSupervisorParent,
    restartServer,
    shutdownServer,
    startHttpServer,
    closeHttpServerAndExit,
    installProcessExitHook,
    installWorkerStopMessageHandler,
    installServerErrorHandler,
    buildDepotRuntimeAndExit,
  };
}

module.exports = {
  createServerLifecycle,
};
