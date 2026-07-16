'use strict';

function parseNsfwEnabledArg(argv = process.argv) {
  return argv.slice(2).some((value) => {
    const arg = String(value || '').trim().toLowerCase();
    return arg === '-nsfw' || arg === '--nsfw';
  });
}

function parseDebugEnabledArg(argv = process.argv) {
  return argv.slice(2).some((value) => {
    const arg = String(value || '').trim().toLowerCase();
    return arg === '-debug' || arg === '--debug';
  });
}

module.exports = {
  parseNsfwEnabledArg,
  parseDebugEnabledArg,
};
