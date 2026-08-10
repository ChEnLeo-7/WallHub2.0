'use strict';

const { URL } = require('url');

function createGet(doRequest, helpers) {
  return function get(url, extra, timeout) {
    const target = new URL(url);
    const extraHeaders = Object.assign({}, extra || {});
    const signal = extraHeaders.signal;
    delete extraHeaders.signal;
    const disableCurlProxy = !!extraHeaders.wallhubDisableCurlProxy;
    delete extraHeaders.wallhubDisableCurlProxy;
    const disableSteamAccessGateway = !!extraHeaders.wallhubDisableSteamAccessGateway;
    delete extraHeaders.wallhubDisableSteamAccessGateway;
    const routeOptions = extraHeaders.steamAccessRouteOptions;
    delete extraHeaders.steamAccessRouteOptions;
    const headers = Object.assign({
      'User-Agent': helpers.userAgent || 'WallHub',
      'Accept-Language': 'zh-CN,zh;q=0.9',
      'Accept-Encoding': 'identity',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    }, extraHeaders);
    const extraCookie = String(extraHeaders.Cookie || extraHeaders.cookie || '').trim();
    const baseCookie = String(helpers.steamPrefCookie || '').trim();
    delete headers.cookie;
    if (baseCookie || extraCookie) headers.Cookie = [baseCookie, extraCookie].filter(Boolean).join('; ');
    return doRequest({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port ? parseInt(target.port, 10) : undefined,
      path: target.pathname + target.search,
      method: 'GET',
      headers,
      timeout: timeout || 22000,
      signal,
      routeOptions,
      disableCurlProxy,
      disableSteamAccessGateway,
    });
  };
}

function createPost(doRequest, helpers) {
  return function post(url, body, timeout, extra = {}) {
    const target = new URL(url);
    const buf = Buffer.from(body, 'utf8');
    const extraHeaders = Object.assign({}, extra || {});
    const signal = extraHeaders.signal;
    delete extraHeaders.signal;
    const routeOptions = extraHeaders.steamAccessRouteOptions;
    delete extraHeaders.steamAccessRouteOptions;
    return doRequest({
      protocol: target.protocol,
      hostname: target.hostname,
      port: target.port ? parseInt(target.port, 10) : undefined,
      path: target.pathname + target.search,
      method: 'POST',
      headers: Object.assign({
        'User-Agent': helpers.userAgent || 'WallHub',
        'Accept-Encoding': 'identity',
        'Accept': 'application/json',
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': buf.length,
      }, extraHeaders),
      timeout: timeout || 22000,
      signal,
      routeOptions,
    }, buf);
  };
}

module.exports = {
  createGet,
  createPost,
};
