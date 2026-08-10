'use strict';

const { patchStreamWorkerProgram } = require('./streamWorkerProgramPatch');
const { patchStreamWorkerContent } = require('./streamWorkerContentPatch');
const { writeStreamWorkerSource } = require('./streamWorkerTemplate');

module.exports = {
  patchStreamWorkerProgram,
  patchStreamWorkerContent,
  writeStreamWorkerSource,
};
