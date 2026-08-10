'use strict';

const fs = require('fs');
const { replaceSourceOnce } = require('./sourceEdits');

function patchCmLoginProgram(programPath, program) {
  if (!program.includes('wallHubCmLogin')) {
    program = replaceSourceOnce(
      program,
      '            var wallHubWebSession = HasParameter(args, "-wallhub-web-session");',
      [
        '            var wallHubWebSession = HasParameter(args, "-wallhub-web-session");',
        '            var wallHubCmLogin = HasParameter(args, "-wallhub-cm-login");',
        '            var wallHubPasswordStdin = HasParameter(args, "-wallhub-password-stdin");',
      ].join('\n'),
      'DepotDownloader Program.cs CM login args'
    );
    fs.writeFileSync(programPath, program, 'utf8');
  }

  if (!program.includes('WALLHUB_STEAM_CM_LOGIN:')) {
    program = replaceSourceOnce(
      program,
      [
        '            if (!string.IsNullOrWhiteSpace(wallHubUserFilesType))',
        '            {'
      ].join('\n'),
      [
        '            if (wallHubCmLogin)',
        '            {',
        '                PrintUnconsumedArgs(args);',
        '',
        '                string previousLoginToken = null;',
        '                var hadPreviousLoginToken = wallHubPasswordStdin',
        '                    && !string.IsNullOrWhiteSpace(username)',
        '                    && AccountSettingsStore.Instance.LoginTokens.TryGetValue(username, out previousLoginToken);',
        '                if (wallHubPasswordStdin && !string.IsNullOrWhiteSpace(username))',
        '                {',
        '                    AccountSettingsStore.Instance.LoginTokens.Remove(username);',
        '                }',
        '',
        '                var wallHubLoginSucceeded = false;',
        '                try',
        '                {',
        '                    if (wallHubPasswordStdin)',
        '                    {',
        '                        password = Console.In.ReadLine();',
        '                        if (password == null)',
        '                        {',
        '                            throw new InvalidOperationException("WallHub Steam CM login password was not provided on stdin.");',
        '                        }',
        '                    }',
        '',
        '                    if (!InitializeSteam(username, password))',
        '                    {',
        '                        Console.WriteLine("Error: InitializeSteam failed");',
        '                        return 1;',
        '                    }',
        '',
        '                    wallHubLoginSucceeded = true;',
        '                    var json = ContentDownloader.WallHubGetSteamSessionJson();',
        '                    Console.WriteLine($"WALLHUB_STEAM_CM_LOGIN:{json}");',
        '                    return 0;',
        '                }',
        '                catch (Exception ex)',
        '                {',
        '                    Console.Error.WriteLine($"WallHub Steam CM login failed: {ex.Message}");',
        '                    return 1;',
        '                }',
        '                finally',
        '                {',
        '                    if (wallHubLoginSucceeded) ContentDownloader.ShutdownSteam3();',
        '                    if (!wallHubLoginSucceeded && hadPreviousLoginToken)',
        '                    {',
        '                        AccountSettingsStore.Instance.LoginTokens[username] = previousLoginToken;',
        '                        AccountSettingsStore.Save();',
        '                    }',
        '                }',
        '            }',
        '',
        '            if (!string.IsNullOrWhiteSpace(wallHubUserFilesType))',
        '            {'
      ].join('\n'),
      'DepotDownloader Program.cs CM login command'
    );
    fs.writeFileSync(programPath, program, 'utf8');
  }

  return program;
}

module.exports = { patchCmLoginProgram };
