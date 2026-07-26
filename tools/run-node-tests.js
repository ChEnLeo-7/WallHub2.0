'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');
const sourceRoot = path.join(projectRoot, 'src');
const tests = [];
const pending = [sourceRoot];

while (pending.length) {
  const directory = pending.pop();
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) pending.push(fullPath);
    else if (entry.isFile() && entry.name.endsWith('.test.js')) tests.push(fullPath);
  }
}

tests.sort();
if (!tests.length) {
  console.error('No Node test files were found under src/.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...tests], {
  cwd: projectRoot,
  env: process.env,
  stdio: 'inherit',
  windowsHide: true,
});

if (result.error) {
  console.error(result.error.message || result.error);
  process.exit(1);
}
process.exit(Number.isInteger(result.status) ? result.status : 1);
