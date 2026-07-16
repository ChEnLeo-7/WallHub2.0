'use strict';

function isCompleteCustomAccentColor(value) {
  return /^#[0-9a-f]{6}$/i.test(String(value || '').trim());
}

module.exports = { isCompleteCustomAccentColor };
