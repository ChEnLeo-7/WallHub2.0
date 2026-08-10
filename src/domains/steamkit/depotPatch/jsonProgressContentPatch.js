'use strict';

const fs = require('fs');
const { replaceSourceOnce } = require('./sourceEdits');

function patchJsonProgressReporting(contentPath, content) {
  if (!content.includes('WallHubJsonProgress')) {
    content = replaceSourceOnce(
      content,
      [
        '                Ansi.Progress(downloadCounter.totalBytesUncompressed, downloadCounter.completeDownloadSize);'
      ].join('\n'),
      [
        '                if (Config.WallHubJsonProgress && downloadCounter.completeDownloadSize > 0)',
        '                {',
        '                    var downloadedBytes = downloadCounter.totalBytesUncompressed;',
        '                    var totalBytes = downloadCounter.completeDownloadSize;',
        '                    var percent = downloadedBytes / (double)totalBytes * 100.0d;',
        '                    var networkDownloadedBytes = downloadCounter.wallHubNetworkBytesDownloaded;',
        '                    WallHubWriteJsonProgress(downloadedBytes, totalBytes, percent, networkDownloadedBytes);',
        '                }',
        '',
        '                Ansi.Progress(downloadCounter.totalBytesUncompressed, downloadCounter.completeDownloadSize);'
      ].join('\n'),
      'DepotDownloader ContentDownloader.cs progress'
    );
    fs.writeFileSync(contentPath, content, 'utf8');
  }
  return content;
}

function patchJsonProgressDownloads(contentPath, content) {
  if (!content.includes('WallHubNetworkBytesDownloaded')) {
    content = replaceSourceOnce(
      content,
      [
        '            public ulong totalBytesCompressed;',
        '            public ulong totalBytesUncompressed;'
      ].join('\n'),
      [
        '            public ulong totalBytesCompressed;',
        '            public ulong totalBytesUncompressed;',
        '            public ulong wallHubNetworkBytesDownloaded;'
      ].join('\n'),
      'DepotDownloader ContentDownloader.cs global counter'
    );
    content = replaceSourceOnce(
      content,
      [
        '                            depot.DepotId,',
        '                            chunk,',
        '                            connection,',
        '                            chunkBuffer,',
        '                            depot.DepotKey,',
        '                            cdnPool.ProxyServer,',
        '                            cdnToken).ConfigureAwait(false);'
      ].join('\n'),
      [
        '                            depot.DepotId,',
        '                            chunk,',
        '                            connection,',
        '                            chunkBuffer,',
        '                            depot.DepotKey,',
        '                            cdnPool.ProxyServer,',
        '                            cdnToken,',
        '                            bytesRead => WallHubNetworkBytesDownloaded(downloadCounter, bytesRead)).ConfigureAwait(false);'
      ].join('\n'),
      'DepotDownloader ContentDownloader.cs stream chunk downloader'
    );
    fs.writeFileSync(contentPath, content, 'utf8');
  }

  if (!content.includes('WallHubCopyWebFileWithProgressAsync')) {
    const webNeedle = [
      '                Console.WriteLine("Downloading {0}", fileName);',
      '                var responseStream = await client.GetStreamAsync(url);',
      '                await responseStream.CopyToAsync(file);'
    ].join('\n');
    const webReplacement = [
      '                Console.WriteLine("Downloading {0}", fileName);',
      '                using var response = await client.GetAsync(url, System.Net.Http.HttpCompletionOption.ResponseHeadersRead);',
      '                response.EnsureSuccessStatusCode();',
      '                var totalBytes = (ulong)(response.Content.Headers.ContentLength ?? 0);',
      '                using var responseStream = await response.Content.ReadAsStreamAsync();',
      '                if (Config.WallHubJsonProgress && totalBytes > 0)',
      '                {',
      '                    await WallHubCopyWebFileWithProgressAsync(responseStream, file, totalBytes);',
      '                }',
      '                else',
      '                {',
      '                    await responseStream.CopyToAsync(file);',
      '                }'
    ].join('\n');
    content = replaceSourceOnce(content, webNeedle, webReplacement, 'DepotDownloader ContentDownloader.cs web download');

    const helperNeedle = [
      '        public static async Task DownloadAppAsync(uint appId, List<(uint depotId, ulong manifestId)> depotManifestIds, string branch, string os, string arch, string language, bool lv, bool isUgc)',
      '        {'
    ].join('\n');
    const helperReplacement = [
      '        private static void WallHubNetworkBytesDownloaded(GlobalDownloadCounter downloadCounter, int bytesRead)',
      '        {',
      '            if (!Config.WallHubJsonProgress || bytesRead <= 0)',
      '            {',
      '                return;',
      '            }',
      '            ulong networkDownloadedBytes;',
      '            ulong downloadedBytes;',
      '            ulong totalBytes;',
      '            lock (downloadCounter)',
      '            {',
      '                downloadCounter.wallHubNetworkBytesDownloaded += (ulong)bytesRead;',
      '                networkDownloadedBytes = downloadCounter.wallHubNetworkBytesDownloaded;',
      '                downloadedBytes = downloadCounter.totalBytesUncompressed;',
      '                totalBytes = downloadCounter.completeDownloadSize;',
      '            }',
      '            if (totalBytes > 0)',
      '            {',
      '                var percent = downloadedBytes / (double)totalBytes * 100.0d;',
      '                WallHubWriteJsonProgress(downloadedBytes, totalBytes, percent, networkDownloadedBytes, true);',
      '            }',
      '        }',
      '',
      '        private static async Task WallHubCopyWebFileWithProgressAsync(Stream input, Stream output, ulong totalBytes)',
      '        {',
      '            var buffer = ArrayPool<byte>.Shared.Rent(1024 * 512);',
      '            ulong downloadedBytes = 0;',
      '            try',
      '            {',
      '                while (true)',
      '                {',
      '                    var read = await input.ReadAsync(buffer.AsMemory(0, buffer.Length));',
      '                    if (read <= 0)',
      '                    {',
      '                        break;',
      '                    }',
      '                    await output.WriteAsync(buffer.AsMemory(0, read));',
      '                    downloadedBytes += (ulong)read;',
      '                    var percent = downloadedBytes / (double)totalBytes * 100.0d;',
      '                    WallHubWriteJsonProgress(downloadedBytes, totalBytes, percent, downloadedBytes, true);',
      '                }',
      '            }',
      '            finally',
      '            {',
      '                ArrayPool<byte>.Shared.Return(buffer);',
      '            }',
      '        }',
      '',
      '        private static ulong wallHubLastJsonProgressBytes;',
      '        private static ulong wallHubLastJsonNetworkBytes;',
      '        private static long wallHubLastJsonProgressTicks;',
      '        private static long wallHubLastJsonNetworkTicks;',
      '        private static double wallHubJsonSpeedBytesPerSecond;',
      '        private static void WallHubWriteJsonProgress(ulong downloadedBytes, ulong totalBytes, double percent, ulong networkDownloadedBytes, bool networkTick = false)',
      '        {',
      '            var now = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();',
      '            var progressChanged = downloadedBytes > wallHubLastJsonProgressBytes;',
      '            var completed = totalBytes > 0 && downloadedBytes >= totalBytes;',
      '            var elapsedNetworkMs = now - wallHubLastJsonNetworkTicks;',
      '            if (!completed && !progressChanged && elapsedNetworkMs < 1000)',
      '            {',
      '                return;',
      '            }',
      '            if (wallHubLastJsonNetworkTicks > 0 && networkDownloadedBytes >= wallHubLastJsonNetworkBytes)',
      '            {',
      '                var elapsed = Math.Max(0.001d, elapsedNetworkMs / 1000.0d);',
      '                var rawSpeed = (networkDownloadedBytes - wallHubLastJsonNetworkBytes) / elapsed;',
      '                wallHubJsonSpeedBytesPerSecond = wallHubJsonSpeedBytesPerSecond > 0 ? wallHubJsonSpeedBytesPerSecond * 0.82d + rawSpeed * 0.18d : rawSpeed;',
      '            }',
      '            else if (networkDownloadedBytes < wallHubLastJsonNetworkBytes)',
      '            {',
      '                wallHubJsonSpeedBytesPerSecond = 0;',
      '            }',
      '            wallHubLastJsonProgressBytes = downloadedBytes;',
      '            wallHubLastJsonNetworkBytes = networkDownloadedBytes;',
      '            wallHubLastJsonProgressTicks = now;',
      '            wallHubLastJsonNetworkTicks = now;',
      '            Console.WriteLine($"WALLHUB_DEPOT_JSON_PROGRESS:{{\\"downloaded\\":{downloadedBytes},\\"total\\":{totalBytes},\\"networkDownloaded\\":{networkDownloadedBytes},\\"percent\\":{percent.ToString(System.Globalization.CultureInfo.InvariantCulture)},\\"speed\\":{wallHubJsonSpeedBytesPerSecond.ToString(System.Globalization.CultureInfo.InvariantCulture)}}}");',
      '        }',
      '',
      '        public static async Task DownloadAppAsync(uint appId, List<(uint depotId, ulong manifestId)> depotManifestIds, string branch, string os, string arch, string language, bool lv, bool isUgc)',
      '        {'
    ].join('\n');
    content = replaceSourceOnce(content, helperNeedle, helperReplacement, 'DepotDownloader ContentDownloader.cs web progress helper');
    fs.writeFileSync(contentPath, content, 'utf8');
  }
  return content;
}

module.exports = { patchJsonProgressReporting, patchJsonProgressDownloads };
