'use strict';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function send(res, code, body, contentType) {
  cors(res);
  res.writeHead(code, { 'Content-Type': contentType || 'text/plain; charset=utf-8' });
  res.end(body);
}

function jsonRes(res, code, obj) {
  send(res, code, JSON.stringify(obj), 'application/json; charset=utf-8');
}

// Default body limit for JSON-ish endpoints (1 MiB). Callers that accept
// larger payloads (e.g. prepared downloads) should use readBodyBuffer.
const DEFAULT_READ_BODY_LIMIT = 1 * 1024 * 1024;

function readBody(req, limitBytes = DEFAULT_READ_BODY_LIMIT) {
  return new Promise((resolve, reject) => {
    let body = '';
    let total = 0;
    let aborted = false;
    req.on('data', chunk => {
      if (aborted) return;
      const piece = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      total += Buffer.byteLength(piece, 'utf8');
      if (total > limitBytes) {
        aborted = true;
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        try { req.destroy(); } catch {}
        return;
      }
      body += piece;
    });
    req.on('end', () => { if (!aborted) resolve(body); });
    req.on('error', err => { if (!aborted) reject(err); });
  });
}

function readBodyBuffer(req, limitBytes = 16 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', (chunk) => {
      const buf = Buffer.from(chunk);
      total += buf.length;
      if (total > limitBytes) {
        reject(Object.assign(new Error('Request body too large'), { statusCode: 413 }));
        req.destroy();
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks, total)));
    req.on('error', reject);
  });
}

module.exports = {
  cors,
  send,
  jsonRes,
  readBody,
  readBodyBuffer,
};
