'use strict';

function createDepotStreamMetrics(options = {}) {
  const { logger = console } = options;
  let requestSequence = 0;

  function sessionId(entry) {
    if (!entry.depotPlaybackSessionId) {
      entry.depotPlaybackSessionId = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    }
    return entry.depotPlaybackSessionId;
  }

  function record(entry, event, fields = {}) {
    if (!entry) return null;
    const item = Object.assign({
      event,
      playbackSessionId: sessionId(entry),
      at: Date.now(),
    }, fields);
    if (!Array.isArray(entry.depotStreamMetrics)) entry.depotStreamMetrics = [];
    entry.depotStreamMetrics.push(item);
    if (entry.depotStreamMetrics.length > 200) entry.depotStreamMetrics.splice(0, entry.depotStreamMetrics.length - 200);
    logger.traceLog?.(`[Depot Stream Metrics] ${JSON.stringify(item)}`);
    return item;
  }

  function beginRequest(entry, fields = {}) {
    const requestId = `${Date.now().toString(36)}-${(++requestSequence).toString(36)}`;
    const startedAt = Date.now();
    record(entry, 'http_request', Object.assign({ requestId }, fields));
    return {
      requestId,
      startedAt,
      mark(event, values = {}) {
        return record(entry, event, Object.assign({
          requestId,
          elapsedMs: Date.now() - startedAt,
        }, values));
      },
    };
  }

  return { sessionId, record, beginRequest };
}

module.exports = { createDepotStreamMetrics };
