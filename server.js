'use strict';

const { handOffInterruptedSourceUpdate } = require('./src/bootstrap/services/interruptedSourceUpdate');

if (handOffInterruptedSourceUpdate(__dirname)) process.exit(0);

const http = require('http');
const { createServerLifecycle } = require('./src/app/lifecycle');
const { composeHttpHandlers } = require('./src/app/handlers/composeHttpHandlers');
const { createWallhubContext } = require('./src/bootstrap/context/createWallhubContext');
const { startWallhubServer } = require('./src/bootstrap/startWallhubServer');

const context = createWallhubContext({ projectRoot: __dirname });
let restartServer;
let shutdownServer;
let isDockerLikeEnv;
const handleHttpRequest = composeHttpHandlers(context.createHttpCompositionConfig({
  getRestartServer: () => restartServer,
  getShutdownServer: () => shutdownServer,
  isDockerLikeEnv: () => isDockerLikeEnv(),
}));

({ isDockerLikeEnv, restartServer, shutdownServer } = startWallhubServer({
  http,
  cors: context.cors,
  handleHttpRequest,
  createServerLifecycle,
  port: context.port,
  entryFile: __filename,
  projectRoot: context.projectRoot,
  isSupervisorChild: context.isSupervisorChild,
  isRestartChild: context.isRestartChild,
  logger: console,
  onHttpListening: context.onHttpListening,
  markServerStopping: context.markServerStopping,
  stopAllDepotStreamWorkers: context.stopRuntimeWorkers,
  buildDepotRuntime: context.buildDepotRuntime,
}));

context.setRequestUpdateShutdown(() => (
  shutdownServer().catch(error => console.warn('[Update] Shutdown failed:', error.message))
));
