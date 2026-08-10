'use strict';

const { buildUrlFromOpts, redactUrlPathForLog } = require('./client/shared');
const {
  buildCurlRequestArgs,
  doRequestByCurl,
  isCurlTlsVerifyError,
  shouldRetryCurlInsecure,
  doRequestByCurlCascade,
} = require('./client/curlTransport');
const { createRequestDispatcher } = require('./client/requestPolicy');
const { createGet, createPost } = require('./client/requestOptions');

function createHttpClient(options = {}) {
  const helpers = Object.assign({ logger: console }, options);
  const doRequest = createRequestDispatcher(helpers);
  return {
    doRequest,
    get: createGet(doRequest, helpers),
    post: createPost(doRequest, helpers),
  };
}

module.exports = {
  buildUrlFromOpts,
  redactUrlPathForLog,
  buildCurlRequestArgs,
  doRequestByCurl,
  isCurlTlsVerifyError,
  shouldRetryCurlInsecure,
  doRequestByCurlCascade,
  createHttpClient,
};
