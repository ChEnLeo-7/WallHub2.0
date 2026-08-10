'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

test('custom accent HEX input accepts incomplete drafts without treating them as committed colors', async () => {
  const { isCompleteCustomAccentColor } = await import('./customAccentInput.mjs');
  assert.equal(isCompleteCustomAccentColor('#'), false);
  assert.equal(isCompleteCustomAccentColor('#5'), false);
  assert.equal(isCompleteCustomAccentColor('#5e8c'), false);
  assert.equal(isCompleteCustomAccentColor('#5e8cff'), true);
});

test('shared presentation modules work in a portable layout without frontend sources', async (t) => {
  const portableRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-shared-'));
  t.after(() => fs.rmSync(portableRoot, { recursive: true, force: true }));
  const sharedDir = path.join(portableRoot, 'src', 'shared');
  fs.mkdirSync(sharedDir, { recursive: true });
  for (const file of ['customAccentInput.mjs', 'detailsPresentation.mjs']) {
    fs.copyFileSync(path.join(__dirname, file), path.join(sharedDir, file));
  }

  const accent = await import(`${pathToFileUrl(path.join(sharedDir, 'customAccentInput.mjs'))}?portable`);
  const details = await import(`${pathToFileUrl(path.join(sharedDir, 'detailsPresentation.mjs'))}?portable`);

  assert.equal(accent.isCompleteCustomAccentColor('#5e8cff'), true);
  assert.equal(details.normalizeDetailsPresentation('classic'), 'classic');
  assert.equal(details.normalizeDetailsPresentation('unknown'), details.DEFAULT_DETAILS_PRESENTATION);
});

function pathToFileUrl(filePath) {
  return require('node:url').pathToFileURL(filePath).href;
}
