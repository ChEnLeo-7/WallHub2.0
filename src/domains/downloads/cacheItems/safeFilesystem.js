'use strict';

const fs = require('fs');
const path = require('path');

function createSafeFilesystem({ logger = console } = {}) {
  function removePathWithRetry(target) {
    if (!target || !fs.existsSync(target)) return;
    const resolved = path.resolve(target);
    const remove = () => {
      if (!fs.existsSync(resolved)) return;
      const stat = fs.statSync(resolved);
      if (stat.isDirectory()) {
        fs.rmSync(resolved, { recursive: true, force: true, maxRetries: 1, retryDelay: 80 });
      } else {
        fs.rmSync(resolved, { force: true, maxRetries: 1, retryDelay: 80 });
      }
    };
    try {
      remove();
    } catch (error) {
      logger.warn('[Cleanup] Immediate cleanup failed:', error.message);
    }
    if (!fs.existsSync(resolved)) return;
    const delays = [500, 1500, 3500, 7000, 15000, 30000];
    delays.forEach((delay) => {
      setTimeout(() => {
        try { remove(); }
        catch (error) { logger.warn(`[Cleanup] Delayed cleanup failed after ${delay}ms:`, error.message); }
      }, delay).unref?.();
    });
  }

  function quarantinePathForBackgroundDelete(target, label = 'delete') {
    if (!target || !fs.existsSync(target)) return true;
    const resolved = path.resolve(target);
    const parent = path.dirname(resolved);
    const base = path.basename(resolved);
    const hiddenName = `.wallhub-deleting-${base}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const hidden = path.join(parent, hiddenName);
    try {
      fs.renameSync(resolved, hidden);
      logger.log(`[Cleanup] Moved ${label} to background cleanup: ${hidden}`);
      removePathWithRetry(hidden);
      return true;
    } catch (error) {
      logger.warn(`[Cleanup] Failed to quarantine ${label}:`, error.message);
      removePathWithRetry(resolved);
      return !fs.existsSync(resolved);
    }
  }

  function deletePathIfInside(target, allowedRoots) {
    if (!target) return;
    const resolved = path.resolve(target);
    const allowed = allowedRoots
      .map(root => path.resolve(root))
      .some(root => resolved === root || resolved.startsWith(root + path.sep));
    if (!allowed || !fs.existsSync(resolved)) return;
    removePathWithRetry(resolved);
  }

  return {
    removePathWithRetry,
    quarantinePathForBackgroundDelete,
    deletePathIfInside,
  };
}

module.exports = { createSafeFilesystem };
