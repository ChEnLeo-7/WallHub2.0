'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseFriendFavoriteNames, parseFriendFavoriteSteamIds, buildPersonalSourceLabel } = require('./personalSource');

test('parseFriendFavoriteNames extracts unique persona names from Steam friend favorite markup', () => {
  const html = [
    '<div class="friend_favorited_block"><a href="https://steamcommunity.com/profiles/76561198000000001" title="Alice"><img alt="Alice"></a></div>',
    '<div class="friend_favorited_block"><a href="https://steamcommunity.com/id/bob"><span class="friend_name">Bob</span></a></div>',
    '<div class="friend_favorited_block"><a href="https://steamcommunity.com/id/bob"><span>Bob</span></a></div>',
  ].join('');

  assert.deepEqual(parseFriendFavoriteNames(html), ['Alice', 'Bob']);
});

test('buildPersonalSourceLabel describes only personal filter provenance', () => {
  assert.equal(buildPersonalSourceLabel('mysubscriptions', {}), '个人订阅');
  assert.equal(buildPersonalSourceLabel('myfavorites', {}), '我的收藏');
  assert.equal(buildPersonalSourceLabel('voted', {}), '我的投票');
  assert.equal(buildPersonalSourceLabel('friendsfavorites', { names: ['Alice', 'Bob'] }), '好友 Alice、Bob 收藏');
  assert.equal(buildPersonalSourceLabel('friendscreated', { author: 'Alice' }), '好友 Alice 创建');
  assert.equal(buildPersonalSourceLabel('followedcreated', { author: 'Alice' }), '关注者 Alice 创建');
  assert.equal(buildPersonalSourceLabel('', { author: 'Alice' }), '');
});

test('parseFriendFavoriteSteamIds reads current Workshop queryAction response without private data', () => {
  const payload = JSON.stringify({
    response: [
      '76561198000000001',
      { steamid: '76561198000000002', private_data: { account_name: 'secret' } },
      '76561198000000001',
    ],
  });
  assert.deepEqual(parseFriendFavoriteSteamIds(payload), [
    '76561198000000001',
    '76561198000000002',
  ]);
});
