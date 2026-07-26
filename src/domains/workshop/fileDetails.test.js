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
