'use strict';

const fs = require('fs');
const path = require('path');

function selectRangeCoverage(ranges, start, end) {
  const segments = [];
  const gaps = [];
  let cursor = start;
  while (cursor <= end) {
    let best = null;
    for (const range of ranges) {
      if (range.start > cursor) break;
      if (range.end < cursor) continue;
      if (!best || range.end > best.end) best = range;
    }
    if (best) {
      const segmentEnd = Math.min(end, best.end);
      segments.push({
        file: best.file,
        start: cursor,
        end: segmentEnd,
        offset: cursor - best.start,
        cachedStart: best.start,
        cachedEnd: best.end,
      });
      cursor = segmentEnd + 1;
      continue;
    }
    let nextStart = end + 1;
    for (const range of ranges) {
      if (range.start > cursor) {
        nextStart = Math.min(nextStart, range.start);
        break;
      }
    }
    const gapEnd = Math.min(end, nextStart - 1);
    gaps.push({ start: cursor, end: gapEnd });
    cursor = gapEnd + 1;
  }
  return { complete: gaps.length === 0, segments, gaps };
}

function createDepotStreamCacheFiles(cacheDir) {
  function depotStreamCacheDir(entry) {
    const id = String(entry.publishedFileId || entry.id || 'unknown').replace(/[^\w.-]/g, '_');
    const manifest = String(entry.manifestId || entry.hcontent || 'manifest').replace(/[^\w.-]/g, '_');
    return path.join(cacheDir, id, manifest);
  }

  function depotStreamCacheFile(entry, start, end) {
    return path.join(depotStreamCacheDir(entry), `${start}-${end}.bin`);
  }

  function listDepotStreamCacheRanges(entry) {
    const dir = depotStreamCacheDir(entry);
    let entries = [];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
    const ranges = [];
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const match = /^(\d+)-(\d+)\.bin$/.exec(entry.name);
      if (!match) continue;
      const cachedStart = parseInt(match[1], 10);
      const cachedEnd = parseInt(match[2], 10);
      if (!Number.isFinite(cachedStart) || !Number.isFinite(cachedEnd)) continue;
      const file = path.join(dir, entry.name);
      try {
        if (fs.statSync(file).size !== cachedEnd - cachedStart + 1) continue;
        ranges.push({ file, start: cachedStart, end: cachedEnd });
      } catch {}
    }
    ranges.sort((a, b) => a.start - b.start || b.end - a.end);
    return ranges;
  }

  function selectDepotStreamCoverage(entry, start, end) {
    return selectRangeCoverage(listDepotStreamCacheRanges(entry), start, end);
  }

  function findCachedRange(entry, start, end) {
    const coverage = selectDepotStreamCoverage(entry, start, end);
    if (!coverage.complete || coverage.segments.length !== 1) return null;
    const segment = coverage.segments[0];
    return { file: segment.file, offset: segment.offset };
  }

  return {
    depotStreamCacheFile,
    depotStreamCacheDir,
    listDepotStreamCacheRanges,
    selectDepotStreamCoverage,
    findCachedRange,
  };
}

module.exports = { selectRangeCoverage, createDepotStreamCacheFiles };
