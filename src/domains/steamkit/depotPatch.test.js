'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const depotPatch = require('./depotPatch');

function normalizeBrokerFactoryBlock(source) {
  const text = String(source || '');
  return text
    .replace(/var directHandler = WallHubCreateApiSocketsHandler\(\);\s*/g, '')
    .replace(/new WallHubSteamWebApiBrokerHandler\(directHandler, brokerUrl, brokerToken\)/g, 'new WallHubSteamWebApiBrokerHandler(WallHubCreateApiSocketsHandler(), brokerUrl, brokerToken)')
    .replace(/return new HttpClient\(directHandler, disposeHandler: true\) \{ Timeout = TimeSpan\.FromSeconds\(WallHubApiTimeoutSeconds\(\)\) \};/g, 'Console.Error.WriteLine($"WALLHUB_STEAM3_API_BROKER_DISABLED:{purpose}");\n            return new HttpClient(WallHubCreateApiSocketsHandler(), disposeHandler: true) { Timeout = TimeSpan.FromSeconds(WallHubApiTimeoutSeconds()) };')
    .replace(/if \(!string\.IsNullOrWhiteSpace\(brokerUrl\) && !string\.IsNullOrWhiteSpace\(brokerToken\)\)\s*\{\s*return new HttpClient\(/g, 'if (!string.IsNullOrWhiteSpace(brokerUrl) && !string.IsNullOrWhiteSpace(brokerToken))\n            {\n                Console.Error.WriteLine($"WALLHUB_STEAM3_API_BROKER_REQUIRED:{purpose}");\n                return new HttpClient(');
}

function writeFixtureProject() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wallhub-depot-patch-'));

  fs.writeFileSync(path.join(dir, 'Program.cs'), [
    'using System;',
    '',
    'namespace DepotDownloader',
    '{',
    '    class Program',
    '    {',
    '        static async Task<int> Main(string[] args)',
    '        {',
    '            ContentDownloader.Config.DownloadManifestOnly = HasParameter(args, "-manifest-only");',
    '            var username = string.Empty;',
    '            var password = string.Empty;',
    '            if (InitializeSteam(username, password))',
    '            {',
    '            }',
    '            var appId = GetParameter(args, "-app", ContentDownloader.INVALID_APP_ID);',
    '            return 0;',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n'));

  fs.writeFileSync(path.join(dir, 'ContentDownloader.cs'), [
    'using System;',
    'using System.Collections.Generic;',
    'using System.IO;',
    'using System.Threading.Tasks;',
    '',
    'namespace DepotDownloader',
    '{',
    '    static class ContentDownloader',
    '    {',
    '        public const uint INVALID_APP_ID = 0;',
    '        public static DownloadConfig Config = new DownloadConfig();',
    '        static Steam3Session steam3;',
    '',
    '        public static void ShutdownSteam3()',
    '        {',
    '            if (steam3 == null)',
    '                return;',
    '',
    '            steam3.Disconnect();',
    '        }',
    '',
    '        class GlobalDownloadCounter',
    '        {',
    '            public ulong completeDownloadSize;',
    '            public ulong totalBytesCompressed;',
    '            public ulong totalBytesUncompressed;',
    '        }',
    '',
    '        static async Task DownloadSomething(dynamic downloadCounter, dynamic depot, dynamic chunk, dynamic connection, byte[] chunkBuffer, byte[] cdnToken)',
    '        {',
    '            await Task.CompletedTask;',
    '            await client.DownloadDepotChunkAsync(',
    '                            depot.DepotId,',
    '                            chunk,',
    '                            connection,',
    '                            chunkBuffer,',
    '                            depot.DepotKey,',
    '                            cdnPool.ProxyServer,',
    '                            cdnToken).ConfigureAwait(false);',
    '                Ansi.Progress(downloadCounter.totalBytesUncompressed, downloadCounter.completeDownloadSize);',
    '        }',
    '',
    '        static async Task DownloadWebFile(dynamic client, string url, string fileName, Stream file)',
    '        {',
    '                Console.WriteLine("Downloading {0}", fileName);',
    '                var responseStream = await client.GetStreamAsync(url);',
    '                await responseStream.CopyToAsync(file);',
    '        }',
    '',
    '        public static async Task DownloadAppAsync(uint appId, List<(uint depotId, ulong manifestId)> depotManifestIds, string branch, string os, string arch, string language, bool lv, bool isUgc)',
    '        {',
    '            await Task.CompletedTask;',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n'));

  fs.writeFileSync(path.join(dir, 'Steam3Session.cs'), [
    'using System;',
    'using System.Collections.Generic;',
    'using System.Threading.Tasks;',
    'using SteamKit2;',
    '',
    'namespace DepotDownloader',
    '{',
    '    class Steam3Session',
    '    {',
    '        SteamClient steamClient;',
    '        SteamUser steamUser;',
    '        LogOnDetails logonDetails;',
    '        bool IsLoggedOn;',
    '',
    '        public Steam3Session(SteamConfiguration clientConfiguration)',
    '        {',
    '            steamClient = new SteamClient(clientConfiguration);',
    '        }',
    '',
    '        public void Disconnect() {}',
    '',
    '        private void ResetConnectionFlags()',
    '        {',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n'));

  fs.writeFileSync(path.join(dir, 'DownloadConfig.cs'), [
    'namespace DepotDownloader',
    '{',
    '    class DownloadConfig',
    '    {',
    '        public bool DownloadManifestOnly { get; set; }',
    '    }',
    '}',
    '',
  ].join('\n'));

  fs.writeFileSync(path.join(dir, 'AccountSettingsStore.cs'), [
    'using System.IO;',
    'using System.IO.IsolatedStorage;',
    '',
    'namespace DepotDownloader',
    '{',
    '    class AccountSettingsStore',
    '    {',
    '        static readonly IsolatedStorageFile IsolatedStorage = IsolatedStorageFile.GetUserStoreForAssembly();',
    '        public static AccountSettingsStore Instance = new AccountSettingsStore();',
    '        public static void Save() {}',
    '        public string FileName = "account.config";',
    '',
    '        static void Read(string filename)',
    '        {',
    '            if (IsolatedStorage.FileExists(filename))',
    '            {',
    '                    using var fs = IsolatedStorage.OpenFile(filename, FileMode.Open, FileAccess.Read);',
    '            }',
    '        }',
    '',
    '        static void Write()',
    '        {',
    '                using var fs = IsolatedStorage.OpenFile(Instance.FileName, FileMode.Create, FileAccess.Write);',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n'));

  return dir;
}

function enableStreamFixture(dir) {
  const programPath = path.join(dir, 'Program.cs');
  const program = fs.readFileSync(programPath, 'utf8').replace(
    '            var appId = GetParameter(args, "-app", ContentDownloader.INVALID_APP_ID);\n            return 0;',
    [
      '            var appId = GetParameter(args, "-app", ContentDownloader.INVALID_APP_ID);',
      '            var pubFile = 1UL;',
      '                PrintUnconsumedArgs(args);',
      '                        await ContentDownloader.DownloadPubfileAsync(appId, pubFile).ConfigureAwait(false);',
      '            return 0;',
    ].join('\n')
  );
  fs.writeFileSync(programPath, program, 'utf8');

  const contentPath = path.join(dir, 'ContentDownloader.cs');
  const content = fs.readFileSync(contentPath, 'utf8').replace(
    '        public static async Task DownloadAppAsync(uint appId, List<(uint depotId, ulong manifestId)> depotManifestIds, string branch, string os, string arch, string language, bool lv, bool isUgc)',
    [
      '        public static async Task DownloadPubfileAsync(uint appId, ulong publishedFileId)',
      '        {',
      '            await Task.CompletedTask;',
      '        }',
      '',
      '        public static async Task DownloadAppAsync(uint appId, List<(uint depotId, ulong manifestId)> depotManifestIds, string branch, string os, string arch, string language, bool lv, bool isUgc)',
    ].join('\n')
  );
  fs.writeFileSync(contentPath, content, 'utf8');
}

test('ensureCSharpUsings adds missing usings without depending on source order', () => {
  assert.equal(typeof depotPatch.ensureCSharpUsings, 'function');
  const source = [
    'using SteamKit2;',
    'using System.Threading.Tasks;',
    '',
    'namespace DepotDownloader { }',
    '',
  ].join('\n');

  const patched = depotPatch.ensureCSharpUsings(source, ['System.Text.Json', 'System.Security.Cryptography']);
  const patchedAgain = depotPatch.ensureCSharpUsings(patched, ['System.Text.Json', 'System.Security.Cryptography']);

  assert.match(patched, /using System\.Text\.Json;/);
  assert.match(patched, /using System\.Security\.Cryptography;/);
  assert.equal((patchedAgain.match(/using System\.Text\.Json;/g) || []).length, 1);
  assert.equal((patchedAgain.match(/using System\.Security\.Cryptography;/g) || []).length, 1);
});
test('ensureCSharpUsings ignores local using var statements inside methods', () => {
  const source = [
    'using System;',
    'using SteamKit2;',
    '',
    'namespace DepotDownloader',
    '{',
    '    class Steam3Session',
    '    {',
    '        private static void DisplayQrCode(string challengeUrl)',
    '        {',
    '            using var qrGenerator = new QRCodeGenerator();',
    '            var qrCodeData = qrGenerator.CreateQrCode(challengeUrl, QRCodeGenerator.ECCLevel.L);',
    '        }',
    '    }',
    '}',
    '',
  ].join('\n');

  const patched = depotPatch.ensureCSharpUsings(source, ['System.Net', 'System.Net.Http']);

  assert.match(patched, /^using System;\nusing SteamKit2;\nusing System\.Net;\nusing System\.Net\.Http;\n\nnamespace/m);
  assert.doesNotMatch(patched, /using var qrGenerator[^]*using System\.Net;/);
});
test('assertNoBrokenCSharpCharLiterals rejects generated literal newlines', () => {
  assert.equal(typeof depotPatch.assertNoBrokenCSharpCharLiterals, 'function');
  assert.throws(
    () => depotPatch.assertNoBrokenCSharpCharLiterals(".Split(new[] { ',', ';', ' ', '\t', '" + '\n' + "' }, StringSplitOptions.RemoveEmptyEntries)"),
    /invalid C# char literal/
  );
  assert.doesNotThrow(() => depotPatch.assertNoBrokenCSharpCharLiterals(".Split(new[] { ',', ';', ' ', (char)9, (char)13, (char)10 }, StringSplitOptions.RemoveEmptyEntries)"));
});

test('patchDepotDownloaderForJsonProgress tolerates reordered Steam3Session usings', () => {
  const dir = writeFixtureProject();
  try {
    assert.doesNotThrow(() => depotPatch.patchDepotDownloaderForJsonProgress(dir, { includeStream: false }));
    const steam3Session = fs.readFileSync(path.join(dir, 'Steam3Session.cs'), 'utf8');
    assert.match(steam3Session, /using System\.Text\.Json;/);
    assert.match(steam3Session, /using System\.Security\.Cryptography;/);
    assert.match(steam3Session, /using System\.Linq;/);
    assert.match(steam3Session, /using System\.Threading;/);
    assert.match(steam3Session, /using System\.Collections\.Generic;/);
    assert.match(steam3Session, /using System\.Net\.Http\.Headers;/);
    assert.match(steam3Session, /WallHubCreateSteamClient\(clientConfiguration\)/);
    assert.match(steam3Session, /WallHubGetSteamWebSessionJsonAsync/);
    assert.match(steam3Session, /WALLHUB_DEPOT_RESOLVER_URL/);
    assert.match(steam3Session, /WALLHUB_DEPOT_WEBAPI_BROKER_URL/);
    assert.match(steam3Session, /WallHubSteamWebApiBrokerHandler/);
    assert.match(steam3Session, /WallHubCreateBrokerRequest/);
    assert.match(steam3Session, /WALLHUB_STEAM3_API_BROKER:/);
    assert.match(steam3Session, /WALLHUB_STEAM3_API_BROKER_FAILED:/);
    assert.match(steam3Session, /WallHubResolveDepotHostAsync\(host, port, true, cancellationToken\)/);
    assert.match(steam3Session, /CancellationTokenSource\.CreateLinkedTokenSource\(cancellationToken\)/);
    assert.match(steam3Session, /connectCts\.CancelAfter\(TimeSpan\.FromSeconds\(2\)\)/);
    assert.match(steam3Session, /WALLHUB_STEAM3_API_BROKER_REQUIRED:/);
    assert.match(steam3Session, /WALLHUB_STEAM3_API_BROKER_DISABLED:/);
    assert.match(steam3Session, /WallHubShouldResolveDepotHost\(host\) && WallHubSteamCdnDirectMode\(\)/);
    assert.match(steam3Session, /UseProxy = !string\.Equals\(Environment\.GetEnvironmentVariable\("WALLHUB_STEAM_CDN_ROUTE_STRATEGY"\)/);
    assert.match(steam3Session, /WALLHUB_STEAM3_CONNECT_START:/);
    assert.match(steam3Session, /WALLHUB_STEAM3_HTTP_FALLBACK_START:/);
    assert.match(steam3Session, /WallHubApiBootstrapClient = new HttpClient\(new SocketsHttpHandler[\s\S]*UseProxy = false/);
    assert.doesNotMatch(steam3Session, /EndsWith\("\.steamserver\.net"/);
    assert.match(steam3Session, /EndsWith\("\.eccdnx\.com"/);
    assert.match(steam3Session, /EndsWith\("\.pphimalayanrt\.com"/);
    assert.doesNotMatch(steam3Session, /WallHubSteamWebApiBrokerHandler\(directHandler/);
    assert.doesNotMatch(steam3Session, /return new HttpClient\(directHandler/);
    assert.match(steam3Session, /WallHubSteamWebApiBrokerHandler\(WallHubCreateApiSocketsHandler\(\), brokerUrl, brokerToken\)/);
    assert.match(steam3Session, /WallHubApiTimeoutSeconds\(\)/);
    assert.match(steam3Session, /Timeout = TimeSpan\.FromSeconds\(WallHubApiTimeoutSeconds\(\)\)/);
    const program = fs.readFileSync(path.join(dir, 'Program.cs'), 'utf8');
    assert.match(program, /WALLHUB_DEPOT_BOOTSTRAP:main/);
    assert.equal((program.match(/WALLHUB_DEPOT_BOOTSTRAP:main/g) || []).length, 1);
    assert.match(program, /wallHubUserFilesType = GetParameter\(args, "-wallhub-user-files", string\.Empty\)/);
    assert.match(program, /wallHubUserFilesSort = GetParameter\(args, "-wallhub-user-files-sort", "lastupdated"\)/);
    assert.match(program, /WALLHUB_STEAM_USER_FILES:/);
    assert.match(program, /WallHubGetUserFilesJsonAsync\(wallHubUserFilesAppId/);
    assert.match(program, /wallHubCmLogin = HasParameter\(args, "-wallhub-cm-login"\)/);
    assert.match(program, /wallHubPasswordStdin = HasParameter\(args, "-wallhub-password-stdin"\)/);
    assert.match(program, /WALLHUB_STEAM_CM_LOGIN:/);
    assert.match(program, /ContentDownloader\.WallHubGetSteamSessionJson\(\)/);
    assert.match(program, /LoginTokens\.Remove\(username\)/);
    assert.match(program, /password = Console\.In\.ReadLine\(\)/);
    assert.match(program, /if \(wallHubPasswordStdin\)[\s\S]*password = Console\.In\.ReadLine\(\)[\s\S]*if \(password == null\)/);
    assert.doesNotMatch(program, /LoginTokens\.Remove\(username\);\s*AccountSettingsStore\.Save\(\);/);
    assert.match(program, /wallHubQueryBridge = HasParameter\(args, "-wallhub-query-bridge"\)/);
    assert.match(program, /WallHubRunQueryBridgeAsync\(\)/);
    assert.match(program, /WALLHUB_STEAM_QUERY_BRIDGE_READY/);
    assert.match(program, /WALLHUB_STEAM_QUERY_BRIDGE:/);
    assert.match(program, /operation == "workshop-query"/);
    assert.match(program, /WallHubQueryWorkshopJsonAsync/);
    assert.match(program, /using System\.Text\.Json;/);
    assert.match(steam3Session, /WallHubGetSteamSessionJson/);
    assert.match(steam3Session, /steamid = steamUser\.SteamID\.ConvertToUInt64\(\)\.ToString\(\)/);
    assert.match(steam3Session, /WallHubGetUserFilesJsonAsync/);
    assert.match(steam3Session, /CPublishedFile_GetUserFiles_Request/);
    assert.match(steam3Session, /supportedSortMethods = new\[\] \{ "subscriptiondate", "alpha", "lastupdated", "creationorder" \}/);
    assert.match(steam3Session, /sortmethod = safeSortMethod/);
    assert.match(steam3Session, /CPublishedFile_QueryFiles_Request/);
    assert.match(steam3Session, /steamPublishedFile\.QueryFiles\(queryRequest\)/);
    assert.match(steam3Session, /CPublishedFile_GetUserFiles_Request/);
    assert.match(steam3Session, /var response = await steamPublishedFile\.GetUserFiles\(request\);/);
    assert.match(steam3Session, /publishedfiledetails = details/);
    const accountStore = fs.readFileSync(path.join(dir, 'AccountSettingsStore.cs'), 'utf8');
    assert.match(accountStore, /File\.Open\(filePath, FileMode\.Open, FileAccess\.Read, FileShare\.Read\)/);
    assert.doesNotMatch(accountStore, /File\.Open\(filePath, FileMode\.Open, FileAccess\.Read\)(?!,)/);
    assert.doesNotMatch(steam3Session, /steamPublishedFile\.GetUserFiles\(request\)\.ConfigureAwait\(false\)/);
    assert.match(steam3Session, /type != "mysubscriptions" && type != "myfavorites"/);
    assert.match(steam3Session, /socket\?\.Dispose\(\)/);
    assert.match(steam3Session, /route=1/);
    assert.doesNotMatch(steam3Session, /WallHubDohServerListProvider/);
    assert.doesNotMatch(steam3Session, /WallHubResolveServerRecordsAsync/);
    assert.doesNotMatch(steam3Session, /WALLHUB_DEPOT_DOH_ENDPOINTS|WALLHUB_DEPOT_DOT_ENDPOINTS|WALLHUB_DEPOT_CM_RESOLVER|WALLHUB_DEPOT_DOH_CM/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patchDepotDownloaderForJsonProgress upgrades stale Steam3 WebAPI direct-handler patch to broker-required patch', () => {
  const dir = writeFixtureProject();
  try {
    depotPatch.patchDepotDownloaderForJsonProgress(dir, { includeStream: false });
    const steam3Path = path.join(dir, 'Steam3Session.cs');
    const current = fs.readFileSync(steam3Path, 'utf8');
    const stale = current
      .replace('            var brokerUrl = (Environment.GetEnvironmentVariable("WALLHUB_DEPOT_WEBAPI_BROKER_URL") ?? string.Empty).Trim();', '            var directHandler = WallHubCreateApiSocketsHandler();\n            var brokerUrl = (Environment.GetEnvironmentVariable("WALLHUB_DEPOT_WEBAPI_BROKER_URL") ?? string.Empty).Trim();')
      .replace('                Console.Error.WriteLine($"WALLHUB_STEAM3_API_BROKER_REQUIRED:{purpose}");\n', '')
      .replace('new WallHubSteamWebApiBrokerHandler(WallHubCreateApiSocketsHandler(), brokerUrl, brokerToken)', 'new WallHubSteamWebApiBrokerHandler(directHandler, brokerUrl, brokerToken)')
      .replace('            Console.Error.WriteLine($"WALLHUB_STEAM3_API_BROKER_DISABLED:{purpose}");\n            return new HttpClient(WallHubCreateApiSocketsHandler(), disposeHandler: true) { Timeout = TimeSpan.FromSeconds(WallHubApiTimeoutSeconds()) };', '            return new HttpClient(directHandler, disposeHandler: true) { Timeout = TimeSpan.FromSeconds(WallHubApiTimeoutSeconds()) };');
    fs.writeFileSync(steam3Path, stale, 'utf8');

    depotPatch.patchDepotDownloaderForJsonProgress(dir, { includeStream: false });
    const upgraded = fs.readFileSync(steam3Path, 'utf8');

    assert.match(upgraded, /WALLHUB_STEAM3_API_BROKER_REQUIRED:/);
    assert.match(upgraded, /WALLHUB_STEAM3_API_BROKER_DISABLED:/);
    assert.doesNotMatch(upgraded, /WallHubSteamWebApiBrokerHandler\(directHandler/);
    assert.doesNotMatch(upgraded, /return new HttpClient\(directHandler/);
    assert.match(upgraded, /WallHubSteamWebApiBrokerHandler\(WallHubCreateApiSocketsHandler\(\), brokerUrl, brokerToken\)/);
    assert.match(upgraded, /WallHubGetSteamWebSessionJsonAsync/);

    assert.match(upgraded, /WallHubShouldResolveDepotHost/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patchDepotDownloaderForJsonProgress upgrades a stale Steam3 network patch without CDN resolver support', () => {
  const dir = writeFixtureProject();
  try {
    depotPatch.patchDepotDownloaderForJsonProgress(dir, { includeStream: false });
    const steam3Path = path.join(dir, 'Steam3Session.cs');
    const current = fs.readFileSync(steam3Path, 'utf8');
    const stale = current
      .replace('if (WallHubShouldResolveDepotHost(host) && WallHubSteamCdnDirectMode())', 'if (WallHubShouldResolveApiHost(host))')
      .replace('if (WallHubShouldResolveDepotHost(host)) throw new HttpRequestException', 'if (WallHubShouldResolveApiHost(host)) throw new HttpRequestException')
      .replace(/\n        private static bool WallHubShouldResolveDepotHost\(string host\)[\s\S]*?\n        private static async Task<List<IPAddress>> WallHubResolveDepotHostAsync/, '\n        private static async Task<List<IPAddress>> WallHubResolveDepotHostAsync');
    assert.doesNotMatch(stale, /WallHubShouldResolveDepotHost/);
    fs.writeFileSync(steam3Path, stale, 'utf8');

    depotPatch.patchDepotDownloaderForJsonProgress(dir, { includeStream: false });
    const upgraded = fs.readFileSync(steam3Path, 'utf8');

    assert.match(upgraded, /if \(WallHubShouldResolveDepotHost\(host\) && WallHubSteamCdnDirectMode\(\)\)/);
    assert.match(upgraded, /EndsWith\("\.eccdnx\.com"/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patchDepotDownloaderForJsonProgress repairs a stale AsyncJob ConfigureAwait call', () => {
  const dir = writeFixtureProject();
  try {
    depotPatch.patchDepotDownloaderForJsonProgress(dir, { includeStream: false });
    const steam3Path = path.join(dir, 'Steam3Session.cs');
    const stale = fs.readFileSync(steam3Path, 'utf8')
      .replace('var response = await steamPublishedFile.GetUserFiles(request);', 'var response = await steamPublishedFile.GetUserFiles(request).ConfigureAwait(false);');
    fs.writeFileSync(steam3Path, stale, 'utf8');

    depotPatch.patchDepotDownloaderForJsonProgress(dir, { includeStream: false });
    const repaired = fs.readFileSync(steam3Path, 'utf8');
    assert.match(repaired, /var response = await steamPublishedFile\.GetUserFiles\(request\);/);
    assert.doesNotMatch(repaired, /steamPublishedFile\.GetUserFiles\(request\)\.ConfigureAwait\(false\)/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('patchDepotDownloaderForJsonProgress emits a cancellable reusable stream worker', () => {
  const dir = writeFixtureProject();
  try {
    enableStreamFixture(dir);
    depotPatch.patchDepotDownloaderForJsonProgress(dir, { includeStream: true });

    const stream = fs.readFileSync(path.join(dir, 'WallHubDepotStream.cs'), 'utf8');
    const chunkProgress = fs.readFileSync(path.join(dir, 'WallHubDepotChunkProgress.cs'), 'utf8');

    assert.ok(
      stream.indexOf('var readTask = ReadWorkerControlLineAsync();') < stream.indexOf('["type"] = "ready"'),
      'worker must begin reading control input before announcing readiness'
    );
    assert.match(stream, /Task\.Run\(\(\) => Console\.In\.ReadLine\(\)\)/);
    assert.doesNotMatch(stream, /Console\.In\.ReadLineAsync\(\)/);
    assert.match(stream, /Task\.WhenAny\(readTask, activeRangeTask\)/);
    assert.match(stream, /WALLHUB_DEPOT_CONTROL_RECEIVED:\{type\}:\{requestId\}/);
    assert.match(stream, /WALLHUB_DEPOT_CDN_RANGE_STAGE:\{activeRangeId\}:task-complete/);
    assert.match(stream, /RunWorkerRangeAsync\(steam3, cdnPool, config, plan, controlOut, requestId/);
    assert.match(stream, /WALLHUB_DEPOT_CDN_RANGE_STAGE:\{id\}:started:\{start\}-\{end\}/);
    assert.match(stream, /WALLHUB_DEPOT_CDN_RANGE_STAGE:\{id\}:file-complete/);
    assert.match(stream, /string\.Equals\(type, "cancel", StringComparison\.OrdinalIgnoreCase\)/);
    assert.match(stream, /activeRangeCts\.Cancel\(\)/);
    assert.match(stream, /\["cancelled"\] = true/);
    assert.match(stream, /TryDeleteWorkerRangeFile\(outPath\)/);
    assert.match(stream, /new FileStream\(outPath, FileMode\.Create, FileAccess\.Write, FileShare\.Read, 4096, FileOptions\.Asynchronous\)/);
    assert.doesNotMatch(stream, /File\.Open\(outPath/);
    assert.match(stream, /StreamRangeWithPlanAsync\([^\r\n]+CancellationToken cancellationToken\)/);
    assert.match(stream, /DownloadStreamChunkAsync\([^\r\n]+CancellationToken cancellationToken\)/);
    assert.match(stream, /DownloadChunkAsync\([^\r\n]+CancellationToken cancellationToken\)/);
    assert.match(stream, /rangeCts\.Cancel\(\);[\s\S]*Task\.WhenAll\(remainingTasks\)/);
    assert.match(stream, /output\.WriteAsync\(read\.Buffer\.AsMemory\(offset, count\), rangeToken\)/);
    assert.match(stream, /var maxAttempts = WallHubChunkMaxAttempts\(\)/);
    assert.match(stream, /attemptCts\.CancelAfter\(TimeSpan\.FromSeconds\(WallHubChunkAttemptTimeoutSeconds\(\)\)\)/);
    assert.match(stream, /authTokenCallbackPromise\.Task\.WaitAsync\(attemptToken\)/);
    assert.match(stream, /RequestCDNAuthToken\(plan\.AppId, plan\.DepotId, connection\)\.WaitAsync\(attemptToken\)/);
    assert.match(stream, /DownloadDepotChunkAsync\(steam3\.steamClient, plan\.DepotId, chunk, connection/);
    assert.match(stream, /WALLHUB_DEPOT_CDN_CHUNK_RETRY:/);
    assert.match(stream, /WALLHUB_DEPOT_CDN_CHUNK_STAGE:\{attempt\}\/\{maxAttempts\}:connection/);
    assert.match(stream, /WALLHUB_DEPOT_CDN_CHUNK_STAGE:\{attempt\}\/\{maxAttempts\}:auth-wait/);
    assert.match(stream, /WALLHUB_DEPOT_CDN_CHUNK_STAGE:\{attempt\}\/\{maxAttempts\}:auth-ready/);
    assert.match(stream, /WALLHUB_DEPOT_CDN_CHUNK_STAGE:\{attempt\}\/\{maxAttempts\}:http-start/);
    assert.match(stream, /WALLHUB_DEPOT_CDN_CHUNK_STAGE:\{attempt\}\/\{maxAttempts\}:http-done/);
    assert.match(stream, /timeoutHost/);
    assert.match(stream, /authHost/);
    assert.match(stream, /httpHost/);
    assert.match(stream, /failedHost/);
    assert.doesNotMatch(stream, /var host = connection/);
    assert.match(stream, /ReturnBrokenConnection\(connection\)/);
    assert.match(stream, /WALLHUB_DEPOT_STREAM_CHUNK_ATTEMPT_TIMEOUT_SECONDS/);
    assert.match(stream, /WALLHUB_DEPOT_STREAM_CHUNK_MAX_ATTEMPTS/);
    assert.match(stream, /Failed to download depot chunk after \{maxAttempts\} CDN attempt\(s\)/);
    assert.doesNotMatch(stream, /CancellationTokenSource cts/);

    assert.match(chunkProgress, /CancellationToken cancellationToken = default/);
    assert.match(chunkProgress, /CancellationTokenSource\.CreateLinkedTokenSource\(cancellationToken\)/);
    assert.match(chunkProgress, /SendAsync\(request, HttpCompletionOption\.ResponseHeadersRead, requestCts\.Token\)/);
    assert.match(chunkProgress, /ReadAsync\(buffer\.AsMemory\(0, buffer\.Length\), cancellationToken\)/);
    assert.match(chunkProgress, /WALLHUB_DEPOT_CDN_HTTP_STAGE:client-ready/);
    assert.match(chunkProgress, /WALLHUB_DEPOT_CDN_HTTP_STAGE:headers:/);
    assert.match(chunkProgress, /WALLHUB_DEPOT_CDN_HTTP_STAGE:body-first:/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
