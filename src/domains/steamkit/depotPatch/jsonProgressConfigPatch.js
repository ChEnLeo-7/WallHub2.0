'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { replaceSourceRegexOnce } = require('./sourceEdits');

function patchJsonProgressConfig(projectDir) {
  const configPath = path.join(projectDir, 'DownloadConfig.cs');
  if (fs.existsSync(configPath)) {
    let config = fs.readFileSync(configPath, 'utf8');
    if (!config.includes('WallHubJsonProgress')) {
      config = replaceSourceRegexOnce(
        config,
        /^(\s*public\s+bool\s+DownloadManifestOnly\s*\{\s*get;\s*set;\s*\}\s*)$/m,
        `$1${os.EOL}        public bool WallHubJsonProgress { get; set; }`,
        'DepotDownloader DownloadConfig.cs'
      );
      fs.writeFileSync(configPath, config, 'utf8');
    }
  } else {
    throw new Error('DepotDownloader DownloadConfig.cs not found');
  }
}

module.exports = { patchJsonProgressConfig };
