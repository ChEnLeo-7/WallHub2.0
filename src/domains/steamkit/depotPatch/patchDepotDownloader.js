'use strict';

const fs = require('fs');
const path = require('path');
const { patchCmLoginProgram } = require('./cmLoginPatch');
const { prepareProgram, patchProgramEntry } = require('./programEntryPatch');
const { patchQueryBridgeProgram } = require('./queryBridgePatch');
const {
  patchWebSessionProgram,
  patchWebSessionContent,
  patchAccountStore,
} = require('./webSessionPatch');
const {
  patchStreamWorkerProgram,
  patchStreamWorkerContent,
  writeStreamWorkerSource,
} = require('./streamWorkerPatch');
const {
  patchJsonProgressReporting,
  patchJsonProgressDownloads,
  writeChunkProgressSource,
  patchJsonProgressConfig,
} = require('./jsonProgressPatch');
const { writeDirectNetworkSource } = require('./generatedHelpers');
const { patchSteam3Session } = require('./steam3SessionPatch');

function patchDepotDownloaderForJsonProgress(projectDir, options = {}) {
  const includeStream = !!(options && options.includeStream);
  const programPath = path.join(projectDir, 'Program.cs');
  const contentPath = path.join(projectDir, 'ContentDownloader.cs');
  const accountStorePath = path.join(projectDir, 'AccountSettingsStore.cs');
  const steam3SessionPath = path.join(projectDir, 'Steam3Session.cs');
  let program = prepareProgram(programPath);
  let content = fs.readFileSync(contentPath, 'utf8');

  program = patchProgramEntry(programPath, program);
  program = patchWebSessionProgram(programPath, program);
  program = patchCmLoginProgram(programPath, program);
  program = patchQueryBridgeProgram(programPath, program);
  patchStreamWorkerProgram(programPath, program, includeStream);

  content = patchJsonProgressReporting(contentPath, content);
  content = patchWebSessionContent(contentPath, content);
  patchSteam3Session(steam3SessionPath);
  content = patchStreamWorkerContent(contentPath, content, includeStream);
  patchJsonProgressDownloads(contentPath, content);

  writeChunkProgressSource(projectDir);
  writeDirectNetworkSource(projectDir);
  writeStreamWorkerSource(projectDir, includeStream);
  patchJsonProgressConfig(projectDir);
  patchAccountStore(accountStorePath);
}

module.exports = { patchDepotDownloaderForJsonProgress };
