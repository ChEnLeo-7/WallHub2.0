'use strict';

function normalizeMpkgId(value) {
  return String(value || '').replace(/[^\d]/g, '');
}

function normalizeMpkgTextureProfile(value) {
  return String(value || '').trim().toLowerCase() === 'compact' ? 'compact' : 'fast';
}

module.exports = {
  normalizeMpkgId,
  normalizeMpkgTextureProfile,
};
