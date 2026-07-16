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
    assert.doesNotMatch(steam3Session, /WallHubSteamWebApiBrokerHandler\(directHandler/);
    assert.doesNotMatch(steam3Session, /return new HttpClient\(directHandler/);
    assert.match(steam3Session, /WallHubSteamWebApiBrokerHandler\(WallHubCreateApiSocketsHandler\(\), brokerUrl, brokerToken\)/);
    assert.match(steam3Session, /WallHubApiTimeoutSeconds\(\)/);
    assert.match(steam3Session, /Timeout = TimeSpan\.FromSeconds\(WallHubApiTimeoutSeconds\(\)\)/);
    const program = fs.readFileSync(path.join(dir, 'Program.cs'), 'utf8');
    assert.match(program, /WALLHUB_DEPOT_BOOTSTRAP:main/);
    assert.equal((program.match(/WALLHUB_DEPOT_BOOTSTRAP:main/g) || []).length, 1);
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
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
