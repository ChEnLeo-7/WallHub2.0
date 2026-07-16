'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function getInstalledDotnetRuntimeVersions(dotnetCommand) {
  try {
    const out = execFileSync(dotnetCommand || 'dotnet', ['--list-runtimes'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 8000,
    });
    const versions = [];
    for (const line of String(out || '').split(/\r?\n/)) {
      const match = line.match(/^Microsoft\.NETCore\.App\s+([^\s]+)/i);
      if (match) versions.push(match[1]);
    }
    return versions;
  } catch {
    return [];
  }
}

function getInstalledDotnetSdkVersions(dotnetCommand) {
  try {
    const out = execFileSync(dotnetCommand || 'dotnet', ['--list-sdks'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 8000,
    });
    const versions = [];
    for (const line of String(out || '').split(/\r?\n/)) {
      const match = line.match(/^([0-9]+\.[0-9]+\.[0-9]+)/);
      if (match) versions.push(match[1]);
    }
    return versions;
  } catch {
    return [];
  }
}

function resolveDotnetRoot(options = {}) {
  const env = options.env || process.env;
  const commandExists = options.commandExists || (() => '');
  const fromEnv = String(env.DOTNET_ROOT || env.DOTNET_ROOT_ARM64 || '').trim();
  if (fromEnv && fs.existsSync(fromEnv)) return fromEnv;

  const prefix = String(env.PREFIX || '').trim();
  const prefixRoot = prefix ? path.join(prefix, 'lib', 'dotnet') : '';
  if (prefixRoot && fs.existsSync(prefixRoot)) return prefixRoot;

  try {
    const dotnet = options.dotnetCommand || commandExists('dotnet') || '';
    if (dotnet) {
      const real = fs.realpathSync(dotnet);
      const root = path.resolve(path.dirname(real), '..', 'lib', 'dotnet');
      if (fs.existsSync(root)) return root;
    }
  } catch {}
  return '';
}

module.exports = {
  getInstalledDotnetRuntimeVersions,
  getInstalledDotnetSdkVersions,
  resolveDotnetRoot,
};
