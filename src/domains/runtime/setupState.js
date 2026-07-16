'use strict';

function createRuntimeSetupState(initial) {
  const state = Object.assign({
    mode: 'steamkit',
    requestedMode: 'steamkit',
    status: 'idle',
    message: '',
    progress: 0,
    runnerDir: '',
    downloadsDir: '',
    executablePath: '',
    error: '',
    updatedAt: Date.now(),
  }, initial || {});

  const update = (patch) => {
    Object.assign(state, patch || {}, { updatedAt: Date.now() });
    return state;
  };

  const snapshot = (context = {}) => Object.assign({}, state, {
    mode: 'steamkit',
    requestedMode: 'steamkit',
    runnerDir: context.runnerDir || state.runnerDir,
    accountDir: context.accountDir || state.accountDir,
    downloadsDir: context.downloadsDir || state.downloadsDir,
    executablePath: context.executablePath || state.executablePath || '',
  });

  return { state, update, snapshot };
}

function getDownloaderMode() {
  return 'steamkit';
}

module.exports = {
  createRuntimeSetupState,
  getDownloaderMode,
};
