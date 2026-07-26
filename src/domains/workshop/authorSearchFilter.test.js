'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkshopSearchService } = require('./search');

const TARGET_AUTHOR = '76561198109148999';
const OTHER_AUTHOR = '76561198109148998';

function authorBrowseHtml() {
  return `
    <div id="workshopBrowseItems">
      <div class="workshopItem" data-publishedfileid="1001"><div class="workshopItemTitle">目标作者作品</div></div>
      <div class="workshopItem" data-publishedfileid="1002"><div class="workshopItemTitle">错误混入作品</div></div>
    </div>
  `;
}

function authorBrowseHtmlWithTotal() {
  return `
    <div class="workshopBrowsePagingInfo">正在显示第 1 - 30 项，共 358 项条目</div>
    <div id="workshopBrowseItems">
      <div class="workshopItem" data-publishedfileid="1001"><div class="workshopItemTitle">目标作者作品</div></div>
    </div>
  `;
}

function pagedAuthorBrowseHtml(page, total = 120) {
  const first = (page - 1) * 30 + 1;
  const last = Math.min(first + 29, total);
  const items = [];
  for (let id = first; id <= last; id += 1) {
    items.push(`<div class="workshopItem" data-publishedfileid="${id}"><div class="workshopItemTitle">作者作品 ${id}</div></div>`);
  }
  return `
    <div class="workshopBrowsePagingInfo">正在显示第 ${first} - ${last} 项，共 ${total} 项条目</div>
    <div id="workshopBrowseItems">${items.join('')}</div>
  `;
}

test('author search applies a final strict creator filter when an upstream list includes a mismatched wallpaper', async () => {
  const service = createWorkshopSearchService({
    get: async (url) => {
      assert.match(url, new RegExp(`/profiles/${TARGET_AUTHOR}/myworkshopfiles/`));
      return Buffer.from(authorBrowseHtml());
    },
    getFileDetailsSafe: async () => [
      { result: 1, publishedfileid: '1001', title: '目标作者作品', creator: TARGET_AUTHOR, tags: [] },
      { result: 1, publishedfileid: '1002', title: '错误混入作品', creator: OTHER_AUTHOR, tags: [] },
    ],
    logger: { log() {}, warn() {} },
  });

  const result = await service.search({
    appid: 431960,
    creator: TARGET_AUTHOR,
    page: 1,
    numperpage: 30,
    query_type: 1,
  });

  assert.deepEqual(
    result.response.publishedfiledetails.map((item) => [String(item.publishedfileid), String(item.creator)]),
    [['1001', TARGET_AUTHOR]],
  );
});

test('Community author search also removes a mismatched enriched wallpaper', async () => {
  const service = createWorkshopSearchService({
    get: async () => Buffer.from(authorBrowseHtml()),
    getFileDetailsSafe: async () => [
      { result: 1, publishedfileid: '1001', title: '目标作者作品', creator: TARGET_AUTHOR, tags: [] },
      { result: 1, publishedfileid: '1002', title: '错误混入作品', creator: OTHER_AUTHOR, tags: [] },
    ],
    logger: { log() {}, warn() {} },
  });

  const result = await service.search({
    appid: 431960,
    creator: TARGET_AUTHOR,
    page: 1,
    numperpage: 30,
    query_type: 1,
  });

  assert.deepEqual(
    result.response.publishedfiledetails.map((item) => [String(item.publishedfileid), String(item.creator)]),
    [['1001', TARGET_AUTHOR]],
  );
});

test('author search uses the Community profile total even when a Web API key is configured', async () => {
  const requests = [];
  const service = createWorkshopSearchService({
    getSteamApiKey: () => 'test-key',
    get: async (url) => {
      requests.push(url);
      return Buffer.from(authorBrowseHtmlWithTotal());
    },
    getFileDetailsSafe: async () => [
      { result: 1, publishedfileid: '1001', title: '目标作者作品', creator: TARGET_AUTHOR, tags: [] },
    ],
    logger: { log() {}, warn() {} },
  });

  const result = await service.search({
    appid: 431960,
    creator: TARGET_AUTHOR,
    page: 1,
    numperpage: 30,
    query_type: 1,
  });

  assert.equal(requests.length, 1);
  const requested = new URL(requests[0]);
  assert.equal(requested.host, 'steamcommunity.com');
  assert.equal(requested.pathname, `/profiles/${TARGET_AUTHOR}/myworkshopfiles/`);
  assert.equal(result.response.total, 358);
  assert.equal(result.totalPages, 12);
  assert.equal(result.source, 'community-author');
  assert.deepEqual(result.response.publishedfiledetails.map((item) => String(item.publishedfileid)), ['1001']);
});

test('author search fills and slices results using the configured WallHub page size', async () => {
  const requests = [];
  const service = createWorkshopSearchService({
    get: async (url) => {
      const requested = new URL(url);
      requests.push(requested);
      assert.equal(requested.searchParams.get('numperpage'), '30');
      return Buffer.from(pagedAuthorBrowseHtml(Number(requested.searchParams.get('p'))));
    },
    getFileDetailsSafe: async (ids) => ids.map((id) => ({
      result: 1,
      publishedfileid: id,
      title: `作者作品 ${id}`,
      creator: TARGET_AUTHOR,
      tags: [],
    })),
    logger: { log() {}, warn() {} },
  });

  const firstPage = await service.search({
    appid: 431960,
    creator: TARGET_AUTHOR,
    page: 1,
    numperpage: 50,
    query_type: 1,
  });
  const firstPageRequests = requests.map((requested) => requested.searchParams.get('p'));
  const secondPage = await service.search({
    appid: 431960,
    creator: TARGET_AUTHOR,
    page: 2,
    numperpage: 50,
    query_type: 1,
  });

  assert.equal(firstPage.response.publishedfiledetails.length, 50);
  assert.equal(secondPage.response.publishedfiledetails.length, 50);
  assert.equal(firstPage.response.publishedfiledetails[0].publishedfileid, '1');
  assert.equal(firstPage.response.publishedfiledetails.at(-1).publishedfileid, '50');
  assert.equal(secondPage.response.publishedfiledetails[0].publishedfileid, '51');
  assert.equal(secondPage.response.publishedfiledetails.at(-1).publishedfileid, '100');
  assert.equal(secondPage.totalPages, 3);
  assert.deepEqual(firstPageRequests, ['1', '2']);
  assert.deepEqual(requests.slice(firstPageRequests.length).map((requested) => requested.searchParams.get('p')), ['2', '3', '4']);
});
