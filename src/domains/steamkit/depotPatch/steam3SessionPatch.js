'use strict';

const fs = require('fs');
const {
  replaceSourceOnce,
  replaceSourceRegexOnce,
  ensureCSharpUsings,
  assertNoBrokenCSharpCharLiterals,
} = require('./sourceEdits');
const { wallHubSteam3NetworkPatchSource } = require('./steam3NetworkPatch');
const { patchSteam3WebSession, repairSteam3AsyncJobAwait } = require('./webSessionPatch');
const { patchSteam3WorkshopQuery } = require('./workshopQueryPatch');

function patchSteam3Session(steam3SessionPath) {
  if (fs.existsSync(steam3SessionPath)) {
    let steam3Session = fs.readFileSync(steam3SessionPath, 'utf8');
    steam3Session = ensureCSharpUsings(steam3Session, ['System.Collections.Generic', 'System.Linq', 'System.Net', 'System.Net.Http', 'System.Net.Http.Headers', 'System.Net.Sockets', 'System.Text.Json', 'System.Threading', 'System.Threading.Tasks'], 'DepotDownloader Steam3Session.cs Steam3 network usings');
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
      && steam3Session.includes('WallHubShouldResolveDepotHost')
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
    steam3Session = patchSteam3WebSession(steam3SessionPath, steam3Session);
    steam3Session = patchSteam3WorkshopQuery(steam3SessionPath, steam3Session);
    steam3Session = repairSteam3AsyncJobAwait(steam3SessionPath, steam3Session);
    assertNoBrokenCSharpCharLiterals(steam3Session, 'DepotDownloader Steam3Session.cs');
    fs.writeFileSync(steam3SessionPath, steam3Session, 'utf8');
  } else {
    throw new Error('DepotDownloader Steam3Session.cs not found');
  }
}

module.exports = { patchSteam3Session };
