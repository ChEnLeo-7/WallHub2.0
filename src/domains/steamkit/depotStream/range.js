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
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return { error: 'Range Not Satisfiable' };
    start = suffixLength >= total ? 0 : total - suffixLength;
  } else {
    start = parseInt(match[1], 10);
    end = match[2] ? parseInt(match[2], 10) : total - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= total) {
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
    if (!header) {
      return {
        start: 0,
        end: total - 1,
        statusCode: 200,
        rangeHeader: '',
      };
    }
    const parsed = parseSingleHttpByteRange(header, total);
    if (!parsed || parsed.error) return parsed;
    return { start: parsed.start, end: parsed.end, statusCode: 206, rangeHeader: header };
  }

  function planDepotStreamBlocks(total, start, end) {
    const safeTotal = parseInt(String(total || 0), 10);
    const safeStart = parseInt(String(start || 0), 10);
    const safeEnd = parseInt(String(end || 0), 10);
    const maxBytes = maxRangeBytes();
    if (!Number.isFinite(safeTotal) || safeTotal <= 0 || !Number.isFinite(safeStart) ||
        !Number.isFinite(safeEnd) || safeStart < 0 || safeStart > safeEnd || safeStart >= safeTotal) {
      return [];
    }
    const last = Math.min(safeTotal - 1, safeEnd);
    const firstBytes = Math.min(safeTotal, firstRangeBytes(maxBytes));
    const blocks = [];
    let blockStart = safeStart < firstBytes
      ? 0
      : safeStart < maxBytes
        ? firstBytes
        : Math.floor(safeStart / maxBytes) * maxBytes;
    while (blockStart <= last) {
      const blockEnd = Math.min(
        safeTotal - 1,
        blockStart === 0 ? firstBytes - 1 : blockStart < maxBytes ? maxBytes - 1 : blockStart + maxBytes - 1
      );
      blocks.push({
        start: blockStart,
        end: blockEnd,
        responseStart: Math.max(safeStart, blockStart),
        responseEnd: Math.min(last, blockEnd),
        index: blocks.length,
      });
      blockStart = blockEnd + 1;
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
