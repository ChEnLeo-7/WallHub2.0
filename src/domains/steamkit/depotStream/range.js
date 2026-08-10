'use strict';

function parseSingleHttpByteRange(rangeHeader, total) {
  const header = String(rangeHeader || '').trim();
  if (!header) return null;
  const match = /^bytes=(\d*)-(\d*)$/i.exec(header);
  if (!match || (!match[1] && !match[2])) return { error: 'Invalid Range' };

  let start = 0;
  let end = total - 1;
  if (!match[1]) {
    const suffixLength = parseInt(match[2], 10);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return { error: 'Range Not Satisfiable' };
    start = suffixLength >= total ? 0 : total - suffixLength;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] ? parseInt(match[2], 10) : total - 1;
    if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
      return { error: 'Range Not Satisfiable' };
    }
    end = Math.min(end, total - 1);
  }
  return { start, end };
}

function createDepotStreamRangeTools(options) {
  const {
    maxRangeBytes: configuredMaxRangeBytes,
    firstRangeBytes: configuredFirstRangeBytes,
  } = options;

  function maxRangeBytes() {
    return Math.max(1, parseInt(String(configuredMaxRangeBytes || 1), 10) || 1);
  }

  function firstRangeBytes(maxBytes) {
    return Math.max(1, parseInt(String(configuredFirstRangeBytes || maxBytes), 10) || maxBytes);
  }

  function normalizeRange(req, total) {
    const header = String(req.headers.range || '').trim();
    const maxBytes = maxRangeBytes();
    const firstBytes = firstRangeBytes(maxBytes);
    if (!header) {
      return {
        start: 0,
        end: Math.min(total - 1, Math.min(firstBytes, maxBytes) - 1),
        statusCode: 206,
        rangeHeader: '',
      };
    }
    const parsed = parseSingleHttpByteRange(header, total);
    if (!parsed || parsed.error) return parsed;
    let { start, end } = parsed;
    const limit = start === 0 && /^bytes=\d+-$/i.test(header)
      ? Math.min(firstBytes, maxBytes)
      : maxBytes;
    if (end - start + 1 > limit) {
      if (/^bytes=-\d+$/i.test(header)) start = Math.max(0, end - limit + 1);
      else end = Math.min(total - 1, start + limit - 1);
    }
    return { start, end, statusCode: 206, rangeHeader: header };
  }

  function planDepotStreamBlocks(total, start, end, requestedBlockSize = configuredFirstRangeBytes) {
    const safeTotal = parseInt(String(total || 0), 10);
    const safeStart = parseInt(String(start || 0), 10);
    const safeEnd = parseInt(String(end || 0), 10);
    const maxBytes = maxRangeBytes();
    const blockSize = Math.max(1, Math.min(
      maxBytes,
      parseInt(String(requestedBlockSize || configuredFirstRangeBytes || maxBytes), 10) || maxBytes
    ));
    if (!Number.isFinite(safeTotal) || safeTotal <= 0 || !Number.isFinite(safeStart) ||
        !Number.isFinite(safeEnd) || safeStart < 0 || safeStart > safeEnd || safeStart >= safeTotal) {
      return [];
    }
    const last = Math.min(safeTotal - 1, safeEnd);
    const blocks = [];
    for (let blockStart = Math.floor(safeStart / blockSize) * blockSize; blockStart <= last; blockStart += blockSize) {
      const blockEnd = Math.min(safeTotal - 1, blockStart + blockSize - 1);
      blocks.push({
        start: blockStart,
        end: blockEnd,
        responseStart: Math.max(safeStart, blockStart),
        responseEnd: Math.min(last, blockEnd),
        index: blocks.length,
      });
    }
    return blocks;
  }

  function clampDepotStreamRange(total, start, length) {
    const safeTotal = parseInt(String(total || 0), 10);
    if (!Number.isFinite(safeTotal) || safeTotal <= 0) return null;
    const safeStart = Math.max(0, Math.min(safeTotal - 1, parseInt(String(start || 0), 10) || 0));
    const safeLength = Math.max(1, parseInt(String(length || 0), 10) || configuredMaxRangeBytes);
    return { start: safeStart, end: Math.min(safeTotal - 1, safeStart + safeLength - 1) };
  }

  return { normalizeRange, planDepotStreamBlocks, clampDepotStreamRange };
}

module.exports = { parseSingleHttpByteRange, createDepotStreamRangeTools };
