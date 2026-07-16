'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const projectRoot = path.resolve(__dirname, '..', '..');
const detailsDialogPath = path.join(projectRoot, 'frontend', 'src', 'components', 'dialogs', 'DetailsDialog.tsx');
const stylesPath = path.join(projectRoot, 'frontend', 'src', 'styles.css');

test('details presentation preference uses the redesigned layout by default while retaining an explicit classic choice', async () => {
  const {
    DEFAULT_DETAILS_PRESENTATION,
    normalizeDetailsPresentation,
  } = await import('./detailsPresentation.mjs');

  assert.equal(DEFAULT_DETAILS_PRESENTATION, 'redesigned');
  assert.equal(normalizeDetailsPresentation(undefined), 'redesigned');
  assert.equal(normalizeDetailsPresentation('classic'), 'classic');
  assert.equal(normalizeDetailsPresentation('redesigned'), 'redesigned');
});

test('details presentation preference safely normalizes unknown persisted values to the redesigned default', async () => {
  const { normalizeDetailsPresentation } = await import('./detailsPresentation.mjs');

  assert.equal(normalizeDetailsPresentation('modern'), 'redesigned');
  assert.equal(normalizeDetailsPresentation('REDESIGNED'), 'redesigned');
  assert.equal(normalizeDetailsPresentation({}), 'redesigned');
});

test('redesigned detail panel lets the fixed left rail determine the description panel height', async () => {
  const { REDESIGNED_DETAILS_PANEL_STYLE } = await import('./detailsPresentation.mjs');

  assert.deepEqual(REDESIGNED_DETAILS_PANEL_STYLE.rightColumn, { minHeight: 0 });
  assert.deepEqual(REDESIGNED_DETAILS_PANEL_STYLE.description, { minHeight: 0, overflowY: 'auto' });
});

test('redesigned metadata tags use a lighter rounded-rectangle surface with an accent hover state', () => {
  const dialog = fs.readFileSync(detailsDialogPath, 'utf8');
  const styles = fs.readFileSync(stylesPath, 'utf8');

  assert.match(dialog, /details-metadata-tag inline-flex items-center !rounded-lg/);
  assert.match(styles, /\.details-metadata-tag\s*\{[\s\S]*?background:\s*hsl\(var\(--muted\) \/ 0\.92\);[\s\S]*?transition:/);
  assert.match(styles, /\.details-metadata-tag:hover,\s*\.details-metadata-tag\[aria-pressed='true'\]\s*\{[\s\S]*?background:\s*hsl\(var\(--accent\)\);[\s\S]*?color:\s*hsl\(var\(--accent-foreground\)\);/);
});

test('redesigned description is size-contained so only the fixed preview and fact rows determine desktop height', () => {
  const dialog = fs.readFileSync(detailsDialogPath, 'utf8');

  assert.match(dialog, /lg:items-start/);
  assert.match(dialog, /aspect-\[16\/9\][^"]*h-auto[^"]*lg:self-start/);
  assert.match(dialog, /grid-cols-2 gap-2 sm:grid-cols-3[^\"]*lg:self-start lg:content-start/);
  assert.match(dialog, /lg:\[contain:size\]/);
  assert.match(dialog, /overflow-y-auto overscroll-contain/);
});

test('redesigned comment loading uses transform shimmer rather than full-card opacity pulsing', () => {
  const dialog = fs.readFileSync(detailsDialogPath, 'utf8');
  const styles = fs.readFileSync(stylesPath, 'utf8');
  const commentLoadingBranch = dialog.match(/isRedesigned \? \(\s*<div className="grid gap-2" aria-label=\{text\.loadingComments\}>([\s\S]*?)\) : \(/);

  assert.ok(commentLoadingBranch, 'expected the redesigned comment loading branch');
  assert.match(commentLoadingBranch[1], /details-comment-skeleton/);
  assert.doesNotMatch(commentLoadingBranch[1], /animate-pulse/);
  assert.match(styles, /\.details-comment-skeleton\s*\{[\s\S]*?contain:\s*paint;/);
  assert.match(styles, /\.details-comment-skeleton::after\s*\{[\s\S]*?animation:\s*details-comment-skeleton-shimmer[\s\S]*?will-change:\s*transform;/);
  assert.match(styles, /@keyframes details-comment-skeleton-shimmer\s*\{[\s\S]*?translate3d\(-130%,\s*0,\s*0\)[\s\S]*?translate3d\(130%,\s*0,\s*0\)/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*?\.details-comment-skeleton::after\s*\{[\s\S]*?animation:\s*none;/);
});
