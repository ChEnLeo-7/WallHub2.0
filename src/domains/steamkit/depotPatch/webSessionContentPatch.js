'use strict';

const fs = require('fs');
const { replaceSourceOnce } = require('./sourceEdits');

function patchWebSessionContent(contentPath, content) {
  if (!content.includes('WallHubGetSteamSessionJson')) {
    content = replaceSourceOnce(
      content,
      [
        '        public static void ShutdownSteam3()',
        '        {',
        '            if (steam3 == null)',
        '                return;',
        '',
        '            steam3.Disconnect();',
        '        }'
      ].join('\n'),
      [
        '        public static void ShutdownSteam3()',
        '        {',
        '            if (steam3 == null)',
        '                return;',
        '',
        '            steam3.Disconnect();',
        '        }',
        '',
        '        public static string WallHubGetSteamSessionJson()',
        '        {',
        '            if (steam3 == null)',
        '            {',
        '                throw new InvalidOperationException("Steam3 session is not initialized.");',
        '            }',
        '',
        '            return steam3.WallHubGetSteamSessionJson();',
        '        }'
      ].join('\n'),
      'DepotDownloader ContentDownloader.cs session identity wrapper'
    );
    fs.writeFileSync(contentPath, content, 'utf8');
  }
  if (!content.includes('WallHubGetSteamWebSessionJsonAsync')) {
    content = replaceSourceOnce(
      content,
      [
        '        public static void ShutdownSteam3()',
        '        {',
        '            if (steam3 == null)',
        '                return;',
        '',
        '            steam3.Disconnect();',
        '        }'
      ].join('\n'),
      [
        '        public static void ShutdownSteam3()',
        '        {',
        '            if (steam3 == null)',
        '                return;',
        '',
        '            steam3.Disconnect();',
        '        }',
        '',
        '        public static async Task<string> WallHubGetSteamWebSessionJsonAsync()',
        '        {',
        '            if (steam3 == null)',
        '            {',
        '                throw new InvalidOperationException("Steam3 session is not initialized.");',
        '            }',
        '',
        '            return await steam3.WallHubGetSteamWebSessionJsonAsync().ConfigureAwait(false);',
        '        }'
      ].join('\n'),
      'DepotDownloader ContentDownloader.cs web session wrapper'
    );
    fs.writeFileSync(contentPath, content, 'utf8');
  }

  if (!content.includes('WallHubGetUserFilesJsonAsync')) {
    content = replaceSourceOnce(
      content,
      [
        '        public static async Task<string> WallHubGetSteamWebSessionJsonAsync()'
      ].join('\n'),
      [
        '        public static async Task<string> WallHubGetUserFilesJsonAsync(uint appId, string listType, uint page, uint numperpage, string sortmethod)',
        '        {',
        '            if (steam3 == null)',
        '            {',
        '                throw new InvalidOperationException("Steam3 session is not initialized.");',
        '            }',
        '',
        '            return await steam3.WallHubGetUserFilesJsonAsync(appId, listType, page, numperpage, sortmethod).ConfigureAwait(false);',
        '        }',
        '',
        '        public static async Task<string> WallHubGetSteamWebSessionJsonAsync()'
      ].join('\n'),
      'DepotDownloader ContentDownloader.cs user files wrapper'
    );
    fs.writeFileSync(contentPath, content, 'utf8');
  }
  if (!content.includes('WallHubQueryWorkshopJsonAsync')) {
    content = replaceSourceOnce(
      content,
      '        public static async Task<string> WallHubGetUserFilesJsonAsync(uint appId, string listType, uint page, uint numperpage, string sortmethod)',
      [
        '        public static async Task<string> WallHubQueryWorkshopJsonAsync(string queryJson)',
        '        {',
        '            if (steam3 == null)',
        '            {',
        '                throw new InvalidOperationException("Steam3 session is not initialized.");',
        '            }',
        '',
        '            return await steam3.WallHubQueryWorkshopJsonAsync(queryJson).ConfigureAwait(false);',
        '        }',
        '',
        '        public static async Task<string> WallHubGetUserFilesJsonAsync(uint appId, string listType, uint page, uint numperpage, string sortmethod)',
      ].join('\n'),
      'DepotDownloader ContentDownloader.cs Workshop query wrapper'
    );
    fs.writeFileSync(contentPath, content, 'utf8');
  }
  return content;
}

module.exports = { patchWebSessionContent };
