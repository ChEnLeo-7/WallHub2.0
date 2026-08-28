'use strict';

const fs = require('fs');
const { replaceSourceOnce } = require('./sourceEdits');

function patchQueryBridgeProgram(programPath, program) {
  if (program.includes('WallHubRunQueryBridgeAsync') && !program.includes('Console.InputEncoding = new UTF8Encoding(false);')) {
    program = program.replace(
      '        private static async Task<int> WallHubRunQueryBridgeAsync()\n        {',
      '        private static async Task<int> WallHubRunQueryBridgeAsync()\n        {\n            Console.InputEncoding = new UTF8Encoding(false);\n            Console.OutputEncoding = new UTF8Encoding(false);',
    );
  }
  program = program.replace(
    '                    Console.WriteLine($"WALLHUB_STEAM_QUERY_BRIDGE:{JsonSerializer.Serialize(new { id = requestId, ok = false, error = ex.Message })}");',
    [
      '                    var loginRequired = ex.Message.Contains("not logged in", StringComparison.OrdinalIgnoreCase) || ex.Message.Contains("NotLoggedOn", StringComparison.OrdinalIgnoreCase);',
      '                    var timedOut = ex is TimeoutException || ex is TaskCanceledException;',
      '                    var errorCode = loginRequired ? "STEAM_CM_LOGIN_REQUIRED" : (timedOut ? "STEAM_CM_QUERY_TIMEOUT" : "STEAM_CM_QUERY_FAILED");',
      '                    Console.WriteLine($"WALLHUB_STEAM_QUERY_BRIDGE:{JsonSerializer.Serialize(new { id = requestId, ok = false, error = ex.Message, code = errorCode })}");',
    ].join('\n'),
  );
  if (!program.includes('wallHubQueryBridge')) {
    program = replaceSourceOnce(
      program,
      [
        '            var wallHubUserFilesSort = GetParameter(args, "-wallhub-user-files-sort", "lastupdated");'
      ].join('\n'),
      [
        '            var wallHubUserFilesSort = GetParameter(args, "-wallhub-user-files-sort", "lastupdated");',
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
        '            Console.InputEncoding = new UTF8Encoding(false);',
        '            Console.OutputEncoding = new UTF8Encoding(false);',
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
        '                    if (operation == "workshop-query")',
        '                    {',
        '                        if (!input.TryGetProperty("query", out var query) || query.ValueKind != JsonValueKind.Object)',
        '                        {',
        '                            throw new InvalidOperationException("SteamKit Workshop query payload is required.");',
        '                        }',
        '                        responseJson = await ContentDownloader.WallHubQueryWorkshopJsonAsync(query.GetRawText()).ConfigureAwait(false);',
        '                    }',
        '                    else if (operation == "user-files")',
        '                    {',
        '                        var appId = WallHubBridgeUInt(input, "appid", 431960u, 1u, uint.MaxValue);',
        '                        var listType = WallHubBridgeText(input, "listType", 32);',
        '                        var page = WallHubBridgeUInt(input, "page", 1u, 1u, 1000000u);',
        '                        var numperpage = WallHubBridgeUInt(input, "numperpage", 30u, 1u, 100u);',
        '                        var sortmethod = WallHubBridgeText(input, "sortmethod", 32);',
        '                        responseJson = await ContentDownloader.WallHubGetUserFilesJsonAsync(appId, listType, page, numperpage, sortmethod).ConfigureAwait(false);',
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
      '                    var loginRequired = ex.Message.Contains("not logged in", StringComparison.OrdinalIgnoreCase) || ex.Message.Contains("NotLoggedOn", StringComparison.OrdinalIgnoreCase);',
      '                    var timedOut = ex is TimeoutException || ex is TaskCanceledException;',
      '                    var errorCode = loginRequired ? "STEAM_CM_LOGIN_REQUIRED" : (timedOut ? "STEAM_CM_QUERY_TIMEOUT" : "STEAM_CM_QUERY_FAILED");',
      '                    Console.WriteLine($"WALLHUB_STEAM_QUERY_BRIDGE:{JsonSerializer.Serialize(new { id = requestId, ok = false, error = ex.Message, code = errorCode })}");',
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
  fs.writeFileSync(programPath, program, 'utf8');

  return program;
}

module.exports = { patchQueryBridgeProgram };
