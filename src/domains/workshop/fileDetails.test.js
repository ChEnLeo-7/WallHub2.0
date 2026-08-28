'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createPublishedFileDetailsService } = require('./fileDetails');

test('published file details requests remain keyless', async () => {
  let postedBody = '';
  const service = createPublishedFileDetailsService({
    logger: { log() {}, warn() {} },
    post: async (_url, body) => {
      postedBody = body;
      return Buffer.from(JSON.stringify({
        response: {
          publishedfiledetails: [{ result: 1, publishedfileid: '123', title: 'Item 123' }],
        },
      }));
    },
  });

  const details = await service.get(['123']);

  assert.equal(details.length, 1);
  assert.doesNotMatch(postedBody, /(?:^|&)key=/);
  assert.match(postedBody, /publishedfileids%5B0%5D=123/);
});

test('safe details retry requests only ids missing from a partial response', async () => {
  const postedBodies = [];
  const service = createPublishedFileDetailsService({
    logger: { log() {}, warn() {} },
    post: async (_url, body) => {
      postedBodies.push(body);
      const details = postedBodies.length === 1
        ? [{ result: 1, publishedfileid: '101', title: 'First' }]
        : [{ result: 1, publishedfileid: '102', title: 'Second' }];
      return Buffer.from(JSON.stringify({ response: { publishedfiledetails: details } }));
    },
  });

  const details = await service.getSafe(['101', '102']);

  assert.deepEqual(details.map(detail => detail.publishedfileid), ['101', '102']);
  assert.equal(postedBodies.length, 2);
  assert.match(postedBodies[0], /publishedfileids%5B0%5D=101/);
  assert.match(postedBodies[0], /publishedfileids%5B1%5D=102/);
  assert.doesNotMatch(postedBodies[1], /101/);
  assert.match(postedBodies[1], /publishedfileids%5B0%5D=102/);
});

test('safe details retry stops after two retries when ids remain missing', async () => {
  let calls = 0;
  const service = createPublishedFileDetailsService({
    logger: { log() {}, warn() {} },
    post: async () => {
      calls += 1;
      return Buffer.from(JSON.stringify({ response: { publishedfiledetails: [] } }));
    },
  });

  const details = await service.getSafe(['201']);

  assert.deepEqual(details, []);
  assert.equal(calls, 3);
});
