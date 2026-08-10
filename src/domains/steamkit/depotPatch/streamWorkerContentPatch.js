'use strict';

const fs = require('fs');
const { replaceSourceOnce } = require('./sourceEdits');

function patchStreamWorkerContent(contentPath, content, includeStream) {
  if (includeStream && !content.includes('WallHubGetPubfileStreamInfoAsync')) {
    content = replaceSourceOnce(
      content,
      [
        '        public static async Task DownloadPubfileAsync(uint appId, ulong publishedFileId)',
        '        {'
      ].join('\n'),
      [
        '        public static Task<string> WallHubGetPubfileStreamInfoAsync(uint appId, ulong publishedFileId)',
        '        {',
        '            return WallHubDepotStream.GetPubfileStreamInfoAsync(steam3, Config, appId, publishedFileId);',
        '        }',
        '',
        '        public static Task WallHubStreamPubfileRangeAsync(uint appId, ulong publishedFileId, ulong start, ulong end, Stream output)',
        '        {',
        '            return WallHubDepotStream.StreamPubfileRangeAsync(steam3, Config, appId, publishedFileId, start, end, output);',
        '        }',
        '',
        '        public static Task WallHubRunPubfileStreamWorkerAsync(uint appId, ulong publishedFileId, TextWriter controlOut)',
        '        {',
        '            return WallHubDepotStream.RunPubfileStreamWorkerAsync(steam3, Config, appId, publishedFileId, controlOut);',
        '        }',
        '',
        '        public static async Task DownloadPubfileAsync(uint appId, ulong publishedFileId)',
        '        {'
      ].join('\n'),
      'DepotDownloader ContentDownloader.cs stream wrappers'
    );
    fs.writeFileSync(contentPath, content, 'utf8');
  }
  return content;
}

module.exports = { patchStreamWorkerContent };
