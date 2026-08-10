'use strict';

const { URL } = require('url');
const { buildUrlFromOpts } = require('./shared');

const MAX_REDIRECTS = 3;

function createRedirectError(location) {
  return Object.assign(new Error('HTTP redirect'), { redirectLocation: location });
}

function getRedirectLocation(error) {
  return error && error.redirectLocation ? error.redirectLocation : '';
}

function createRedirectOptions(opts, location, timeout) {
  const target = new URL(location, buildUrlFromOpts(opts));
  return {
    protocol: target.protocol,
    hostname: target.hostname,
    port: target.port ? parseInt(target.port, 10) : undefined,
    path: target.pathname + target.search,
    method: 'GET',
    headers: opts.headers,
    timeout,
    signal: opts.signal,
    routeOptions: opts.routeOptions,
    disableCurlProxy: opts.disableCurlProxy,
    disableSteamAccessGateway: opts.disableSteamAccessGateway,
  };
}

function followRedirect(doRequest, opts, location, timeout, redirectCount) {
  if (redirectCount >= MAX_REDIRECTS) throw new Error('Too many redirects');
  return doRequest(createRedirectOptions(opts, location, timeout), null, redirectCount + 1, 0);
}

module.exports = {
  MAX_REDIRECTS,
  createRedirectError,
  getRedirectLocation,
  createRedirectOptions,
  followRedirect,
};
