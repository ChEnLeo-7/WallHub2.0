'use strict';

function createGatewayRequests(options = {}) {
  const forwarder = options.forwarder;

  async function request(opts, body, timeout) {
    return forwarder.request(opts, body, timeout);
  }

  async function requestStream(target, method, headers, body, timeout) {
    return forwarder.stream({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port ? parseInt(target.port, 10) : undefined,
      path: `${target.pathname || '/'}${target.search || ''}`,
      method: method || 'GET',
      headers: headers || {},
      timeout,
    }, body, timeout);
  }

  return { request, requestStream };
}

module.exports = { createGatewayRequests };
