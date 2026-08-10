'use strict';

function pathnameFromRequest(req) {
  try { return new URL(req.url, 'http://x').pathname; } catch { return '/'; }
}

function queryFromRequest(req) {
  return new URL(req.url, 'http://x').searchParams;
}

function methodIs(req, method) {
  return req.method === method;
}

function methodIn(req, methods) {
  return methods.includes(req.method);
}

module.exports = {
  methodIn,
  methodIs,
  pathnameFromRequest,
  queryFromRequest,
};
