'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseWorkshopBrowseHtml } = require('./parse');

test('Community browse parser preserves unique Workshop cards in DOM order', () => {
  const html = [
    '<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=999">outside</a>',
    '<div class="workshopBrowsePagingInfo">Showing 31-33 of 73</div>',
    '<div id="workshopBrowseItems">',
    '<div class="workshopItem"><a href="https://steamcommunity.com/sharedfiles/filedetails/?id=303"><img class="workshopItemPreviewImage" src="https://img/303.jpg"><div class="workshopItemTitle">First</div></a></div>',
    '<div class="workshopItem" data-publishedfileid="101"><img class="workshopItemPreviewImage" src="https://img/101.jpg"><div class="workshopItemTitle">Second</div></div>',
    '<div class="workshopItem" data-publishedfileid="303"><div class="workshopItemTitle">Duplicate</div></div>',
    '</div>',
    '<div id="workshopBrowsePaging"><a href="?p=3">3</a></div>',
  ].join('');

  const result = parseWorkshopBrowseHtml(html);

  assert.deepEqual(result.ids, ['303', '101']);
  assert.equal(result.totalCount, 73);
  assert.equal(result.totalPages, 3);
  assert.equal(result.hints['303'].title, 'First');
  assert.equal(result.hints['303'].preview_url, 'https://img/303.jpg');
  assert.equal(Object.hasOwn(result.hints, '999'), false);
});

test('Community browse parser reads authoritative totals from the current Steam SSR payload', () => {
  const html = [
    '<div class="workshopItem" data-publishedfileid="123456"></div>',
    '<script>window.__SSR__="{\\\"eresult\\\":1,\\\"current_page\\\":1,\\\"total_pages\\\":1000,\\\"total_count\\\":2597084,\\\"results\\\":[]}";</script>',
  ].join('');

  const result = parseWorkshopBrowseHtml(html);

  assert.equal(result.totalCount, 2597084);
  assert.equal(result.totalPages, 1000);
  assert.equal(result.totalPagesExact, true);
});

test('Community browse parser merges mixed card markers and removes duplicate ids', () => {
  const html = [
    '<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=999">outside</a>',
    '<div id="workshopBrowseItems">',
    '<div class="workshopItem" data-publishedfileid="100"><div class="workshopItemTitle">Legacy</div></div>',
    '<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=102">New link card</a>',
    '<div class="new-card" data-publishedfileid="101"></div>',
    '<script>window.__DATA__="sharedfiles\\/filedetails\\/?id=103";</script>',
    '<a href="https://steamcommunity.com/sharedfiles/filedetails/?id=100">Duplicate legacy id</a>',
    '</div>',
    '<div id="workshopBrowsePaging"><a href="?p=2">2</a></div>',
  ].join('');

  const result = parseWorkshopBrowseHtml(html);

  assert.deepEqual(result.ids, ['100', '102', '101', '103']);
  assert.equal(result.hints['100'].title, 'Legacy');
  assert.equal(Object.hasOwn(result.hints, '999'), false);
});

test('Community browse parser uses authoritative SSR results and ignores Workshop links inside descriptions', () => {
  const browseData = {
    current_page: 1,
    total_pages: 1000,
    total_count: 2600000,
    results: [
      {
        publishedfileid: '101',
        creator: '76561198000000001',
        title: 'First result',
        preview_url: 'https://images.example/101.jpg',
        short_description: 'Inspired by https://steamcommunity.com/sharedfiles/filedetails/?id=999',
      },
      {
        publishedfileid: '102',
        creator: '76561198000000002',
        title: 'Second result',
        preview_url: 'https://images.example/102.jpg',
      },
    ],
  };
  const queryData = JSON.stringify({
    queries: [{
      queryKey: ['workshop_browse', { appid: 431960 }, 1],
      state: { data: browseData },
    }],
  });
  const renderContext = JSON.stringify({ queryData });
  const html = `<script>window.SSR.renderContext=JSON.parse(${JSON.stringify(renderContext)});</script>`;

  const result = parseWorkshopBrowseHtml(html);

  assert.deepEqual(result.ids, ['101', '102']);
  assert.equal(result.totalCount, 2600000);
  assert.equal(result.totalPages, 1000);
  assert.equal(result.totalPagesExact, true);
  assert.equal(result.hints['101'].title, 'First result');
  assert.equal(result.hints['101'].creator, '76561198000000001');
  assert.equal(Object.hasOwn(result.hints, '999'), false);
});
