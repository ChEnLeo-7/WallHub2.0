'use strict';

const fs = require('fs');
const { replaceSourceOnce } = require('./sourceEdits');

function patchAccountStore(accountStorePath) {
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
          '                        ? File.Open(filePath, FileMode.Open, FileAccess.Read, FileShare.Read)',
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

module.exports = { patchAccountStore };
