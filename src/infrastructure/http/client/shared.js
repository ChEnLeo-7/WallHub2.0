'use strict';

function buildUrlFromOpts(opts) {
  const protocol = opts.protocol || 'https:';
  const port = opts.port ? `:${opts.port}` : '';
  return `${protocol}//${opts.hostname}${port}${opts.path || '/'}`;
}

function redactUrlPathForLog(pathname) {
  return String(pathname || '/').replace(/([?&]key=)[^&]*/ig, '$1<redacted>');
}

module.exports = {
  buildUrlFromOpts,
  redactUrlPathForLog,
};
