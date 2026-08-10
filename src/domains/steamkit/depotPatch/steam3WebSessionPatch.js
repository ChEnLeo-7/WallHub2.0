'use strict';

const fs = require('fs');
const { replaceSourceOnce, ensureCSharpUsings } = require('./sourceEdits');

function patchSteam3WebSession(steam3SessionPath, steam3Session) {
    if (!steam3Session.includes('WallHubGetSteamSessionJson')) {
      steam3Session = ensureCSharpUsings(steam3Session, ['System.Text.Json'], 'DepotDownloader Steam3Session.cs session identity using');
      steam3Session = replaceSourceOnce(
        steam3Session,
        [
          '        private void ResetConnectionFlags()',
          '        {'
        ].join('\n'),
        [
          '        public string WallHubGetSteamSessionJson()',
          '        {',
          '            if (!IsLoggedOn || steamUser?.SteamID == null || steamUser.SteamID.AccountType != EAccountType.Individual)',
          '            {',
          '                throw new InvalidOperationException("Steam3 account is not logged in.");',
          '            }',
          '',
          '            return JsonSerializer.Serialize(new',
          '            {',
          '                steamid = steamUser.SteamID.ConvertToUInt64().ToString(),',
          '                account = logonDetails.Username ?? string.Empty',
          '            });',
          '        }',
          '',
          '        private void ResetConnectionFlags()',
          '        {'
        ].join('\n'),
        'DepotDownloader Steam3Session.cs session identity method'
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
          '        public async Task<string> WallHubGetUserFilesJsonAsync(uint appId, string listType, uint page, uint numperpage, string sortmethod)',
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
          '            var safeSortMethod = (sortmethod ?? string.Empty).Trim().ToLowerInvariant();',
          '            var supportedSortMethods = new[] { "subscriptiondate", "alpha", "lastupdated", "creationorder" };',
          '            if (!supportedSortMethods.Contains(safeSortMethod)) safeSortMethod = "lastupdated";',
          '            var steamId = steamUser.SteamID.ConvertToUInt64();',
          '            var request = new CPublishedFile_GetUserFiles_Request',
          '            {',
          '                steamid = steamId,',
          '                appid = appId,',
          '                page = safePage,',
          '                numperpage = safePageSize,',
          '                type = type,',
          '                sortmethod = safeSortMethod,',
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
  return steam3Session;
}

function repairSteam3AsyncJobAwait(steam3SessionPath, steam3Session) {
    if (steam3Session.includes('steamPublishedFile.GetUserFiles(request).ConfigureAwait(false)')) {
      steam3Session = replaceSourceOnce(
        steam3Session,
        '            var response = await steamPublishedFile.GetUserFiles(request).ConfigureAwait(false);',
        '            var response = await steamPublishedFile.GetUserFiles(request);',
        'DepotDownloader Steam3Session.cs AsyncJob await migration'
      );
      fs.writeFileSync(steam3SessionPath, steam3Session, 'utf8');
    }
  return steam3Session;
}

module.exports = {
  patchSteam3WebSession,
  repairSteam3AsyncJobAwait,
};
