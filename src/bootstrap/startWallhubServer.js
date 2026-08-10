'use strict';

function startWallhubServer(options = {}) {
  const {
    http, cors, handleHttpRequest, createServerLifecycle, port, entryFile, projectRoot,
    isSupervisorChild, isRestartChild, onHttpListening, markServerStopping,
    stopAllDepotStreamWorkers, buildDepotRuntime, logger = console,
    argv = process.argv,
  } = options;
  const server = http.createServer(async (req, res) => {
    cors(res);
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    return handleHttpRequest(req, res);
  });
  const serverLifecycle = createServerLifecycle({
    server, port, entryFile, projectRoot, isSupervisorChild, isRestartChild, logger, argv,
    onHttpListening, markServerStopping, stopAllDepotStreamWorkers, buildDepotRuntime,
  });
  serverLifecycle.installProcessExitHook();
  serverLifecycle.installWorkerStopMessageHandler();
  serverLifecycle.installServerErrorHandler();
  if (argv.includes('--build-depot-runtime')) serverLifecycle.buildDepotRuntimeAndExit();
  else if (serverLifecycle.shouldRunSupervisorParent()) serverLifecycle.startSupervisorParent();
  else serverLifecycle.startHttpServer();
  return {
    server,
    serverLifecycle,
    isDockerLikeEnv: serverLifecycle.isDockerLikeEnv,
    restartServer: serverLifecycle.restartServer,
    shutdownServer: serverLifecycle.shutdownServer,
  };
}

module.exports = { startWallhubServer };
