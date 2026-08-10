'use strict';

const fs = require('fs');
const { replaceSourceOnce } = require('./sourceEdits');

function patchWebSessionProgram(programPath, program) {
  if (!program.includes('wallHubWebSession')) {
    program = replaceSourceOnce(
      program,
      [
        '            WallHubDirectNetwork.ApplyFromEnvironment();'
      ].join('\n'),
      [
        '            WallHubDirectNetwork.ApplyFromEnvironment();',
        '            var wallHubWebSession = HasParameter(args, "-wallhub-web-session");'
      ].join('\n'),
      'DepotDownloader Program.cs web session args'
    );
    program = replaceSourceOnce(
      program,
      [
        '            var appId = GetParameter(args, "-app", ContentDownloader.INVALID_APP_ID);'
      ].join('\n'),
      [
        '            if (wallHubWebSession)',
        '            {',
        '                PrintUnconsumedArgs(args);',
        '',
        '                if (InitializeSteam(username, password))',
        '                {',
        '                    try',
        '                    {',
        '                        var json = await ContentDownloader.WallHubGetSteamWebSessionJsonAsync().ConfigureAwait(false);',
        '                        Console.WriteLine($"WALLHUB_STEAM_WEB_SESSION:{json}");',
        '                        return 0;',
        '                    }',
        '                    catch (Exception ex)',
        '                    {',
        '                        Console.Error.WriteLine($"WallHub web session failed: {ex.Message}");',
        '                        return 1;',
        '                    }',
        '                    finally',
        '                    {',
        '                        ContentDownloader.ShutdownSteam3();',
        '                    }',
        '                }',
        '',
        '                Console.WriteLine("Error: InitializeSteam failed");',
        '                return 1;',
        '            }',
        '',
        '            var appId = GetParameter(args, "-app", ContentDownloader.INVALID_APP_ID);'
      ].join('\n'),
      'DepotDownloader Program.cs web session command'
    );
    fs.writeFileSync(programPath, program, 'utf8');
  }

  if (!program.includes('wallHubUserFilesType')) {
    program = replaceSourceOnce(
      program,
      [
        '            var wallHubWebSession = HasParameter(args, "-wallhub-web-session");'
      ].join('\n'),
      [
        '            var wallHubWebSession = HasParameter(args, "-wallhub-web-session");',
        '            var wallHubUserFilesType = GetParameter(args, "-wallhub-user-files", string.Empty);',
        '            var wallHubUserFilesPage = GetParameter(args, "-wallhub-user-files-page", 1u);',
        '            var wallHubUserFilesCount = GetParameter(args, "-wallhub-user-files-count", 30u);',
        '            var wallHubUserFilesSort = GetParameter(args, "-wallhub-user-files-sort", "lastupdated");'
      ].join('\n'),
      'DepotDownloader Program.cs user files args'
    );
    program = replaceSourceOnce(
      program,
      [
        '            if (wallHubWebSession)',
        '            {'
      ].join('\n'),
      [
        '            if (!string.IsNullOrWhiteSpace(wallHubUserFilesType))',
        '            {',
        '                var wallHubUserFilesAppId = GetParameter(args, "-app", ContentDownloader.INVALID_APP_ID);',
        '                PrintUnconsumedArgs(args);',
        '',
        '                if (wallHubUserFilesAppId == ContentDownloader.INVALID_APP_ID)',
        '                {',
        '                    Console.Error.WriteLine("WallHub user files query requires -app");',
        '                    return 1;',
        '                }',
        '',
        '                if (InitializeSteam(username, password))',
        '                {',
        '                    try',
        '                    {',
        '                        var json = await ContentDownloader.WallHubGetUserFilesJsonAsync(wallHubUserFilesAppId, wallHubUserFilesType, wallHubUserFilesPage, wallHubUserFilesCount, wallHubUserFilesSort).ConfigureAwait(false);',
        '                        Console.WriteLine($"WALLHUB_STEAM_USER_FILES:{json}");',
        '                        return 0;',
        '                    }',
        '                    catch (Exception ex)',
        '                    {',
        '                        Console.Error.WriteLine($"WallHub user files query failed: {ex.Message}");',
        '                        return 1;',
        '                    }',
        '                    finally',
        '                    {',
        '                        ContentDownloader.ShutdownSteam3();',
        '                    }',
        '                }',
        '',
        '                Console.WriteLine("Error: InitializeSteam failed");',
        '                return 1;',
        '            }',
        '',
        '            if (wallHubWebSession)',
        '            {'
      ].join('\n'),
      'DepotDownloader Program.cs user files command'
    );
    fs.writeFileSync(programPath, program, 'utf8');
  }

  return program;
}

module.exports = { patchWebSessionProgram };
