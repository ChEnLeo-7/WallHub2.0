'use strict';

function truncateClientEventValue(value, max = 160) {
  return String(value || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, max);
}

function shouldLogClientEvent(eventName, experimental = {}, debugEnabled = false) {
  const logLevel = String(experimental.logLevel || '').trim().toLowerCase();
  return !!debugEnabled || logLevel === 'debug' || !!experimental.verboseNetworkLogs || eventName === 'download-click';
}

module.exports = {
  truncateClientEventValue,
  shouldLogClientEvent,
};
