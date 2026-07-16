'use strict';

const os = require('os');
const path = require('path');

function resolveConfiguredDownloadsDir(raw, projectRoot, defaultDownloadsDir) {
  let value = String(raw || '').trim();
  if (!value) return defaultDownloadsDir;
  if (value === '~') value = os.homedir();
  else if (value.startsWith(`~${path.sep}`) || value.startsWith('~/')) {
    value = path.join(os.homedir(), value.slice(2));
  }
  return path.resolve(projectRoot, value);
}

module.exports = {
  resolveConfiguredDownloadsDir,
};
