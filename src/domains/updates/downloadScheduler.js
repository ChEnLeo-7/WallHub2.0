'use strict';

const DEFAULT_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;

function createDownloadScheduler(options = {}) {
  let initialTimer = null;
  let intervalTimer = null;

  function schedule() {
    stopSchedule();
    initialTimer = setTimeout(options.runAutomatic, Number(options.initialDelayMs || 15000));
    initialTimer.unref?.();
    intervalTimer = setInterval(options.runAutomatic, Number(options.checkIntervalMs || DEFAULT_CHECK_INTERVAL_MS));
    intervalTimer.unref?.();
  }

  function scheduleSoon() {
    if (!options.getAutoUpdateEnabled()) return;
    if (initialTimer) clearTimeout(initialTimer);
    initialTimer = setTimeout(options.runAutomatic, 1000);
    initialTimer.unref?.();
  }

  function stopSchedule() {
    if (initialTimer) clearTimeout(initialTimer);
    if (intervalTimer) clearInterval(intervalTimer);
    initialTimer = null;
    intervalTimer = null;
  }

  return { schedule, scheduleSoon, stopSchedule };
}

module.exports = {
  DEFAULT_CHECK_INTERVAL_MS,
  createDownloadScheduler,
};
