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
    getSteamApiKey: () => '',
    useSteamApi: () => false,
    useCommunityBrowseOrder: () => false,
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

test('community ordered author search also removes a mismatched enriched wallpaper', async () => {
  const service = createWorkshopSearchService({
    get: async () => Buffer.from(authorBrowseHtml()),
    getFileDetailsSafe: async () => [
      { result: 1, publishedfileid: '1001', title: '目标作者作品', creator: TARGET_AUTHOR, tags: [] },
      { result: 1, publishedfileid: '1002', title: '错误混入作品', creator: OTHER_AUTHOR, tags: [] },
    ],
    getSteamApiKey: () => '',
    useSteamApi: () => false,
    useCommunityBrowseOrder: () => true,
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
