'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const assert = require('node:assert/strict');

const { createDownloadFileSender } = require('./fileSender');

test('MPKG file sender reports headers, stream open, and successful completion through its debug hook', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-mpkg-send-'));
  try {
    const filePath = path.join(root, '123.mpkg');
    fs.writeFileSync(filePath, 'mpkg-body');

    const logs = [];
    const received = [];
    const res = new PassThrough();
    const headers = [];
    res.writeHead = (status, values) => headers.push({ status, values });
    res.on('data', chunk => received.push(Buffer.from(chunk)));
    const finished = once(res, 'finish');
    const ended = once(res, 'end');

    const sendDownloadFile = createDownloadFileSender({ fs });
    sendDownloadFile({ headers: {} }, res, filePath, '123.mpkg', {
      onDebug: message => logs.push(String(message)),
    });

    await Promise.all([finished, ended]);
    assert.equal(headers[0].status, 200);
    assert.equal(headers[0].values['Content-Length'], Buffer.byteLength('mpkg-body'));
    assert.equal(Buffer.concat(received).toString('utf8'), 'mpkg-body');
    assert.ok(logs.some(line => line.includes('response headers filename=123.mpkg bytes=9')));
    assert.ok(logs.some(line => line.includes('stream opened filename=123.mpkg')));
    assert.ok(logs.some(line => line.includes('stream completed filename=123.mpkg bytes=9')));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
