'use strict';

const {
  patchJsonProgressReporting,
  patchJsonProgressDownloads,
} = require('./jsonProgressContentPatch');
const { writeChunkProgressSource } = require('./chunkProgressTemplate');
const { patchJsonProgressConfig } = require('./jsonProgressConfigPatch');

module.exports = {
  patchJsonProgressReporting,
  patchJsonProgressDownloads,
  writeChunkProgressSource,
  patchJsonProgressConfig,
};
