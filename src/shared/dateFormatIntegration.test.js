'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const projectRoot = path.resolve(__dirname, '../..');
const utilsSource = fs.readFileSync(path.join(projectRoot, 'frontend/src/lib/utils.ts'), 'utf8');
const workshopSource = fs.readFileSync(path.join(projectRoot, 'frontend/src/lib/workshop.ts'), 'utf8');
const detailsSource = fs.readFileSync(path.join(projectRoot, 'frontend/src/components/dialogs/DetailsDialog.tsx'), 'utf8');

test('frontend date formatters delegate to current-year-aware date-time and date-only helpers', () => {
  assert.match(utilsSource, /import \{ formatLocalizedDate, formatLocalizedDateTime, shouldCompactDateOnlyText \} from '\.\/dateDisplay\.mjs';/);
  assert.match(utilsSource, /export function formatDate\(ts: unknown\) \{\s*return formatLocalizedDateTime\(ts\);\s*\}/);
  assert.match(utilsSource, /export function formatDateOnly\(ts: unknown\) \{\s*return formatLocalizedDate\(ts\);\s*\}/);
});

test('comment formatting delegates to the shared current-year-aware helper', () => {
  assert.match(workshopSource, /return formatLocalizedCommentTime\(comment, now\);/);
});

test('last-updated facts use the normal peer value size and compact only when the year makes the date long', () => {
  assert.match(detailsSource, /formatDateOnlyText,[\s\S]*?shouldCompactDateOnlyText,/);
  assert.match(detailsSource, /const lastUpdatedText = formatDateOnlyText\(merged\.time_updated \|\| item\?\.time_updated, text\);/);
  assert.match(detailsSource, /const compactLastUpdatedText = shouldCompactDateOnlyText\(lastUpdatedText\);/);
  assert.equal((detailsSource.match(/label=\{text\.lastUpdated\}[\s\S]*?value=\{lastUpdatedText\}[\s\S]*?allowFullValue[\s\S]*?compactFullValue=\{compactLastUpdatedText\}/g) || []).length, 2);
  assert.equal((detailsSource.match(/compactFullValue \? 'whitespace-nowrap text-\[11px\] sm:text-xs' : 'whitespace-nowrap text-xs sm:text-sm'/g) || []).length, 2);
});
