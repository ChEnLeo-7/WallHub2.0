'use strict';

function parsePositiveInt(raw, fallback) {
  const parsed = parseInt(String(raw || '').trim(), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

module.exports = {
  parsePositiveInt,
};
