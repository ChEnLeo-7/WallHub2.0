'use strict';

function createProbeQueue(options = {}) {
  const probe = options.probe;
  const routeStore = options.routeStore;
  const logger = options.logger || console;
  const queue = [];
  const queuedKeys = new Set();
  let running = false;

  function keyFor(task) {
    return `${task.host}|${task.ip}|${task.port || 443}|${task.level || 'stress'}`;
  }

  function enqueue(task) {
    if (!probe || !routeStore || !task || !task.host || !task.ip) return false;
    const key = keyFor(task);
    if (queuedKeys.has(key)) return false;
    queuedKeys.add(key);
    queue.push(Object.assign({ level: 'stress', port: 443 }, task));
    setTimeout(runNext, 1).unref?.();
    return true;
  }

  async function runNext() {
    if (running) return;
    running = true;
    while (queue.length) {
      const task = queue.shift();
      queuedKeys.delete(keyFor(task));
      try {
        const result = await probe.stressIp(task.host, task.ip, task.port || 443, task.sni, task.timeoutMs || 2500, { level: task.application ? 'application' : 'http' });
        if (result.ok) routeStore.feedbackSuccess(task.host, task.ip, { source: 'stress', rttMs: result.rttMs, probeLevel: 'stress' });
        else routeStore.feedbackFailure(task.host, task.ip, 'stress-probe-failed', { stage: 'stress', probeLevel: 'stress' });
      } catch (error) {
        routeStore.feedbackFailure(task.host, task.ip, error, { stage: 'stress', probeLevel: 'stress' });
        logger.warn?.(`[SteamAccess] stress probe failed ${task.host} ${task.ip}: ${error.message}`);
      }
    }
    running = false;
  }

  function snapshot() {
    return { pending: queue.length, running };
  }

  return { enqueue, snapshot };
}

module.exports = { createProbeQueue };
