'use strict';

const {
  replaceSourceOnce,
  replaceSourceRegexOnce,
  ensureCSharpUsing,
  ensureCSharpUsings,
  assertNoBrokenCSharpCharLiterals,
} = require('./depotPatch/sourceEdits');
const { patchDepotDownloaderForJsonProgress } = require('./depotPatch/patchDepotDownloader');

module.exports = {
  ensureCSharpUsing,
  ensureCSharpUsings,
  assertNoBrokenCSharpCharLiterals,
  replaceSourceOnce,
  replaceSourceRegexOnce,
  patchDepotDownloaderForJsonProgress,
};
