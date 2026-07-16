'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createWorkshopSearchService } = require('./search');

function createNormalService() {
  return createWorkshopSearchService({
    getSteamApiKey: () => '',
    useSteamApi: () => false,
    useCommunityBrowseOrder: () => false,
    nsfwEnabled: () => true,
    logger: { log() {}, warn() {} },
    get: async () => Buffer.from([
      '<div id="workshopBrowseItems">',
      '<div class="workshopItem" data-publishedfileid="101">',
      '<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=101">',
      '<img class="workshopItemPreviewImage" src="https://img/101.jpg" alt="Item 101">',
      '<div class="workshopItemTitle">Item 101</div>',
      '</a></div></div>',
    ].join('')),
    getFileDetailsSafe: async (ids) => ids.map((id) => ({
      result: 1,
      publishedfileid: id,
      title: `Detail ${id}`,
      tags: [{ tag: 'Everyone' }, { tag: 'Video' }],
    })),
  });
}

test('disabled community order keeps type and rating selection out of the Community sequence path', async () => {
  const service = createNormalService();

  for (const params of [
    { query_type: 1, 'type_or[0]': 'Video', 'type_or[1]': 'Scene' },
    { query_type: 0, 'rating_or[0]': 'Everyone', 'rating_or[1]': 'Questionable' },
  ]) {
    const result = await service.search({ appid: 431960, page: 1, numperpage: 1, ...params });
    assert.notEqual(result.diagnostics?.pageLoadMode, 'community-sequence-page');
  }
});
