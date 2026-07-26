'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  replaceSourceOnce,
  replaceSourceRegexOnce,
  ensureCSharpUsing,
  ensureCSharpUsings,
  assertNoBrokenCSharpCharLiterals,
} = require('./depotPatch/sourceEdits');

const { wallHubSteam3NetworkPatchSource } = require('./depotPatch/steam3NetworkPatch');

function patchDepotDownloaderForJsonProgress(projectDir, options = {}) {
  const includeStream = !!(options && options.includeStream);
  const programPath = path.join(projectDir, 'Program.cs');
  const contentPath = path.join(projectDir, 'ContentDownloader.cs');
  const accountStorePath = path.join(projectDir, 'AccountSettingsStore.cs');
  const steam3SessionPath = path.join(projectDir, 'Steam3Session.cs');
  let program = fs.readFileSync(programPath, 'utf8');
  program = ensureCSharpUsings(program, ['System.Text.Json'], 'DepotDownloader Program.cs query bridge usings');
  fs.writeFileSync(programPath, program, 'utf8');
  let content = fs.readFileSync(contentPath, 'utf8');
  if (!program.includes('WALLHUB_DEPOT_BOOTSTRAP:main')) {
    program = program.replace(
      /(static\s+async\s+Task<int>\s+Main\s*\([^)]*\)\s*\r?\n\s*\{)/,
      '$1\n            Console.Error.WriteLine("WALLHUB_DEPOT_BOOTSTRAP:main");'
    );
    if (!program.includes('WALLHUB_DEPOT_BOOTSTRAP:main')) throw new Error('DepotDownloader Program.cs Main entry source shape changed');
    fs.writeFileSync(programPath, program, 'utf8');
  }
  if (!program.includes('WallHubJsonProgress')) {
    program = replaceSourceOnce(
      program,
      [
        '            ContentDownloader.Config.DownloadManifestOnly = HasParameter(args, "-manifest-only");'
      ].join('\n'),
      [
        '            ContentDownloader.Config.DownloadManifestOnly = HasParameter(args, "-manifest-only");',
        '            ContentDownloader.Config.WallHubJsonProgress = HasParameter(args, "-wallhub-json-progress");'
      ].join('\n'),
      'DepotDownloader Program.cs'
    );
    fs.writeFileSync(programPath, program, 'utf8');
  }

  if (!program.includes('WallHubDirectNetwork.ApplyFromEnvironment')) {
    program = replaceSourceOnce(
      program,
      [
        '            ContentDownloader.Config.WallHubJsonProgress = HasParameter(args, "-wallhub-json-progress");'
      ].join('\n'),
      [
        '            ContentDownloader.Config.WallHubJsonProgress = HasParameter(args, "-wallhub-json-progress");',
        '            WallHubDirectNetwork.ApplyFromEnvironment();'
      ].join('\n'),
      'DepotDownloader Program.cs direct network'
    );
    fs.writeFileSync(programPath, program, 'utf8');
  }

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
        '            var wallHubUserFilesCount = GetParameter(args, "-wallhub-user-files-count", 30u);'
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
        '                        var json = await ContentDownloader.WallHubGetUserFilesJsonAsync(wallHubUserFilesAppId, wallHubUserFilesType, wallHubUserFilesPage, wallHubUserFilesCount).ConfigureAwait(false);',
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

  if (!program.includes('wallHubQueryBridge')) {
    program = replaceSourceOnce(
      program,
      [
        '            var wallHubUserFilesCount = GetParameter(args, "-wallhub-user-files-count", 30u);'
      ].join('\n'),
      [
        '            var wallHubUserFilesCount = GetParameter(args, "-wallhub-user-files-count", 30u);',
        '            var wallHubQueryBridge = HasParameter(args, "-wallhub-query-bridge");'
      ].join('\n'),
      'DepotDownloader Program.cs query bridge args'
    );
    fs.writeFileSync(programPath, program, 'utf8');
  }

  if (!program.includes('WallHubRunQueryBridgeAsync')) {
    program = replaceSourceOnce(
      program,
      [
        '        static async Task<int> Main(string[] args)',
        '        {'
      ].join('\n'),
      [
        '        private static async Task<int> WallHubRunQueryBridgeAsync()',
        '        {',
        '            Console.WriteLine("WALLHUB_STEAM_QUERY_BRIDGE_READY");',
        '            while (true)',
        '            {',
        '                var line = await Console.In.ReadLineAsync().ConfigureAwait(false);',
        '                if (line == null)',
        '                {',
        '                    return 0;',
        '                }',
        '',
        '                var requestId = string.Empty;',
        '                try',
        '                {',
        '                    using var document = JsonDocument.Parse(line);',
        '                    var input = document.RootElement;',
        '                    if (input.ValueKind != JsonValueKind.Object)',
        '                    {',
        '                        throw new InvalidOperationException("SteamKit query bridge input must be a JSON object.");',
        '                    }',
        '',
        '                    requestId = WallHubBridgeText(input, "id", 128);',
        '                    if (string.IsNullOrWhiteSpace(requestId))',
        '                    {',
        '                        throw new InvalidOperationException("SteamKit query bridge request id is required.");',
        '                    }',
        '',
        '                    var operation = WallHubBridgeText(input, "operation", 32);',
        '                    string responseJson;',
        '                    if (operation == "user-files")',
        '                    {',
        '                        var appId = WallHubBridgeUInt(input, "appid", 431960u, 1u, uint.MaxValue);',
        '                        var listType = WallHubBridgeText(input, "listType", 32);',
        '                        var page = WallHubBridgeUInt(input, "page", 1u, 1u, 1000000u);',
        '                        var numperpage = WallHubBridgeUInt(input, "numperpage", 30u, 1u, 100u);',
        '                        responseJson = await ContentDownloader.WallHubGetUserFilesJsonAsync(appId, listType, page, numperpage).ConfigureAwait(false);',
        '                    }',
        '                    else',
        '                    {',
        '                        throw new InvalidOperationException("SteamKit query bridge operation is unsupported.");',
        '                    }',
        '',
        '                    using var responseDocument = JsonDocument.Parse(responseJson);',
        '                    var response = responseDocument.RootElement.Clone();',
        '                    Console.WriteLine($"WALLHUB_STEAM_QUERY_BRIDGE:{JsonSerializer.Serialize(new { id = requestId, ok = true, response })}");',
        '                }',
        '                catch (Exception ex)',
        '                {',
        '                    Console.WriteLine($"WALLHUB_STEAM_QUERY_BRIDGE:{JsonSerializer.Serialize(new { id = requestId, ok = false, error = ex.Message })}");',
        '                }',
        '            }',
        '        }',
        '',
        '        private static uint WallHubBridgeUInt(JsonElement input, string name, uint fallback, uint minimum, uint maximum)',
        '        {',
        '            if (!input.TryGetProperty(name, out var value)) return fallback;',
        '            uint parsed;',
        '            if (value.ValueKind == JsonValueKind.Number && value.TryGetUInt32(out parsed))',
        '            {',
        '                return Math.Min(Math.Max(parsed, minimum), maximum);',
        '            }',
        '            if (value.ValueKind == JsonValueKind.String && uint.TryParse(value.GetString(), out parsed))',
        '            {',
        '                return Math.Min(Math.Max(parsed, minimum), maximum);',
        '            }',
        '            return fallback;',
        '        }',
        '',
        '        private static string WallHubBridgeText(JsonElement input, string name, int maximumLength)',
        '        {',
        '            if (!input.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String) return string.Empty;',
        '            var text = (value.GetString() ?? string.Empty).Trim();',
        '            return text.Length <= maximumLength ? text : text.Substring(0, maximumLength);',
        '        }',
        '',
        '        static async Task<int> Main(string[] args)',
        '        {'
      ].join('\n'),
      'DepotDownloader Program.cs query bridge helpers'
    );
    fs.writeFileSync(programPath, program, 'utf8');
  }

  if (!program.includes('if (wallHubQueryBridge)')) {
    program = replaceSourceOnce(
      program,
      [
        '            if (!string.IsNullOrWhiteSpace(wallHubUserFilesType))',
        '            {'
      ].join('\n'),
      [
        '            if (wallHubQueryBridge)',
        '            {',
        '                PrintUnconsumedArgs(args);',
        '',
        '                if (InitializeSteam(username, password))',
        '                {',
        '                    try',
        '                    {',
        '                        return await WallHubRunQueryBridgeAsync().ConfigureAwait(false);',
        '                    }',
        '                    catch (Exception ex)',
        '                    {',
        '                        Console.Error.WriteLine($"WallHub query bridge failed: {ex.Message}");',
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
        '            if (!string.IsNullOrWhiteSpace(wallHubUserFilesType))',
        '            {'
      ].join('\n'),
      'DepotDownloader Program.cs query bridge command'
    );
    fs.writeFileSync(programPath, program, 'utf8');
  }

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
        '        public static async Task<string> WallHubGetUserFilesJsonAsync(uint appId, string listType, uint page, uint numperpage)',
        '        {',
        '            if (steam3 == null)',
        '            {',
        '                throw new InvalidOperationException("Steam3 session is not initialized.");',
        '            }',
        '',
        '            return await steam3.WallHubGetUserFilesJsonAsync(appId, listType, page, numperpage).ConfigureAwait(false);',
        '        }',
        '',
        '        public static async Task<string> WallHubGetSteamWebSessionJsonAsync()'
      ].join('\n'),
      'DepotDownloader ContentDownloader.cs user files wrapper'
    );
    fs.writeFileSync(contentPath, content, 'utf8');
  }

  if (fs.existsSync(steam3SessionPath)) {
    let steam3Session = fs.readFileSync(steam3SessionPath, 'utf8');
    steam3Session = ensureCSharpUsings(steam3Session, ['System.Collections.Generic', 'System.Linq', 'System.Net', 'System.Net.Http', 'System.Net.Http.Headers', 'System.Net.Sockets', 'System.Text.Json', 'System.Threading'], 'DepotDownloader Steam3Session.cs Steam3 network usings');
    if (!steam3Session.includes('WallHubCreateSteamClient')) {
      if (steam3Session.includes('new SteamClient(clientConfiguration)')) {
        steam3Session = steam3Session.replace('new SteamClient(clientConfiguration)', 'WallHubCreateSteamClient(clientConfiguration)');
      } else if (steam3Session.includes('new SteamClient()')) {
        steam3Session = steam3Session.replace('new SteamClient()', 'WallHubCreateSteamClient(null)');
      } else {
        throw new Error('DepotDownloader Steam3Session.cs SteamClient factory source shape changed');
      }
      steam3Session = replaceSourceOnce(
        steam3Session,
        [
          '        private void ResetConnectionFlags()',
          '        {'
        ].join('\n'),
        [
          wallHubSteam3NetworkPatchSource(),
          '',
          '        private void ResetConnectionFlags()',
          '        {'
        ].join('\n'),
        'DepotDownloader Steam3Session.cs Steam3 protocol factory'
      );
      fs.writeFileSync(steam3SessionPath, steam3Session, 'utf8');
    }
    const steam3NetworkPatchIsCurrent = steam3Session.includes('WallHubBuildSteamConfiguration')
      && steam3Session.includes('WALLHUB_STEAM3_API_BROKER_REQUIRED')
      && !steam3Session.includes('WallHubSteamWebApiBrokerHandler(directHandler')
      && !steam3Session.includes('return new HttpClient(directHandler');
    if (!steam3NetworkPatchIsCurrent) {
      steam3Session = replaceSourceRegexOnce(
        steam3Session,
        /        private static SteamClient WallHubCreateSteamClient\(SteamConfiguration clientConfiguration\)\r?\n[\s\S]*?\r?\n        private void ResetConnectionFlags\(\)\r?\n        \{/,
        [
          wallHubSteam3NetworkPatchSource(),
          '',
          '        private void ResetConnectionFlags()',
          '        {'
        ].join('\n'),
        'DepotDownloader Steam3Session.cs Steam3 WebAPI broker network factory'
      );
      fs.writeFileSync(steam3SessionPath, steam3Session, 'utf8');
    }

    if (!steam3Session.includes('WallHubGetSteamWebSessionJsonAsync')) {
      steam3Session = ensureCSharpUsings(steam3Session, ['System.Security.Cryptography', 'System.Text.Json'], 'DepotDownloader Steam3Session.cs web session usings');
      steam3Session = replaceSourceOnce(
        steam3Session,
        [
          '        private void ResetConnectionFlags()',
          '        {'
        ].join('\n'),
        [
          '        public async Task<string> WallHubGetSteamWebSessionJsonAsync()',
          '        {',
          '            if (!IsLoggedOn || steamUser?.SteamID == null || steamUser.SteamID.AccountType != EAccountType.Individual)',
          '            {',
          '                throw new InvalidOperationException("Steam3 account is not logged in.");',
          '            }',
          '',
          '            if (string.IsNullOrWhiteSpace(logonDetails.AccessToken))',
          '            {',
          '                throw new InvalidOperationException("SteamKit remembered refresh token is unavailable.");',
          '            }',
          '',
          '            var generated = await steamClient.Authentication.GenerateAccessTokenForAppAsync(steamUser.SteamID, logonDetails.AccessToken).ConfigureAwait(false);',
          '            if (string.IsNullOrWhiteSpace(generated.AccessToken))',
          '            {',
          '                throw new InvalidOperationException("Steam did not return a web access token.");',
          '            }',
          '',
          '            if (!string.IsNullOrWhiteSpace(generated.RefreshToken) && !string.IsNullOrWhiteSpace(logonDetails.Username))',
          '            {',
          '                logonDetails.AccessToken = generated.RefreshToken;',
          '                AccountSettingsStore.Instance.LoginTokens[logonDetails.Username] = generated.RefreshToken;',
          '                AccountSettingsStore.Save();',
          '            }',
          '',
          '            var steamId = steamUser.SteamID.ConvertToUInt64().ToString();',
          '            var sessionId = WallHubRandomHex(12);',
          '            var clientSessionId = WallHubRandomHex(8);',
          '            var steamLoginSecure = Uri.EscapeDataString($"{steamId}||{generated.AccessToken}");',
          '            var cookies = new[]',
          '            {',
          '                $"steamLoginSecure={steamLoginSecure}",',
          '                $"sessionid={sessionId}",',
          '                $"clientsessionid={clientSessionId}"',
          '            };',
          '',
          '            return JsonSerializer.Serialize(new',
          '            {',
          '                steamid = steamId,',
          '                account = logonDetails.Username ?? string.Empty,',
          '                sessionid = sessionId,',
          '                cookies,',
          '                cookie = string.Join("; ", cookies),',
          '                generatedAt = DateTimeOffset.UtcNow.ToUnixTimeSeconds()',
          '            });',
          '        }',
          '',
          '        static string WallHubRandomHex(int byteCount)',
          '        {',
          '            return Convert.ToHexString(RandomNumberGenerator.GetBytes(byteCount)).ToLowerInvariant();',
          '        }',
          '',
          '        private void ResetConnectionFlags()',
          '        {'
        ].join('\n'),
        'DepotDownloader Steam3Session.cs web session method'
      );
      fs.writeFileSync(steam3SessionPath, steam3Session, 'utf8');
    }
    if (!steam3Session.includes('WallHubGetUserFilesJsonAsync')) {
      steam3Session = ensureCSharpUsings(steam3Session, ['System.Text.Json'], 'DepotDownloader Steam3Session.cs user files usings');
      steam3Session = replaceSourceOnce(
        steam3Session,
        [
          '        static string WallHubRandomHex(int byteCount)',
          '        {'
        ].join('\n'),
        [
          '        public async Task<string> WallHubGetUserFilesJsonAsync(uint appId, string listType, uint page, uint numperpage)',
          '        {',
          '            if (!IsLoggedOn || steamUser?.SteamID == null || steamUser.SteamID.AccountType != EAccountType.Individual)',
          '            {',
          '                throw new InvalidOperationException("Steam3 account is not logged in.");',
          '            }',
          '',
          '            var type = (listType ?? string.Empty).Trim().ToLowerInvariant();',
          '            if (type != "mysubscriptions" && type != "myfavorites")',
          '            {',
          '                throw new InvalidOperationException("Unsupported WallHub personal Workshop list type.");',
          '            }',
          '',
          '            var safePage = page < 1 ? 1u : page;',
          '            var safePageSize = Math.Min(Math.Max(numperpage, 1u), 100u);',
          '            var steamId = steamUser.SteamID.ConvertToUInt64();',
          '            var request = new CPublishedFile_GetUserFiles_Request',
          '            {',
          '                steamid = steamId,',
          '                appid = appId,',
          '                page = safePage,',
          '                numperpage = safePageSize,',
          '                type = type,',
          '                sortmethod = "lastupdated",',
          '                return_tags = true,',
          '                return_previews = true,',
          '                return_short_description = true',
          '            };',
          '            var response = await steamPublishedFile.GetUserFiles(request);',
          '            if (response.Result != EResult.OK)',
          '            {',
          '                throw new InvalidOperationException($"Steam returned {response.Result} while querying personal Workshop files.");',
          '            }',
          '',
        '            var details = response.Body.publishedfiledetails',
        '                .Where(item => item != null && item.result == (uint)EResult.OK)',
        '                .ToArray();',
        '            var ids = details',
        '                .Select(item => item.publishedfileid.ToString())',
        '                .Where(id => !string.IsNullOrWhiteSpace(id))',
        '                .Distinct()',
          '                .ToArray();',
          '            return JsonSerializer.Serialize(new',
          '            {',
          '                steamid = steamId.ToString(),',
        '                type,',
        '                total = response.Body.total,',
        '                ids,',
        '                publishedfiledetails = details',
        '            });',
          '        }',
          '',
          '        static string WallHubRandomHex(int byteCount)',
          '        {'
        ].join('\n'),
        'DepotDownloader Steam3Session.cs user files method'
      );
      fs.writeFileSync(steam3SessionPath, steam3Session, 'utf8');
    }
    if (steam3Session.includes('steamPublishedFile.GetUserFiles(request).ConfigureAwait(false)')) {
      steam3Session = replaceSourceOnce(
        steam3Session,
        '            var response = await steamPublishedFile.GetUserFiles(request).ConfigureAwait(false);',
        '            var response = await steamPublishedFile.GetUserFiles(request);',
        'DepotDownloader Steam3Session.cs AsyncJob await migration'
      );
      fs.writeFileSync(steam3SessionPath, steam3Session, 'utf8');
    }
    assertNoBrokenCSharpCharLiterals(steam3Session, 'DepotDownloader Steam3Session.cs');
    fs.writeFileSync(steam3SessionPath, steam3Session, 'utf8');
  } else {
    throw new Error('DepotDownloader Steam3Session.cs not found');
  }

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

  const chunkProgressPath = path.join(projectDir, 'WallHubDepotChunkProgress.cs');
  fs.writeFileSync(chunkProgressPath, [
    '// This file is subject to the terms and conditions defined',
    "// in file 'LICENSE', which is part of this source code package.",
    '',
    '// Auto-generated by WallHub. Adds stream-level network byte reporting for DepotDownloader.',
    'using System;',
    'using System.Buffers;',
    'using System.Collections.Generic;',
    'using System.IO;',
    'using System.Net.Http;',
    'using System.Net;',
    'using System.Threading;',
    'using System.Threading.Tasks;',
    'using SteamKit2;',
    'using SteamKit2.CDN;',
    '',
    'namespace DepotDownloader',
    '{',
    '    static class WallHubDepotChunkProgress',
    '    {',
    '        public static async Task<int> DownloadDepotChunkAsync(this Client client, uint depotId, DepotManifest.ChunkData chunk, Server server, byte[] destination, byte[] depotKey = null, Server proxyServer = null, string cdnAuthToken = null, Action<int> onBytesRead = null, CancellationToken cancellationToken = default)',
    '        {',
    '            ArgumentNullException.ThrowIfNull(client);',
    '            ArgumentNullException.ThrowIfNull(server);',
    '            ArgumentNullException.ThrowIfNull(chunk);',
    '            ArgumentNullException.ThrowIfNull(destination);',
    '',
    '            if (chunk.ChunkID == null)',
    '            {',
    '                throw new ArgumentException($"Chunk must have a {nameof(DepotManifest.ChunkData.ChunkID)}.", nameof(chunk));',
    '            }',
    '',
    '            if (depotKey == null)',
    '            {',
    '                if ((ulong)destination.Length < chunk.CompressedLength)',
    '                {',
    '                    throw new ArgumentException($"The destination buffer must be longer than the chunk {nameof(DepotManifest.ChunkData.CompressedLength)} (since no depot key was provided).", nameof(destination));',
    '                }',
    '            }',
    '            else',
    '            {',
    '                if ((ulong)destination.Length < chunk.UncompressedLength)',
    '                {',
    '                    throw new ArgumentException($"The destination buffer must be longer than the chunk {nameof(DepotManifest.ChunkData.UncompressedLength)}.", nameof(destination));',
    '                }',
    '            }',
    '',
    '            var chunkID = Convert.ToHexString(chunk.ChunkID).ToLowerInvariant();',
    '            var url = $"depot/{depotId}/chunk/{chunkID}";',
    '            WallHubLogCdnHost(server);',
    '            var request = Client.UseLancacheServer',
    '                ? WallHubBuildLancacheRequest(server, url, cdnAuthToken)',
    '                : new HttpRequestMessage(HttpMethod.Get, WallHubBuildCommand(server, url, cdnAuthToken, proxyServer));',
    '',
    '            using var requestCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);',
    '            requestCts.CancelAfter(Client.RequestTimeout);',
    '            using var httpClient = WallHubCreateHttpClient();',
    '',
    '            try',
    '            {',
    '                using var response = await httpClient.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, requestCts.Token).ConfigureAwait(false);',
    '',
    '                if (!response.IsSuccessStatusCode)',
    '                {',
    '                    throw new SteamKitWebRequestException($"Response status code does not indicate success: {response.StatusCode:D} ({response.ReasonPhrase}).", response);',
    '                }',
    '',
    '                var contentLength = (int)chunk.CompressedLength;',
    '                if (response.Content.Headers.ContentLength.HasValue)',
    '                {',
    '                    contentLength = (int)response.Content.Headers.ContentLength;',
    '                    if (chunk.CompressedLength > 0 && (ulong)contentLength != chunk.CompressedLength)',
    '                    {',
    '                        throw new InvalidDataException($"Content-Length mismatch for depot chunk! (was {contentLength}, but should be {chunk.CompressedLength})");',
    '                    }',
    '                }',
    '                else if (contentLength <= 0)',
    '                {',
    '                    throw new SteamKitWebRequestException("Response does not have Content-Length and chunk.CompressedLength is not set.", response);',
    '                }',
    '',
    '                requestCts.CancelAfter(Client.ResponseBodyTimeout);',
    '',
    '                if (depotKey == null)',
    '                {',
    '                    using var ms = new MemoryStream(destination, 0, contentLength);',
    '                    await WallHubCopyHttpContentWithProgressAsync(response.Content, ms, requestCts.Token, onBytesRead).ConfigureAwait(false);',
    '                    if (ms.Position != contentLength)',
    '                    {',
    '                        throw new InvalidDataException($"Length mismatch after downloading depot chunk! (was {ms.Position}, but should be {contentLength})");',
    '                    }',
    '                    return contentLength;',
    '                }',
    '',
    '                var buffer = ArrayPool<byte>.Shared.Rent(contentLength);',
    '                try',
    '                {',
    '                    using var ms = new MemoryStream(buffer, 0, contentLength);',
    '                    await WallHubCopyHttpContentWithProgressAsync(response.Content, ms, requestCts.Token, onBytesRead).ConfigureAwait(false);',
    '                    if (ms.Position != contentLength)',
    '                    {',
    '                        throw new InvalidDataException($"Length mismatch after downloading depot chunk! (was {ms.Position}, but should be {contentLength})");',
    '                    }',
    '                    return DepotChunk.Process(chunk, buffer.AsSpan()[..contentLength], destination, depotKey);',
    '                }',
    '                finally',
    '                {',
    '                    ArrayPool<byte>.Shared.Return(buffer);',
    '                }',
    '            }',
    '            finally',
    '            {',
    '                request.Dispose();',
    '            }',
    '        }',
    '',
    '        private static async Task WallHubCopyHttpContentWithProgressAsync(HttpContent content, Stream output, CancellationToken cancellationToken, Action<int> onBytesRead)',
    '        {',
    '            var buffer = ArrayPool<byte>.Shared.Rent(128 * 1024);',
    '            try',
    '            {',
    '                using var input = await content.ReadAsStreamAsync(cancellationToken).ConfigureAwait(false);',
    '                while (true)',
    '                {',
    '                    var read = await input.ReadAsync(buffer.AsMemory(0, buffer.Length), cancellationToken).ConfigureAwait(false);',
    '                    if (read <= 0)',
    '                    {',
    '                        break;',
    '                    }',
    '                    await output.WriteAsync(buffer.AsMemory(0, read), cancellationToken).ConfigureAwait(false);',
    '                    onBytesRead?.Invoke(read);',
    '                }',
    '            }',
    '            finally',
    '            {',
    '                ArrayPool<byte>.Shared.Return(buffer);',
    '            }',
    '        }',
    '',
    '        private static readonly object WallHubCdnHostLogLock = new object();',
    '        private static readonly HashSet<string> WallHubLoggedCdnHosts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);',
    '        private static void WallHubLogCdnHost(Server server)',
    '        {',
    '            try',
    '            {',
    '                var host = server.Host ?? server.VHost ?? string.Empty;',
    '                if (string.IsNullOrWhiteSpace(host)) return;',
    '                lock (WallHubCdnHostLogLock)',
    '                {',
    '                    if (!WallHubLoggedCdnHosts.Add(host)) return;',
    '                }',
    '                Console.WriteLine($"WALLHUB_DEPOT_CDN_HOST:{{\\"host\\":\\"{host.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"")}\\",\\"vhost\\":\\"{(server.VHost ?? string.Empty).Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"")}\\",\\"port\\":{server.Port}}}");',
    '            }',
    '            catch { }',
    '        }',
    '',
    '        private static HttpRequestMessage WallHubBuildLancacheRequest(Server server, string command, string query)',
    '        {',
    '            var builder = new UriBuilder',
    '            {',
    '                Scheme = "http",',
    '                Host = "lancache.steamcontent.com",',
    '                Port = 80,',
    '                Path = command,',
    '                Query = query ?? string.Empty',
    '            };',
    '            var request = new HttpRequestMessage(HttpMethod.Get, builder.Uri);',
    '            request.Headers.Host = server.Host;',
    '            request.Headers.Add("User-Agent", "Valve/Steam HTTP Client 1.0");',
    '            return request;',
    '        }',
    '',
    '        private static HttpClient WallHubCreateHttpClient()',
    '        {',
    '            if (Environment.GetEnvironmentVariable("WALLHUB_STEAM_CONTENT_DIRECT") == "1")',
    '            {',
    '                return new HttpClient(new SocketsHttpHandler { UseProxy = false, Proxy = null });',
    '            }',
    '            return HttpClientFactory.CreateHttpClient();',
    '        }',
    '',
    '        private static Uri WallHubBuildCommand(Server server, string command, string query, Server proxyServer)',
    '        {',
    '            var uriBuilder = new UriBuilder',
    '            {',
    '                Scheme = server.Protocol == Server.ConnectionProtocol.HTTP ? "http" : "https",',
    '                Host = server.VHost,',
    '                Port = server.Port,',
    '                Path = command,',
    '                Query = query ?? string.Empty,',
    '            };',
    '',
    '            if (proxyServer != null && proxyServer.UseAsProxy && proxyServer.ProxyRequestPathTemplate != null)',
    '            {',
    '                var pathTemplate = proxyServer.ProxyRequestPathTemplate;',
    '                pathTemplate = pathTemplate.Replace("%host%", uriBuilder.Host, StringComparison.Ordinal);',
    '                pathTemplate = pathTemplate.Replace("%path%", $"/{uriBuilder.Path}", StringComparison.Ordinal);',
    '                uriBuilder.Scheme = proxyServer.Protocol == Server.ConnectionProtocol.HTTP ? "http" : "https";',
    '                uriBuilder.Host = proxyServer.VHost;',
    '                uriBuilder.Port = proxyServer.Port;',
    '                uriBuilder.Path = pathTemplate;',
    '            }',
    '',
    '            return uriBuilder.Uri;',
    '        }',
    '    }',
    '}',
    ''
  ].join(os.EOL), 'utf8');

  const directNetworkPath = path.join(projectDir, 'WallHubDirectNetwork.cs');
  fs.writeFileSync(directNetworkPath, [
    '// This file is subject to the terms and conditions defined',
    "// in file 'LICENSE', which is part of this source code package.",
    '',
    '// Auto-generated by WallHub. Disables system proxy inside DepotDownloader when Steam content is direct.',
    'using System;',
    'using System.Net;',
    'using System.Net.Http;',
    '',
    'namespace DepotDownloader',
    '{',
    '    static class WallHubDirectNetwork',
    '    {',
    '        public static void ApplyFromEnvironment()',
    '        {',
    '            if (Environment.GetEnvironmentVariable("WALLHUB_STEAM_CONTENT_DIRECT") != "1")',
    '            {',
    '                return;',
    '            }',
    '            try',
    '            {',
    '                HttpClient.DefaultProxy = new WallHubNoProxy();',
    '                WebRequest.DefaultWebProxy = null;',
    '                Environment.SetEnvironmentVariable("HTTP_PROXY", null);',
    '                Environment.SetEnvironmentVariable("HTTPS_PROXY", null);',
    '                Environment.SetEnvironmentVariable("ALL_PROXY", null);',
    '                Environment.SetEnvironmentVariable("http_proxy", null);',
    '                Environment.SetEnvironmentVariable("https_proxy", null);',
    '                Environment.SetEnvironmentVariable("all_proxy", null);',
    '            }',
    '            catch { }',
    '        }',
    '',
    '        private sealed class WallHubNoProxy : IWebProxy',
    '        {',
    '            public ICredentials Credentials { get; set; }',
    '            public Uri GetProxy(Uri destination) => destination;',
    '            public bool IsBypassed(Uri host) => true;',
    '        }',
    '    }',
    '}',
    ''
  ].join(os.EOL), 'utf8');

  if (includeStream) {
    const streamPath = path.join(projectDir, 'WallHubDepotStream.cs');
    fs.writeFileSync(streamPath, [
    '// This file is subject to the terms and conditions defined',
    "// in file 'LICENSE', which is part of this source code package.",
    '',
    '// Auto-generated by WallHub. Experimental depot/chunk range streaming for video playback.',
    'using System;',
    'using System.Collections.Generic;',
    'using System.Globalization;',
    'using System.IO;',
    'using System.Linq;',
    'using System.Net;',
    'using System.Net.Http;',
    'using System.Text.Json;',
    'using System.Threading;',
    'using System.Threading.Tasks;',
    'using SteamKit2;',
    'using SteamKit2.CDN;',
    '',
    'namespace DepotDownloader',
    '{',
    '    static partial class WallHubDepotStream',
    '    {',
    '        private sealed class StreamPlan',
    '        {',
    '            public uint AppId;',
    '            public ulong PublishedFileId;',
    '            public uint DepotId;',
    '            public ulong ManifestId;',
    '            public string FileName = string.Empty;',
    '            public ulong Size;',
    '            public byte[] DepotKey = Array.Empty<byte>();',
    '            public DepotManifest Manifest = null!;',
    '            public DepotManifest.FileData File = null!;',
    '        }',
    '',
    '        private sealed class StreamChunkRead',
    '        {',
    '            public DepotManifest.ChunkData Chunk = null!;',
    '            public byte[] Buffer = Array.Empty<byte>();',
    '            public int Written;',
    '        }',
    '',
    '        public static async Task<string> GetPubfileStreamInfoAsync(Steam3Session steam3, DownloadConfig config, uint appId, ulong publishedFileId)',
    '        {',
    '            WallHubDisableSystemProxy();',
    '            var plan = await BuildPlanAsync(steam3, config, appId, publishedFileId).ConfigureAwait(false);',
    '            return JsonSerializer.Serialize(BuildInfoPayload(plan));',
    '        }',
    '',
    '        public static async Task RunPubfileStreamWorkerAsync(Steam3Session steam3, DownloadConfig config, uint appId, ulong publishedFileId, TextWriter controlOut)',
    '        {',
    '            WallHubDisableSystemProxy();',
    '            var plan = await BuildPlanAsync(steam3, config, appId, publishedFileId).ConfigureAwait(false);',
    '            var cdnPool = new CDNClientPool(steam3, appId);',
    '            await cdnPool.UpdateServerList().ConfigureAwait(false);',
    '            await WriteWorkerJsonAsync(controlOut, new Dictionary<string, object>(BuildInfoPayload(plan)) { ["type"] = "ready" }).ConfigureAwait(false);',
    '            Task<Dictionary<string, object>> activeRangeTask = null;',
    '            CancellationTokenSource activeRangeCts = null;',
    '            var activeRangeId = string.Empty;',
    '            var readTask = Console.In.ReadLineAsync();',
    '            while (true)',
    '            {',
    '                if (activeRangeTask != null && activeRangeTask.IsCompleted)',
    '                {',
    '                    var payload = await activeRangeTask.ConfigureAwait(false);',
    '                    await WriteWorkerJsonAsync(controlOut, payload).ConfigureAwait(false);',
    '                    activeRangeCts.Dispose();',
    '                    activeRangeTask = null;',
    '                    activeRangeCts = null;',
    '                    activeRangeId = string.Empty;',
    '                    continue;',
    '                }',
    '',
    '                Task completedTask;',
    '                if (activeRangeTask == null)',
    '                {',
    '                    completedTask = readTask;',
    '                }',
    '                else',
    '                {',
    '                    completedTask = await Task.WhenAny(readTask, activeRangeTask).ConfigureAwait(false);',
    '                }',
    '                if (completedTask == activeRangeTask)',
    '                {',
    '                    continue;',
    '                }',
    '',
    '                var line = await readTask.ConfigureAwait(false);',
    '                if (line == null)',
    '                {',
    '                    if (activeRangeTask != null)',
    '                    {',
    '                        activeRangeCts.Cancel();',
    '                        await activeRangeTask.ConfigureAwait(false);',
    '                        activeRangeCts.Dispose();',
    '                    }',
    '                    break;',
    '                }',
    '                readTask = Console.In.ReadLineAsync();',
    '                if (string.IsNullOrWhiteSpace(line)) continue;',
    '',
    '                var requestId = string.Empty;',
    '                try',
    '                {',
    '                    using var doc = JsonDocument.Parse(line);',
    '                    var root = doc.RootElement;',
    '                    var type = root.TryGetProperty("type", out var typeProp) ? typeProp.GetString() : string.Empty;',
    '                    requestId = root.TryGetProperty("id", out var idProp) ? idProp.GetString() ?? string.Empty : string.Empty;',
    '                    if (string.Equals(type, "exit", StringComparison.OrdinalIgnoreCase))',
    '                    {',
    '                        if (activeRangeTask != null)',
    '                        {',
    '                            activeRangeCts.Cancel();',
    '                            var payload = await activeRangeTask.ConfigureAwait(false);',
    '                            await WriteWorkerJsonAsync(controlOut, payload).ConfigureAwait(false);',
    '                            activeRangeCts.Dispose();',
    '                            activeRangeTask = null;',
    '                            activeRangeCts = null;',
    '                            activeRangeId = string.Empty;',
    '                        }',
    '                        await WriteWorkerJsonAsync(controlOut, new Dictionary<string, object> { ["type"] = "bye" }).ConfigureAwait(false);',
    '                        break;',
    '                    }',
    '                    if (string.Equals(type, "cancel", StringComparison.OrdinalIgnoreCase))',
    '                    {',
    '                        if (activeRangeTask != null && string.Equals(requestId, activeRangeId, StringComparison.Ordinal))',
    '                        {',
    '                            activeRangeCts.Cancel();',
    '                        }',
    '                        else',
    '                        {',
    '                            await WriteWorkerJsonAsync(controlOut, new Dictionary<string, object> { ["type"] = "range", ["id"] = requestId, ["success"] = false, ["cancelled"] = true }).ConfigureAwait(false);',
    '                        }',
    '                        continue;',
    '                    }',
    '                    if (!string.Equals(type, "range", StringComparison.OrdinalIgnoreCase))',
    '                    {',
    '                        await WriteWorkerJsonAsync(controlOut, new Dictionary<string, object> { ["type"] = "error", ["id"] = requestId, ["error"] = "Unknown command" }).ConfigureAwait(false);',
    '                        continue;',
    '                    }',
    '                    if (activeRangeTask != null)',
    '                    {',
    '                        await WriteWorkerJsonAsync(controlOut, new Dictionary<string, object> { ["type"] = "error", ["id"] = requestId, ["error"] = "Range worker is busy" }).ConfigureAwait(false);',
    '                        continue;',
    '                    }',
    '                    var start = root.GetProperty("start").GetUInt64();',
    '                    var end = root.GetProperty("end").GetUInt64();',
    '                    var outPath = root.GetProperty("path").GetString() ?? string.Empty;',
    '                    if (string.IsNullOrWhiteSpace(outPath)) throw new ContentDownloaderException("Missing range output path.");',
    '                    activeRangeId = requestId;',
    '                    activeRangeCts = new CancellationTokenSource();',
    '                    activeRangeTask = RunWorkerRangeAsync(steam3, cdnPool, config, plan, requestId, start, end, outPath, activeRangeCts.Token);',
    '                }',
    '                catch (Exception ex)',
    '                {',
    '                    await WriteWorkerJsonAsync(controlOut, new Dictionary<string, object> { ["type"] = "error", ["id"] = requestId, ["error"] = ex.Message }).ConfigureAwait(false);',
    '                }',
    '            }',
    '        }',
    '',
    '        private static async Task<Dictionary<string, object>> RunWorkerRangeAsync(Steam3Session steam3, CDNClientPool cdnPool, DownloadConfig config, StreamPlan plan, string id, ulong start, ulong end, string outPath, CancellationToken cancellationToken)',
    '        {',
    '            try',
    '            {',
    '                cancellationToken.ThrowIfCancellationRequested();',
    '                Directory.CreateDirectory(Path.GetDirectoryName(outPath) ?? ".");',
    '                await using (var fs = new FileStream(outPath, FileMode.Create, FileAccess.Write, FileShare.Read, 4096, FileOptions.Asynchronous))',
    '                {',
    '                    await StreamRangeWithPlanAsync(steam3, cdnPool, config, plan, start, end, fs, cancellationToken).ConfigureAwait(false);',
    '                }',
    '                cancellationToken.ThrowIfCancellationRequested();',
    '                return new Dictionary<string, object> { ["type"] = "range", ["id"] = id, ["success"] = true, ["path"] = outPath };',
    '            }',
    '            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)',
    '            {',
    '                TryDeleteWorkerRangeFile(outPath);',
    '                return new Dictionary<string, object> { ["type"] = "range", ["id"] = id, ["success"] = false, ["cancelled"] = true };',
    '            }',
    '            catch (Exception ex)',
    '            {',
    '                TryDeleteWorkerRangeFile(outPath);',
    '                return new Dictionary<string, object> { ["type"] = "error", ["id"] = id, ["error"] = ex.Message };',
    '            }',
    '        }',
    '',
    '        private static void TryDeleteWorkerRangeFile(string outPath)',
    '        {',
    '            try',
    '            {',
    '                if (File.Exists(outPath)) File.Delete(outPath);',
    '            }',
    '            catch { }',
    '        }',
    '',
    '        private static Dictionary<string, object> BuildInfoPayload(StreamPlan plan)',
    '        {',
    '            return new Dictionary<string, object>',
    '            {',
    '                ["success"] = true,',
    '                ["appId"] = plan.AppId,',
    '                ["publishedFileId"] = plan.PublishedFileId.ToString(CultureInfo.InvariantCulture),',
    '                ["depotId"] = plan.DepotId,',
    '                ["manifestId"] = plan.ManifestId.ToString(CultureInfo.InvariantCulture),',
    '                ["fileName"] = plan.FileName,',
    '                ["size"] = plan.Size.ToString(CultureInfo.InvariantCulture),',
    '                ["chunks"] = plan.File.Chunks.Count',
    '            };',
    '        }',
    '',
    '        private static async Task WriteWorkerJsonAsync(TextWriter output, Dictionary<string, object> payload)',
    '        {',
    '            await output.WriteLineAsync(JsonSerializer.Serialize(payload)).ConfigureAwait(false);',
    '            await output.FlushAsync().ConfigureAwait(false);',
    '        }',
    '',
    '        public static async Task StreamPubfileRangeAsync(Steam3Session steam3, DownloadConfig config, uint appId, ulong publishedFileId, ulong start, ulong end, Stream output)',
    '        {',
    '            WallHubDisableSystemProxy();',
    '            var plan = await BuildPlanAsync(steam3, config, appId, publishedFileId).ConfigureAwait(false);',
    '            var cdnPool = new CDNClientPool(steam3, appId);',
    '            await cdnPool.UpdateServerList().ConfigureAwait(false);',
    '            await StreamRangeWithPlanAsync(steam3, cdnPool, config, plan, start, end, output, CancellationToken.None).ConfigureAwait(false);',
    '        }',
    '',
    '        private static async Task StreamRangeWithPlanAsync(Steam3Session steam3, CDNClientPool cdnPool, DownloadConfig config, StreamPlan plan, ulong start, ulong end, Stream output, CancellationToken cancellationToken)',
    '        {',
    '            cancellationToken.ThrowIfCancellationRequested();',
    '            if (plan.Size == 0)',
    '            {',
    '                return;',
    '            }',
    '            if (end == ulong.MaxValue || end >= plan.Size)',
    '            {',
    '                end = plan.Size - 1;',
    '            }',
    '            if (start > end || start >= plan.Size)',
    '            {',
    '                throw new ContentDownloaderException($"Invalid stream range {start}-{end}/{plan.Size}.");',
    '            }',
    '',
    '            using var rangeCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);',
    '            var rangeToken = rangeCts.Token;',
    '            var chunks = plan.File.Chunks',
    '                .OrderBy(c => c.Offset)',
    '                .Where(c => c.Offset + c.UncompressedLength - 1 >= start && c.Offset <= end)',
    '                .ToList();',
    '            var maxParallel = Math.Clamp(config.MaxDownloads <= 0 ? 4 : config.MaxDownloads, 1, 8);',
    '            var inFlight = new Dictionary<int, Task<StreamChunkRead>>();',
    '            var nextToSchedule = 0;',
    '',
    '            Task<StreamChunkRead> Schedule(int index)',
    '            {',
    '                return DownloadStreamChunkAsync(steam3, cdnPool, plan, chunks[index], rangeToken);',
    '            }',
    '',
    '            try',
    '            {',
    '                rangeToken.ThrowIfCancellationRequested();',
    '                for (; nextToSchedule < chunks.Count && nextToSchedule < maxParallel; nextToSchedule++)',
    '                {',
    '                    inFlight[nextToSchedule] = Schedule(nextToSchedule);',
    '                }',
    '',
    '                for (var index = 0; index < chunks.Count; index++)',
    '                {',
    '                    rangeToken.ThrowIfCancellationRequested();',
    '                    var read = await inFlight[index].ConfigureAwait(false);',
    '                    inFlight.Remove(index);',
    '                    if (nextToSchedule < chunks.Count)',
    '                    {',
    '                        inFlight[nextToSchedule] = Schedule(nextToSchedule);',
    '                        nextToSchedule++;',
    '                    }',
    '',
    '                    if (read.Written <= 0)',
    '                    {',
    '                        throw new ContentDownloaderException($"Failed to read chunk for {plan.FileName}.");',
    '                    }',
    '',
    '                    var chunk = read.Chunk;',
    '                    var chunkStart = chunk.Offset;',
    '                    var chunkEnd = chunk.Offset + chunk.UncompressedLength - 1;',
    '                    var copyStart = Math.Max(start, chunkStart);',
    '                    var copyEnd = Math.Min(end, chunkEnd);',
    '                    var offset = (int)(copyStart - chunkStart);',
    '                    var count = (int)(copyEnd - copyStart + 1);',
    '                    await output.WriteAsync(read.Buffer.AsMemory(offset, count), rangeToken).ConfigureAwait(false);',
    '                }',
    '            }',
    '            finally',
    '            {',
    '                rangeCts.Cancel();',
    '                var remainingTasks = inFlight.Values.ToArray();',
    '                if (remainingTasks.Length > 0)',
    '                {',
    '                    try { await Task.WhenAll(remainingTasks).ConfigureAwait(false); } catch { }',
    '                }',
    '            }',
    '        }',
    '',
    '        private static async Task<StreamPlan> BuildPlanAsync(Steam3Session steam3, DownloadConfig config, uint appId, ulong publishedFileId)',
    '        {',
    '            var contentIds = new List<ulong>();',
    '            await CollectContentIdsAsync(steam3, appId, publishedFileId, contentIds).ConfigureAwait(false);',
    '            if (contentIds.Count == 0)',
    '            {',
    '                throw new ContentDownloaderException($"Published file {publishedFileId} does not expose depot/chunk content.");',
    '            }',
    '',
    '            await steam3.RequestAppInfo(appId).ConfigureAwait(false);',
    '            var depots = ContentDownloader.GetSteam3AppSection(appId, EAppInfoSection.Depots);',
    '            var workshopDepot = depots["workshopdepot"].AsUnsignedInteger();',
    '            if (workshopDepot == 0)',
    '            {',
    '                workshopDepot = appId;',
    '            }',
    '            await steam3.RequestDepotKey(workshopDepot, appId).ConfigureAwait(false);',
    '            if (!steam3.DepotKeys.TryGetValue(workshopDepot, out var depotKey))',
    '            {',
    '                throw new ContentDownloaderException($"No valid depot key for {workshopDepot}.");',
    '            }',
    '',
    '            var tempRoot = Path.Combine(Path.GetTempPath(), "wallhub-depot-stream-" + Guid.NewGuid().ToString("N"));',
    '            Directory.CreateDirectory(tempRoot);',
    '            try',
    '            {',
    '                foreach (var manifestId in contentIds)',
    '                {',
    '                    var manifest = await DownloadManifestAsync(steam3, config, appId, workshopDepot, manifestId, depotKey, tempRoot).ConfigureAwait(false);',
    '                    var file = PickVideoFile(manifest);',
    '                    if (file == null)',
    '                    {',
    '                        continue;',
    '                    }',
    '                    return new StreamPlan',
    '                    {',
    '                        AppId = appId,',
    '                        PublishedFileId = publishedFileId,',
    '                        DepotId = workshopDepot,',
    '                        ManifestId = manifestId,',
    '                        FileName = file.FileName,',
    '                        Size = file.TotalSize,',
    '                        DepotKey = depotKey,',
    '                        Manifest = manifest,',
    '                        File = file',
    '                    };',
    '                }',
    '            }',
    '            finally',
    '            {',
    '                try { Directory.Delete(tempRoot, true); } catch { }',
    '            }',
    '',
    '            throw new ContentDownloaderException($"No video file was found in published file {publishedFileId}.");',
    '        }',
    '',
    '        private static async Task CollectContentIdsAsync(Steam3Session steam3, uint appId, ulong publishedFileId, List<ulong> contentIds)',
    '        {',
    '            var details = await steam3.GetPublishedFileDetails(appId, publishedFileId).ConfigureAwait(false);',
    '            var fileType = (EWorkshopFileType)details.file_type;',
    '            if (fileType == EWorkshopFileType.Collection)',
    '            {',
    '                foreach (var child in details.children)',
    '                {',
    '                    await CollectContentIdsAsync(steam3, appId, child.publishedfileid, contentIds).ConfigureAwait(false);',
    '                }',
    '                return;',
    '            }',
    '            if (details.hcontent_file > 0)',
    '            {',
    '                contentIds.Add(details.hcontent_file);',
    '            }',
    '        }',
    '',
    '        private static async Task<DepotManifest> DownloadManifestAsync(Steam3Session steam3, DownloadConfig config, uint appId, uint depotId, ulong manifestId, byte[] depotKey, string tempRoot)',
    '        {',
    '            var cdnPool = new CDNClientPool(steam3, appId);',
    '            await cdnPool.UpdateServerList().ConfigureAwait(false);',
    '            var requestCode = await steam3.GetDepotManifestRequestCodeAsync(depotId, appId, manifestId, ContentDownloader.DEFAULT_BRANCH).ConfigureAwait(false);',
    '            var failures = new List<Exception>();',
    '            var attempts = 0;',
    '            var maxAttempts = Math.Max(3, Math.Min(12, config.MaxDownloads <= 0 ? 6 : config.MaxDownloads));',
    '            while (attempts < maxAttempts)',
    '            {',
    '                Server connection = null;',
    '                try',
    '                {',
    '                    attempts++;',
    '                    connection = cdnPool.GetConnection();',
    '                    WallHubLogCdnHost(connection);',
    '                    string cdnToken = null;',
    '                    if (steam3.CDNAuthTokens.TryGetValue((depotId, connection.Host), out var authTokenCallbackPromise))',
    '                    {',
    '                        var result = await authTokenCallbackPromise.Task.ConfigureAwait(false);',
    '                        cdnToken = result.Token;',
    '                    }',
    '                    var manifest = await cdnPool.CDNClient.DownloadManifestAsync(depotId, manifestId, requestCode, connection, depotKey, cdnPool.ProxyServer, cdnToken).ConfigureAwait(false);',
    '                    cdnPool.ReturnConnection(connection);',
    '                    return manifest;',
    '                }',
    '                catch (SteamKitWebRequestException e)',
    '                {',
    '                    failures.Add(e);',
    '                    if (connection != null && e.StatusCode == HttpStatusCode.Forbidden && !steam3.CDNAuthTokens.ContainsKey((depotId, connection.Host)))',
    '                    {',
    '                        await steam3.RequestCDNAuthToken(appId, depotId, connection).ConfigureAwait(false);',
    '                        cdnPool.ReturnConnection(connection);',
    '                        attempts--;',
    '                        continue;',
    '                    }',
    '                    if (connection != null) cdnPool.ReturnBrokenConnection(connection);',
    '                    Console.Error.WriteLine($"CDN manifest retry {attempts}/{maxAttempts} failed on {(connection?.Host ?? "unknown")}: {e.Message}");',
    '                }',
    '                catch (Exception e)',
    '                {',
    '                    failures.Add(e);',
    '                    if (connection != null) cdnPool.ReturnBrokenConnection(connection);',
    '                    Console.Error.WriteLine($"CDN manifest retry {attempts}/{maxAttempts} failed on {(connection?.Host ?? "unknown")}: {e.Message}");',
    '                }',
    '            }',
    '            var last = failures.Count > 0 ? failures[failures.Count - 1] : null;',
    '            throw new ContentDownloaderException($"Failed to download depot manifest {manifestId} after {attempts} CDN attempt(s). Last error: {last?.Message ?? "unknown"}");',
    '        }',
    '',
    '        private static DepotManifest.FileData PickVideoFile(DepotManifest manifest)',
    '        {',
    '            static bool IsVideo(string name)',
    '            {',
    '                var ext = Path.GetExtension(name ?? string.Empty).ToLowerInvariant();',
    '                return ext is ".mp4" or ".webm" or ".wmv" or ".avi" or ".mkv" or ".mov" or ".m4v";',
    '            }',
    '            return manifest.Files',
    '                .Where(f => !f.Flags.HasFlag(EDepotFileFlag.Directory) && IsVideo(f.FileName))',
    '                .OrderByDescending(f => f.TotalSize)',
    '                .FirstOrDefault();',
    '        }',
    '',
    '        private static readonly object WallHubCdnHostLogLock = new object();',
    '        private static readonly HashSet<string> WallHubLoggedCdnHosts = new HashSet<string>(StringComparer.OrdinalIgnoreCase);',
    '        private static void WallHubLogCdnHost(Server server)',
    '        {',
    '            try',
    '            {',
    '                var host = server.Host ?? server.VHost ?? string.Empty;',
    '                if (string.IsNullOrWhiteSpace(host)) return;',
    '                lock (WallHubCdnHostLogLock)',
    '                {',
    '                    if (!WallHubLoggedCdnHosts.Add(host)) return;',
    '                }',
    '                Console.WriteLine($"WALLHUB_DEPOT_CDN_HOST:{{\\"host\\":\\"{host.Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"")}\\",\\"vhost\\":\\"{(server.VHost ?? string.Empty).Replace("\\\\", "\\\\\\\\").Replace("\\"", "\\\\\\"")}\\",\\"port\\":{server.Port}}}");',
    '            }',
    '            catch { }',
    '        }',
    '',
    '        private static void WallHubDisableSystemProxy()',
    '        {',
    '            if (Environment.GetEnvironmentVariable("WALLHUB_STEAM_CONTENT_DIRECT") != "1")',
    '            {',
    '                return;',
    '            }',
    '            try',
    '            {',
    '                HttpClient.DefaultProxy = new WallHubNoProxy();',
    '                WebRequest.DefaultWebProxy = null;',
    '            }',
    '            catch { }',
    '        }',
    '',
    '        private sealed class WallHubNoProxy : IWebProxy',
    '        {',
    '            public ICredentials Credentials { get; set; }',
    '            public Uri GetProxy(Uri destination) => destination;',
    '            public bool IsBypassed(Uri host) => true;',
    '        }',
    '',
    '        private static async Task<StreamChunkRead> DownloadStreamChunkAsync(Steam3Session steam3, CDNClientPool cdnPool, StreamPlan plan, DepotManifest.ChunkData chunk, CancellationToken cancellationToken)',
    '        {',
    '            var buffer = new byte[(int)chunk.UncompressedLength];',
    '            var written = await DownloadChunkAsync(steam3, cdnPool, plan, chunk, buffer, cancellationToken).ConfigureAwait(false);',
    '            return new StreamChunkRead',
    '            {',
    '                Chunk = chunk,',
    '                Buffer = buffer,',
    '                Written = written',
    '            };',
    '        }',
    '',
    '        private static async Task<int> DownloadChunkAsync(Steam3Session steam3, CDNClientPool cdnPool, StreamPlan plan, DepotManifest.ChunkData chunk, byte[] destination, CancellationToken cancellationToken)',
    '        {',
    '            var written = 0;',
    '            do',
    '            {',
    '                cancellationToken.ThrowIfCancellationRequested();',
    '                Server connection = null;',
    '                try',
    '                {',
    '                    connection = cdnPool.GetConnection();',
    '                    WallHubLogCdnHost(connection);',
    '                    string cdnToken = null;',
    '                    if (steam3.CDNAuthTokens.TryGetValue((plan.DepotId, connection.Host), out var authTokenCallbackPromise))',
    '                    {',
    '                        var result = await authTokenCallbackPromise.Task.WaitAsync(cancellationToken).ConfigureAwait(false);',
    '                        cdnToken = result.Token;',
    '                    }',
    '                    written = await cdnPool.CDNClient.DownloadDepotChunkAsync(plan.DepotId, chunk, connection, destination, plan.DepotKey, cdnPool.ProxyServer, cdnToken, null, cancellationToken).ConfigureAwait(false);',
    '                    cdnPool.ReturnConnection(connection);',
    '                    break;',
    '                }',
    '                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)',
    '                {',
    '                    if (connection != null) cdnPool.ReturnConnection(connection);',
    '                    throw;',
    '                }',
    '                catch (SteamKitWebRequestException e)',
    '                {',
    '                    if (connection != null && e.StatusCode == HttpStatusCode.Forbidden && (!steam3.CDNAuthTokens.TryGetValue((plan.DepotId, connection.Host), out var tokenTask) || !tokenTask.Task.IsCompleted))',
    '                    {',
    '                        await steam3.RequestCDNAuthToken(plan.AppId, plan.DepotId, connection).WaitAsync(cancellationToken).ConfigureAwait(false);',
    '                        cdnPool.ReturnConnection(connection);',
    '                        continue;',
    '                    }',
    '                    if (connection != null) cdnPool.ReturnBrokenConnection(connection);',
    '                    throw;',
    '                }',
    '                catch',
    '                {',
    '                    if (connection != null) cdnPool.ReturnBrokenConnection(connection);',
    '                    throw;',
    '                }',
    '            } while (written == 0);',
    '            if (written == 0)',
    '            {',
    '                throw new ContentDownloaderException("Failed to download depot chunk.");',
    '            }',
    '            return written;',
    '        }',
    '    }',
    '}',
    ''
    ].join(os.EOL), 'utf8');
  }

  const configPath = path.join(projectDir, 'DownloadConfig.cs');
  if (fs.existsSync(configPath)) {
    let config = fs.readFileSync(configPath, 'utf8');
    if (!config.includes('WallHubJsonProgress')) {
      config = replaceSourceRegexOnce(
        config,
        /^(\s*public\s+bool\s+DownloadManifestOnly\s*\{\s*get;\s*set;\s*\}\s*)$/m,
        `$1${os.EOL}        public bool WallHubJsonProgress { get; set; }`,
        'DepotDownloader DownloadConfig.cs'
      );
      fs.writeFileSync(configPath, config, 'utf8');
    }
  } else {
    throw new Error('DepotDownloader DownloadConfig.cs not found');
  }

  if (fs.existsSync(accountStorePath)) {
    let accountStore = fs.readFileSync(accountStorePath, 'utf8');
    if (!accountStore.includes('WallHubAccountStoreDir')) {
      accountStore = replaceSourceOnce(
        accountStore,
        [
          '        static readonly IsolatedStorageFile IsolatedStorage = IsolatedStorageFile.GetUserStoreForAssembly();'
        ].join('\n'),
        [
          '        static readonly IsolatedStorageFile IsolatedStorage = IsolatedStorageFile.GetUserStoreForAssembly();',
          '',
          '        static string WallHubAccountStoreDir => Environment.GetEnvironmentVariable("WALLHUB_DEPOT_ACCOUNT_STORE_DIR");',
          '',
          '        static string WallHubAccountStorePath(string filename)',
          '        {',
          '            var dir = WallHubAccountStoreDir;',
          '            if (string.IsNullOrWhiteSpace(dir))',
          '            {',
          '                dir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "WallHub", "DepotDownloader");',
          '            }',
          '            Directory.CreateDirectory(dir);',
          '            return Path.Combine(dir, filename);',
          '        }'
        ].join('\n'),
        'DepotDownloader AccountSettingsStore.cs store path'
      );
      accountStore = replaceSourceOnce(
        accountStore,
        [
          '            if (IsolatedStorage.FileExists(filename))'
        ].join('\n'),
        [
          '            var filePath = WallHubAccountStorePath(filename);',
          '            if (File.Exists(filePath) || IsolatedStorage.FileExists(filename))'
        ].join('\n'),
        'DepotDownloader AccountSettingsStore.cs file exists'
      );
      accountStore = replaceSourceOnce(
        accountStore,
        [
          '                    using var fs = IsolatedStorage.OpenFile(filename, FileMode.Open, FileAccess.Read);'
        ].join('\n'),
        [
          '                    using var fs = File.Exists(filePath)',
          '                        ? File.Open(filePath, FileMode.Open, FileAccess.Read)',
          '                        : IsolatedStorage.OpenFile(filename, FileMode.Open, FileAccess.Read);'
        ].join('\n'),
        'DepotDownloader AccountSettingsStore.cs open read'
      );
      accountStore = replaceSourceOnce(
        accountStore,
        [
          '                using var fs = IsolatedStorage.OpenFile(Instance.FileName, FileMode.Create, FileAccess.Write);'
        ].join('\n'),
        [
          '                using var fs = File.Open(WallHubAccountStorePath(Instance.FileName), FileMode.Create, FileAccess.Write);'
        ].join('\n'),
        'DepotDownloader AccountSettingsStore.cs open write'
      );
      fs.writeFileSync(accountStorePath, accountStore, 'utf8');
    }
  } else {
    throw new Error('DepotDownloader AccountSettingsStore.cs not found');
  }
}



module.exports = {
  ensureCSharpUsing,
  ensureCSharpUsings,
  assertNoBrokenCSharpCharLiterals,
  replaceSourceOnce,
  replaceSourceRegexOnce,
  patchDepotDownloaderForJsonProgress,
};
