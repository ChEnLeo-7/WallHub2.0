'use strict';

const fs = require('fs');
const { replaceSourceOnce } = require('./sourceEdits');

function patchSteam3WorkshopQuery(steam3SessionPath, steam3Session) {
  if (steam3Session.includes('WallHubQueryWorkshopJsonAsync')) {
    steam3Session = steam3Session
      .replace(/^\s*search_text_target = \(EQueryFilesSearchTextTarget\)[^\r\n]*\r?\n/m, '')
      .replace(/CPublishedFile_QueryFiles_Request\.Types\.KVTag/g, 'CPublishedFile_QueryFiles_Request.KVTag')
      .replace(
        '                var response = await steamPublishedFile.GetUserFiles(request);',
        [
          '                var userFilesJob = steamPublishedFile.GetUserFiles(request);',
          '                userFilesJob.Timeout = TimeSpan.FromMilliseconds(41000);',
          '                var userFilesTask = userFilesJob.ToTask();',
          '                if (await Task.WhenAny(userFilesTask, Task.Delay(40000)) != userFilesTask)',
          '                    throw new TimeoutException("Steam CM Workshop user files query timed out.");',
          '                var response = await userFilesTask;',
        ].join('\n'),
      )
      .replace(
        '            var queryResponse = await steamPublishedFile.QueryFiles(queryRequest);',
        [
          '            var queryTimeoutMs = Math.Min(Math.Max(WallHubJsonUInt(input, "wallhub_timeout_ms", 40000u), 5000u), 115000u);',
          '            var queryJob = steamPublishedFile.QueryFiles(queryRequest);',
          '            queryJob.Timeout = TimeSpan.FromMilliseconds(queryTimeoutMs + 1000u);',
          '            var queryTask = queryJob.ToTask();',
          '            if (await Task.WhenAny(queryTask, Task.Delay((int)queryTimeoutMs)) != queryTask)',
          '                throw new TimeoutException("Steam CM Workshop query timed out.");',
          '            var queryResponse = await queryTask;',
        ].join('\n'),
      );
    if (!/language = WallHubJsonUInt\(input, "language"/.test(steam3Session)) {
      steam3Session = steam3Session.replace(
        '                search_text = WallHubJsonText(input, "search_text", 512), days = WallHubJsonUInt(input, "days", 0u),',
        '                search_text = WallHubJsonText(input, "search_text", 512), language = WallHubJsonUInt(input, "language", 0u) == 6u ? 6 : 0, days = WallHubJsonUInt(input, "days", 0u),',
      );
    }
    if (!steam3Session.includes('WallHubJsonKeyValueTags')) {
      steam3Session = steam3Session.replace(
        '        private static object WallHubPublishedFileDetails(PublishedFileDetails item)',
        [
          '        private static IEnumerable<(string Key, string Value)> WallHubJsonKeyValueTags(JsonElement input, string name)',
          '        {',
          '            if (!input.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array) yield break;',
          '            foreach (var item in value.EnumerateArray())',
          '            {',
          '                if (item.ValueKind != JsonValueKind.Object) continue;',
          '                var key = WallHubJsonText(item, "key", 128);',
          '                var tagValue = WallHubJsonText(item, "value", 256);',
          '                if (!string.IsNullOrWhiteSpace(key) && !string.IsNullOrWhiteSpace(tagValue)) yield return (key, tagValue);',
          '            }',
          '        }',
          '',
          '        private static object WallHubPublishedFileDetails(PublishedFileDetails item)',
        ].join('\n'),
      );
    }
    if (!steam3Session.includes('ProtoBuf.Extensible.AppendValue(queryRequest, 50')) {
      steam3Session = steam3Session.replace(
        '            queryRequest.requiredtags.AddRange(WallHubJsonTextArray(input, "requiredtags"));',
        [
          '            var searchTextTarget = Math.Min(WallHubJsonUInt(input, "search_text_target", 0u), 2u);',
          '            if (searchTextTarget != 0u) ProtoBuf.Extensible.AppendValue(queryRequest, 50, (int)searchTextTarget);',
          '            queryRequest.requiredtags.AddRange(WallHubJsonTextArray(input, "requiredtags"));',
        ].join('\n'),
      );
    }
    if (!steam3Session.includes('queryRequest.required_kv_tags.Add')) {
      steam3Session = steam3Session.replace(
        [
          '            queryRequest.excludedtags.AddRange(WallHubJsonTextArray(input, "excludedtags"));',
          '            var queryTimeoutMs = Math.Min(Math.Max(WallHubJsonUInt(input, "wallhub_timeout_ms", 40000u), 5000u), 115000u);',
        ].join('\n'),
        [
          '            queryRequest.excludedtags.AddRange(WallHubJsonTextArray(input, "excludedtags"));',
          '            foreach (var tag in WallHubJsonKeyValueTags(input, "required_kv_tags"))',
          '                queryRequest.required_kv_tags.Add(new CPublishedFile_QueryFiles_Request.KVTag { key = tag.Key, value = tag.Value });',
          '            var queryTimeoutMs = Math.Min(Math.Max(WallHubJsonUInt(input, "wallhub_timeout_ms", 40000u), 5000u), 115000u);',
        ].join('\n'),
      );
    }
    fs.writeFileSync(steam3SessionPath, steam3Session, 'utf8');
    return steam3Session;
  }
  steam3Session = replaceSourceOnce(
    steam3Session,
    '        public async Task<string> WallHubGetUserFilesJsonAsync(uint appId, string listType, uint page, uint numperpage, string sortmethod)',
    [
      '        private static uint WallHubJsonUInt(JsonElement input, string name, uint fallback = 0)',
      '        {',
      '            if (!input.TryGetProperty(name, out var value)) return fallback;',
      '            if (value.ValueKind == JsonValueKind.Number && value.TryGetUInt32(out var number)) return number;',
      '            if (value.ValueKind == JsonValueKind.String && uint.TryParse(value.GetString(), out number)) return number;',
      '            return fallback;',
      '        }',
      '',
      '        private static bool WallHubJsonBool(JsonElement input, string name, bool fallback = false)',
      '        {',
      '            if (!input.TryGetProperty(name, out var value)) return fallback;',
      '            if (value.ValueKind == JsonValueKind.True) return true;',
      '            if (value.ValueKind == JsonValueKind.False) return false;',
      '            return fallback;',
      '        }',
      '',
      '        private static string WallHubJsonText(JsonElement input, string name, int maximumLength = 1024)',
      '        {',
      '            if (!input.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.String) return string.Empty;',
      '            var text = (value.GetString() ?? string.Empty).Trim();',
      '            return text.Length <= maximumLength ? text : text.Substring(0, maximumLength);',
      '        }',
      '',
      '        private static IEnumerable<string> WallHubJsonTextArray(JsonElement input, string name)',
      '        {',
      '            if (!input.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array) yield break;',
      '            foreach (var item in value.EnumerateArray())',
      '            {',
      '                if (item.ValueKind != JsonValueKind.String) continue;',
      '                var text = (item.GetString() ?? string.Empty).Trim();',
      '                if (!string.IsNullOrWhiteSpace(text) && text.Length <= 128) yield return text;',
      '            }',
      '        }',
      '',
      '        private static IEnumerable<(string Key, string Value)> WallHubJsonKeyValueTags(JsonElement input, string name)',
      '        {',
      '            if (!input.TryGetProperty(name, out var value) || value.ValueKind != JsonValueKind.Array) yield break;',
      '            foreach (var item in value.EnumerateArray())',
      '            {',
      '                if (item.ValueKind != JsonValueKind.Object) continue;',
      '                var key = WallHubJsonText(item, "key", 128);',
      '                var tagValue = WallHubJsonText(item, "value", 256);',
      '                if (!string.IsNullOrWhiteSpace(key) && !string.IsNullOrWhiteSpace(tagValue)) yield return (key, tagValue);',
      '            }',
      '        }',
      '',
      '        private static object WallHubPublishedFileDetails(PublishedFileDetails item)',
      '        {',
      '            return new',
      '            {',
      '                result = item.result,',
      '                publishedfileid = item.publishedfileid.ToString(),',
      '                creator = item.creator.ToString(),',
      '                title = item.title,',
      '                preview_url = item.preview_url,',
      '                subscriptions = item.subscriptions,',
      '                lifetime_subscriptions = item.lifetime_subscriptions,',
      '                views = item.views,',
      '                favorited = item.favorited,',
      '                lifetime_favorited = item.lifetime_favorited,',
      '                file_size = item.file_size,',
      '                time_updated = item.time_updated,',
      '                time_created = item.time_created,',
      '                short_description = item.short_description,',
      '                tags = item.tags',
      '            };',
      '        }',
      '',
      '        public async Task<string> WallHubQueryWorkshopJsonAsync(string queryJson)',
      '        {',
      '            if (!IsLoggedOn || steamUser?.SteamID == null || steamUser.SteamID.AccountType != EAccountType.Individual)',
      '            {',
      '                throw new InvalidOperationException("Steam3 account is not logged in.");',
      '            }',
      '            using var document = JsonDocument.Parse(queryJson);',
      '            var input = document.RootElement;',
      '            if (input.ValueKind != JsonValueKind.Object) throw new InvalidOperationException("Workshop query must be an object.");',
      '            var operation = WallHubJsonText(input, "operation", 32);',
      '            var page = Math.Max(1u, WallHubJsonUInt(input, "page", 1u));',
      '            var numperpage = Math.Min(Math.Max(WallHubJsonUInt(input, "numperpage", 30u), 1u), 100u);',
      '            var appId = WallHubJsonUInt(input, "appid", 431960u);',
      '            var steamId = steamUser.SteamID.ConvertToUInt64();',
      '',
      '            if (operation == "user-files")',
      '            {',
      '                var requestedSteamId = WallHubJsonText(input, "steamid", 24);',
      '                if (!string.IsNullOrWhiteSpace(requestedSteamId) && !ulong.TryParse(requestedSteamId, out steamId))',
      '                    throw new InvalidOperationException("Invalid Workshop author SteamID.");',
      '                var type = WallHubJsonText(input, "type", 32).ToLowerInvariant();',
      '                if (type != "myfiles" && type != "mysubscriptions" && type != "myfavorites" && type != "myvotes")',
      '                    throw new InvalidOperationException("Unsupported Workshop user list type.");',
      '                var sortmethod = WallHubJsonText(input, "sortmethod", 32).ToLowerInvariant();',
      '                var supportedSortMethods = new[] { "subscriptiondate", "alpha", "lastupdated", "creationorder" };',
      '                if (!supportedSortMethods.Contains(sortmethod)) sortmethod = "lastupdated";',
      '                var request = new CPublishedFile_GetUserFiles_Request',
      '                {',
      '                    steamid = steamId, appid = appId, page = page, numperpage = numperpage, type = type, sortmethod = sortmethod,',
      '                    return_tags = true, return_previews = true, return_short_description = true, return_metadata = true, return_vote_data = true',
      '                };',
      '                request.requiredtags.AddRange(WallHubJsonTextArray(input, "requiredtags"));',
      '                request.excludedtags.AddRange(WallHubJsonTextArray(input, "excludedtags"));',
      '                var userFilesJob = steamPublishedFile.GetUserFiles(request);',
      '                userFilesJob.Timeout = TimeSpan.FromMilliseconds(41000);',
      '                var userFilesTask = userFilesJob.ToTask();',
      '                if (await Task.WhenAny(userFilesTask, Task.Delay(40000)) != userFilesTask)',
      '                    throw new TimeoutException("Steam CM Workshop user files query timed out.");',
      '                var response = await userFilesTask;',
      '                if (response.Result != EResult.OK) throw new InvalidOperationException($"Steam returned {response.Result} while querying Workshop user files.");',
      '                var details = response.Body.publishedfiledetails.Where(item => item != null && item.result == (uint)EResult.OK).ToArray();',
      '                return JsonSerializer.Serialize(new { steamid = steamId.ToString(), total = response.Body.total, ids = details.Select(item => item.publishedfileid.ToString()).Distinct().ToArray(), publishedfiledetails = details.Select(WallHubPublishedFileDetails).ToArray() });',
      '            }',
      '',
      '            var queryRequest = new CPublishedFile_QueryFiles_Request',
      '            {',
      '                query_type = WallHubJsonUInt(input, "query_type", 3u), page = page, numperpage = numperpage,',
      '                creator_appid = WallHubJsonUInt(input, "creator_appid", appId), appid = appId, filetype = WallHubJsonUInt(input, "filetype", 0u),',
       '                search_text = WallHubJsonText(input, "search_text", 512), language = WallHubJsonUInt(input, "language", 0u) == 6u ? 6 : 0, days = WallHubJsonUInt(input, "days", 0u),',
      '                include_recent_votes_only = WallHubJsonBool(input, "include_recent_votes_only"), match_all_tags = WallHubJsonBool(input, "match_all_tags", true),',
      '                return_tags = true, return_previews = true, return_short_description = true, return_metadata = true, return_vote_data = true, return_details = true',
      '            };',
      '            var searchTextTarget = Math.Min(WallHubJsonUInt(input, "search_text_target", 0u), 2u);',
      '            if (searchTextTarget != 0u) ProtoBuf.Extensible.AppendValue(queryRequest, 50, (int)searchTextTarget);',
      '            queryRequest.requiredtags.AddRange(WallHubJsonTextArray(input, "requiredtags"));',
      '            queryRequest.excludedtags.AddRange(WallHubJsonTextArray(input, "excludedtags"));',
      '            foreach (var tag in WallHubJsonKeyValueTags(input, "required_kv_tags"))',
      '                queryRequest.required_kv_tags.Add(new CPublishedFile_QueryFiles_Request.KVTag { key = tag.Key, value = tag.Value });',
      '            var queryTimeoutMs = Math.Min(Math.Max(WallHubJsonUInt(input, "wallhub_timeout_ms", 40000u), 5000u), 115000u);',
      '            var queryJob = steamPublishedFile.QueryFiles(queryRequest);',
      '            queryJob.Timeout = TimeSpan.FromMilliseconds(queryTimeoutMs + 1000u);',
      '            var queryTask = queryJob.ToTask();',
      '            if (await Task.WhenAny(queryTask, Task.Delay((int)queryTimeoutMs)) != queryTask)',
      '                throw new TimeoutException("Steam CM Workshop query timed out.");',
      '            var queryResponse = await queryTask;',
      '            if (queryResponse.Result != EResult.OK) throw new InvalidOperationException($"Steam returned {queryResponse.Result} while querying Workshop files.");',
      '            var queryDetails = queryResponse.Body.publishedfiledetails.Where(item => item != null && item.result == (uint)EResult.OK).ToArray();',
      '            return JsonSerializer.Serialize(new { steamid = steamId.ToString(), total = queryResponse.Body.total, ids = queryDetails.Select(item => item.publishedfileid.ToString()).Distinct().ToArray(), publishedfiledetails = queryDetails.Select(WallHubPublishedFileDetails).ToArray() });',
      '        }',
      '',
      '        public async Task<string> WallHubGetUserFilesJsonAsync(uint appId, string listType, uint page, uint numperpage, string sortmethod)',
    ].join('\n'),
    'DepotDownloader Steam3Session.cs Workshop query method'
  );
  fs.writeFileSync(steam3SessionPath, steam3Session, 'utf8');
  return steam3Session;
}

module.exports = { patchSteam3WorkshopQuery };
