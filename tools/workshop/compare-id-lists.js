'use strict';

const fs = require('fs');

function readIds(file) {
  return fs.readFileSync(file, 'utf8')
    .split(/[^0-9]+/)
    .filter(value => /^\d{6,}$/.test(value));
}

function usage() {
  console.log('Usage: node tools/workshop/compare-id-lists.js <wallpaper-ids.txt> <wallhub-ids.txt> [limit]');
}

const expectedFile = process.argv[2];
const actualFile = process.argv[3];
const limit = Math.max(1, parseInt(process.argv[4], 10) || 50);

if (!expectedFile || !actualFile) {
  usage();
  process.exit(1);
}

const expected = readIds(expectedFile).slice(0, limit);
const actual = readIds(actualFile).slice(0, limit);
const actualSet = new Set(actual);
const expectedIndex = new Map(expected.map((id, index) => [id, index]));
const hits = expected.filter(id => actualSet.has(id));
const missing = expected.filter(id => !actualSet.has(id));
const extra = actual.filter(id => !expectedIndex.has(id));
const orderDeltas = hits.map(id => Math.abs(expectedIndex.get(id) - actual.indexOf(id)));
const avgOrderDelta = orderDeltas.length
  ? orderDeltas.reduce((sum, value) => sum + value, 0) / orderDeltas.length
  : 0;

console.log(JSON.stringify({
  limit,
  expectedCount: expected.length,
  actualCount: actual.length,
  hitCount: hits.length,
  hitRate: expected.length ? Number((hits.length / expected.length).toFixed(4)) : 0,
  avgOrderDelta: Number(avgOrderDelta.toFixed(2)),
  missing,
  extra,
}, null, 2));
