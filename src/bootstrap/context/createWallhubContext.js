'use strict';

const path = require('path');
const { createRequire } = require('module');

const { createConfigurationState } = require('./createConfigurationState');
const { assembleSteamAccessServices } = require('../services/steamAccessServices');
const { assembleSteamKitDownloadServices } = require('../services/steamKitDownloadServices');
const { assembleSteamKitServices } = require('../services/steamKitServices');
const { assembleWorkshopServices } = require('../services/workshopServices');
const { assembleDownloadMediaServices } = require('../services/downloadMediaServices');
const { createPublicWallhubContext } = require('./createPublicWallhubContext');

function createWallhubContext(options = {}) {
  const projectRoot = options.projectRoot || path.resolve(__dirname, '../../..');
  const rootRequire = createRequire(path.join(projectRoot, 'server.js'));
  const scope = createConfigurationState({ rootRequire, projectRoot });

  assembleSteamAccessServices(scope);
  assembleSteamKitDownloadServices(scope);
  assembleSteamKitServices(scope);
  assembleWorkshopServices(scope);
  assembleDownloadMediaServices(scope);

  return createPublicWallhubContext(scope);
}

module.exports = { createWallhubContext };
