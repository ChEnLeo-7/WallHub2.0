'use strict';

const fs = require('fs');
const path = require('path');

function findMissingPublicAssets(indexFile, publicDirectory) {
  const html = fs.readFileSync(indexFile, 'utf8');
  const references = [];
  const attributePattern = /\b(?:src|href)\s*=\s*(["'])(.*?)\1/gi;
  let match;

  while ((match = attributePattern.exec(html)) !== null) {
    const reference = match[2].trim();
    if (!reference || reference.startsWith('#') || reference.startsWith('//')) continue;
    if (/^[a-z][a-z\d+.-]*:/i.test(reference)) continue;
    const pathname = reference.split(/[?#]/, 1)[0];
    if (!pathname) continue;
    const relativePath = pathname.replace(/^[/\\]+/, '');
    references.push({
      reference,
      filePath: path.resolve(publicDirectory, relativePath),
    });
  }

  return references.filter(asset => !fs.existsSync(asset.filePath));
}

function main() {
  const projectRoot = path.resolve(__dirname, '..');
  const publicDirectory = path.join(projectRoot, 'public');
  const indexFile = path.join(publicDirectory, 'index.html');
  const missing = findMissingPublicAssets(indexFile, publicDirectory);

  if (missing.length) {
    console.error('Missing files referenced by public/index.html:');
    for (const asset of missing) console.error(`- ${asset.reference}`);
    process.exitCode = 1;
    return;
  }

  console.log('All local assets referenced by public/index.html exist.');
}

if (require.main === module) main();

module.exports = { findMissingPublicAssets };
