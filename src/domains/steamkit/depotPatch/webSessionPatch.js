'use strict';

const { patchWebSessionProgram } = require('./webSessionProgramPatch');
const { patchWebSessionContent } = require('./webSessionContentPatch');
const {
  patchSteam3WebSession,
  repairSteam3AsyncJobAwait,
} = require('./steam3WebSessionPatch');
const { patchAccountStore } = require('./accountStorePatch');

module.exports = {
  patchWebSessionProgram,
  patchWebSessionContent,
  patchSteam3WebSession,
  repairSteam3AsyncJobAwait,
  patchAccountStore,
};
