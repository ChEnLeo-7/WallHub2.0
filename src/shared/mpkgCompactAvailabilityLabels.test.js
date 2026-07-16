'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const textSource = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/lib/text.ts'), 'utf8');
const dialogSource = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/components/dialogs/SettingsDialog.tsx'), 'utf8');
const appSource = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/App.tsx'), 'utf8');

test('MPKG space-saving option remains disabled with a nontechnical availability message when unavailable', () => {
  assert.match(textSource, /mpkgTextureProfileCompactUnavailable: '当前环境暂不支持“最大压缩”，将自动使用“快速模式”。'/);
  assert.match(dialogSource, /const compactUnavailable = profile === 'compact' && !mpkgCompactAvailable;/);
  assert.match(dialogSource, /disabled=\{compactUnavailable\}/);
  assert.match(dialogSource, /text\.mpkgTextureProfileCompactUnavailable/);
  assert.match(appSource, /mpkgTextureProfile: data\.mpkgCompactAvailable === true && data\.mpkgTextureProfile === 'compact' \? 'compact' : 'fast'/);
});
