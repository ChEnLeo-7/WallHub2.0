'use strict';

function scheduleIdleTask(task, environment = globalThis) {
  let cancelled = false;
  const run = () => { if (!cancelled) task(); };
  if (typeof environment.requestIdleCallback === 'function') {
    const id = environment.requestIdleCallback(run, { timeout: 750 });
    return () => {
      cancelled = true;
      if (typeof environment.cancelIdleCallback === 'function') environment.cancelIdleCallback(id);
    };
  }
  const id = environment.setTimeout(run, 48);
  return () => {
    cancelled = true;
    if (typeof environment.clearTimeout === 'function') environment.clearTimeout(id);
  };
}

module.exports = { scheduleIdleTask };
