'use strict';

const fs = require('fs');
const { replaceSourceOnce } = require('./sourceEdits');

function patchStreamWorkerProgram(programPath, program, includeStream) {
  if (includeStream && !program.includes('-wallhub-stream-worker')) {
    const streamArgsNeedle = '                PrintUnconsumedArgs(args);';
    const streamCommandNeedle = '                        await ContentDownloader.DownloadPubfileAsync(appId, pubFile).ConfigureAwait(false);';
    const streamCommandIndex = program.indexOf(streamCommandNeedle);
    const streamArgsIndex = streamCommandIndex >= 0 ? program.lastIndexOf(streamArgsNeedle, streamCommandIndex) : -1;
    if (streamArgsIndex < 0) throw new Error('DepotDownloader Program.cs stream args source shape changed');
    const streamArgsReplacement = [
      '                var wallHubStreamInfo = HasParameter(args, "-wallhub-stream-info");',
      '                var wallHubStreamRange = HasParameter(args, "-wallhub-stream-range");',
      '                var wallHubRangeStart = GetParameter<ulong>(args, "-wallhub-range-start", 0);',
      '                var wallHubRangeEnd = GetParameter<ulong>(args, "-wallhub-range-end", ulong.MaxValue);',
      '                var wallHubStreamWorker = HasParameter(args, "-wallhub-stream-worker");',
      '                var wallHubOriginalOut = Console.Out;',
      '                if (wallHubStreamInfo || wallHubStreamRange || wallHubStreamWorker)',
      '                {',
      '                    Console.SetOut(Console.Error);',
      '                }',
      '',
      '                PrintUnconsumedArgs(args);'
    ].join('\n');
    program = program.slice(0, streamArgsIndex) + streamArgsReplacement + program.slice(streamArgsIndex + streamArgsNeedle.length);
    program = replaceSourceOnce(
      program,
      [
        '                        await ContentDownloader.DownloadPubfileAsync(appId, pubFile).ConfigureAwait(false);'
      ].join('\n'),
      [
        '                        if (wallHubStreamInfo || wallHubStreamRange || wallHubStreamWorker)',
        '                        {',
        '                            if (wallHubStreamWorker)',
        '                            {',
        '                                await ContentDownloader.WallHubRunPubfileStreamWorkerAsync(appId, pubFile, wallHubOriginalOut).ConfigureAwait(false);',
        '                            }',
        '                            else if (wallHubStreamInfo)',
        '                            {',
        '                                var json = await ContentDownloader.WallHubGetPubfileStreamInfoAsync(appId, pubFile).ConfigureAwait(false);',
        '                                await wallHubOriginalOut.WriteLineAsync(json).ConfigureAwait(false);',
        '                            }',
        '                            else',
        '                            {',
        '                                using var wallHubStdout = Console.OpenStandardOutput();',
        '                                await ContentDownloader.WallHubStreamPubfileRangeAsync(appId, pubFile, wallHubRangeStart, wallHubRangeEnd, wallHubStdout).ConfigureAwait(false);',
        '                            }',
        '                        }',
        '                        else',
        '                        {',
        '                            await ContentDownloader.DownloadPubfileAsync(appId, pubFile).ConfigureAwait(false);',
        '                        }'
      ].join('\n'),
      'DepotDownloader Program.cs stream command'
    );
    fs.writeFileSync(programPath, program, 'utf8');
  }
  return program;
}

module.exports = { patchStreamWorkerProgram };
