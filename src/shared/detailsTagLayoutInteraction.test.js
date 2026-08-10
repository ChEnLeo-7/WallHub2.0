'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const projectRoot = path.resolve(__dirname, '../..');
const detailsRoot = path.join(projectRoot, 'frontend/src/components/dialogs');
const detailsSource = [
  'details-dialog/types.ts',
  'details-dialog/useDetailsDialogController.ts',
  'details-dialog/DetailsMetadata.tsx',
  'DetailsDialog.tsx',
].map((file) => fs.readFileSync(path.join(detailsRoot, file), 'utf8')).join('\n');
const appSource = fs.readFileSync(path.join(projectRoot, 'frontend/src/App.tsx'), 'utf8');
const querySource = fs.readFileSync(path.join(projectRoot, 'frontend/src/lib/workshopQuery.ts'), 'utf8');
const stylesSource = fs.readFileSync(path.join(projectRoot, 'frontend/src/styles.css'), 'utf8');
const presentationSource = fs.readFileSync(path.join(projectRoot, 'src/shared/detailsPresentation.mjs'), 'utf8');
const zhTextSource = fs.readFileSync(path.join(projectRoot, 'frontend/src/lib/text/zh.ts'), 'utf8');
const enTextSource = fs.readFileSync(path.join(projectRoot, 'frontend/src/lib/text/en.ts'), 'utf8');

test('detail tags are selectable controls with a one-click selected-tag search action', () => {
  assert.match(detailsSource, /onSearchTags\?: \(tags: string\[\]\) => void/);
  assert.match(detailsSource, /const \[selectedTags, setSelectedTags\] = React\.useState<string\[\]>\(\[\]\)/);
  assert.match(detailsSource, /aria-pressed=\{selectedTags\.includes\(tag\)\}/);
  assert.match(detailsSource, /onClick=\{\(\) => onToggleTag\(tag\)\}/);
  assert.match(detailsSource, /onClick=\{\(\) => onSearchTags\?\.\(selectedTags\)\}/);
  assert.match(detailsSource, /text\.searchSelectedTags/);
  assert.match(appSource, /const searchByDetailTags = React\.useCallback\(\(tags: string\[\]\) =>/);
  assert.match(appSource, /const search = encodeDetailTagSearch\(tags\);/);
  assert.match(appSource, /homeCoordinator\.updateFilter\(\{ search \}\)/);
  assert.match(querySource, /parseDetailTagSearch\(search\)/);
  assert.match(querySource, /params\.community_tag_filter = '1';/);
  assert.match(zhTextSource, /searchSelectedTags: '搜索所选标签'/);
  assert.match(enTextSource, /searchSelectedTags: 'Search selected tags'/);
});

test('classic detail keeps the selected-tag search row visible while only the tag chips scroll', () => {
  assert.match(detailsSource, /keepSearchActionVisible\?: boolean/);
  assert.match(detailsSource, /keepSearchActionVisible && 'max-h-40 min-h-0 grid-rows-\[minmax\(0,1fr\)_auto\]'/);
  assert.match(detailsSource, /keepSearchActionVisible && 'min-h-0 overflow-y-auto overscroll-contain [^']*scrollbar-thin'/);
  assert.match(detailsSource, /<DetailTagPicker[\s\S]*?onSearchTags=\{onSearchTags\}[\s\S]*?keepSearchActionVisible/);
  assert.doesNotMatch(detailsSource, /min-h-14 max-h-24 overflow-y-auto py-1 scrollbar-thin/);
});

test('classic tag scroller reserves inset space for selected, hovered, and focused chip edges', () => {
  assert.match(stylesSource, /\.details-metadata-tag:hover,[\s\S]*?transform:\s*translateY\(-1px\);/);
  assert.match(stylesSource, /\.details-metadata-tag:focus-visible\s*\{[\s\S]*?outline-offset:\s*2px;/);
  assert.match(detailsSource, /keepSearchActionVisible && 'min-h-0 overflow-y-auto overscroll-contain p-1 scrollbar-thin'/);
});

test('detail tag hover and selection colors transition instead of switching instantly', () => {
  assert.match(stylesSource, /\.details-metadata-tag\s*\{[\s\S]*transition:\s*background-color 240ms cubic-bezier\(0\.22, 1, 0\.36, 1\), color 240ms cubic-bezier\(0\.22, 1, 0\.36, 1\), border-color 240ms cubic-bezier\(0\.22, 1, 0\.36, 1\), box-shadow 240ms cubic-bezier\(0\.22, 1, 0\.36, 1\), transform 240ms cubic-bezier\(0\.22, 1, 0\.36, 1\);/);
  assert.match(stylesSource, /\.details-metadata-tag\[aria-pressed=['"]true['"]\]/);
});

test('redesigned details keep the left cover and information cards fixed while description scrolls inside the aligned right panel', () => {
  assert.match(detailsSource, /aspect-\[16\/9\]/);
  assert.match(detailsSource, /focused \? 'h-16 rounded-lg border border-border\/70 bg-background\/35 p-2\.5 sm:p-3'/);
  assert.match(presentationSource, /rightColumn: Object\.freeze\(\{\s*minHeight: 0,\s*\}\)/);
  assert.doesNotMatch(presentationSource, /rightColumn: Object\.freeze\(\{[\s\S]*height: '100%'/);
  assert.match(detailsSource, /overflow-y-auto overscroll-contain/);
  assert.doesNotMatch(detailsSource, /lg:h-full max-h-64/);
});
