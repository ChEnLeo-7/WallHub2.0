'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  WALLHUB_STEAM_USER_FILES_MARKER,
  parseSteamKitUserFilesOutput,
  createSteamKitPersonalWorkshopService,
  normalizePersonalSortMethod,
} = require('./personalWorkshop');

test('personal Workshop sort methods are normalized before reaching SteamKit', () => {
  assert.equal(normalizePersonalSortMethod(' CreationOrder '), 'creationorder');
  assert.equal(normalizePersonalSortMethod('unsupported'), 'lastupdated');
});

test('SteamKit user files parser accepts the final marked JSON response only', () => {
  const parsed = parseSteamKitUserFilesOutput([
    'Connecting to Steam3...',
    `${WALLHUB_STEAM_USER_FILES_MARKER}{"steamid":"76561198000000001","total":4,"ids":["100000","100001","100001","bad"],"publishedfiledetails":[{"result":1,"publishedfileid":"100000","title":"One"}]}`,
  ].join('\n'));

  assert.deepEqual(parsed, {
    steamId: '76561198000000001',
    totalCount: 4,
    ids: ['100000', '100001'],
    details: [{ result: 1, publishedfileid: '100000', title: 'One' }],
  });
});

test('SteamKit user files command uses remembered login without a Community web session', async () => {
  const calls = [];
  const service = createSteamKitPersonalWorkshopService({
    ensureDepotDownloaderReady: async () => 'DepotDownloader.exe',
    depotCommandFor: () => ({ command: 'DepotDownloader.exe', argsPrefix: [] }),
    runProcess: async (command, args, timeoutMs, options) => {
      calls.push({ command, args, timeoutMs, options });
      return { out: `${WALLHUB_STEAM_USER_FILES_MARKER}{"steamid":"76561198000000001","total":2,"ids":["100000","100001"]}`, err: '' };
    },
    buildDepotDotnetEnv: () => ({ DOTNET_CLI_HOME: 'test-home' }),
    makeDepotLoginId: seed => `login-${seed}`,
    ensureDir() {},
    configDir: 'account',
    logger: { log() {} },
  });

  const result = await service.getUserFiles('mysubscriptions', {
    username: 'tester',
    page: 2,
    numperpage: 50,
    sortmethod: 'subscriptiondate',
  });

  assert.deepEqual(result.ids, ['100000', '100001']);
  assert.equal(result.totalCount, 2);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, [
    '-wallhub-user-files', 'mysubscriptions',
    '-app', '431960',
    '-wallhub-user-files-page', '2',
    '-wallhub-user-files-count', '50',
    '-wallhub-user-files-sort', 'subscriptiondate',
    '-username', 'tester',
    '-remember-password',
    '-max-downloads', '1',
    '-loginid', 'login-user-files:tester:mysubscriptions',
  ]);
  assert.equal(calls[0].args.includes('-wallhub-web-session'), false);
  assert.equal(calls[0].options.cwd, 'account');
  assert.equal(calls[0].options.steamAuth, true);
});

test('SteamKit Workshop query uses the persistent CM bridge without one-shot fallback', async () => {
  let queryPayload;
  const service = createSteamKitPersonalWorkshopService({
    queryBridge: {
      queryWorkshop: async (query) => {
        queryPayload = query;
        return { total: 1, publishedfiledetails: [{ result: 1, publishedfileid: '100000', title: 'CM item' }] };
      },
    },
  });

  const result = await service.queryWorkshop({ operation: 'query-files', appid: 431960 }, { username: 'tester' });
  assert.equal(queryPayload.operation, 'query-files');
  assert.deepEqual(result.ids, ['100000']);
  assert.equal(result.details[0].title, 'CM item');
});
