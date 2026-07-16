'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { ensureCSharpUsing } = require('../domains/steamkit/depotPatch/sourceEdits');
const { wallHubSteam3NetworkPatchSource } = require('../domains/steamkit/depotPatch/steam3NetworkPatch');
const { steamKitIdleTimeoutForStage } = require('../domains/steamkit/download/watchdog');
const { classifySteamKitControlPlaneOutput } = require('../domains/steamkit/download/controlPlane');
const { mapWorkshopItem } = require('../domains/workshop/search/itemMapping');

test('extracted depot source edit helper keeps existing using blocks and adds missing ones', () => {
  const source = 'using System;\n\nnamespace DepotDownloader\n{}\n';
  assert.equal(ensureCSharpUsing(source, 'System'), source);
  assert.match(ensureCSharpUsing(source, 'System.IO'), /using System\.IO;/);
});

test('extracted SteamKit watchdog preserves the content-stage timeout contract', () => {
  const env = {
    WALLHUB_DEPOT_IDLE_TIMEOUT: '60000',
    WALLHUB_DEPOT_CONTENT_IDLE_TIMEOUT: '300000',
  };
  assert.equal(steamKitIdleTimeoutForStage('content-download', false, env), 300000);
  assert.equal(steamKitIdleTimeoutForStage('login', false, env), 60000);
});

test('extracted workshop item mapper retains detail and browse hint fields', () => {
  const item = mapWorkshopItem('9', { result: 1, publishedfileid: '9', title: 'Detail', creator: '42', tags: [] }, { author: 'Hint' });
  assert.deepEqual(item, {
    publishedfileid: '9', title: 'Detail', preview_url: '', subscriptions: 0,
    lifetime_subscriptions: 0, views: 0, favorited: 0, lifetime_favorited: 0,
    file_size: 0, time_updated: 0, time_created: 0, short_description: '',
    tags: [], author: 'Hint', creator: '42',
  });
});
