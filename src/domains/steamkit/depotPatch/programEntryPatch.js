'use strict';

const fs = require('fs');
const { replaceSourceOnce, ensureCSharpUsings } = require('./sourceEdits');

function prepareProgram(programPath) {
  let program = fs.readFileSync(programPath, 'utf8');
  program = ensureCSharpUsings(program, ['System.Text', 'System.Text.Json'], 'DepotDownloader Program.cs query bridge usings');
  fs.writeFileSync(programPath, program, 'utf8');
  return program;
}

function patchProgramEntry(programPath, program) {
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

  return program;
}

module.exports = { prepareProgram, patchProgramEntry };
