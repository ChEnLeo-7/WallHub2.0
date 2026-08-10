'use strict';

function makeDepotLoginId(seed) {
  const input = `${process.pid}:${Date.now()}:${String(seed || '')}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index++) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return String(hash >>> 0);
}

function parseVersionParts(version) {
  const parts = String(version || '').split('.').map(value => parseInt(value, 10));
  return {
    major: Number.isFinite(parts[0]) ? parts[0] : 0,
    minor: Number.isFinite(parts[1]) ? parts[1] : 0,
    patch: Number.isFinite(parts[2]) ? parts[2] : 0,
  };
}

function formatMajorMinor(version) {
  const parsed = parseVersionParts(version);
  return `${parsed.major}.${parsed.minor}`;
}

function dotnetRuntimeSatisfies(required, installedVersions) {
  if (!required) return true;
  const req = parseVersionParts(required);
  return (installedVersions || []).some(version => {
    const got = parseVersionParts(version);
    return got.major === req.major &&
      got.minor === req.minor &&
      got.patch >= req.patch;
  });
}

function dotnetMajorInstalled(installedVersions, major) {
  const want = parseInt(major, 10);
  return (installedVersions || []).some(version => parseVersionParts(version).major === want);
}

function hexBytesFromMb(mb, fallbackMb = 256) {
  const parsed = parseInt(String(mb || '').trim(), 10);
  const value = Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackMb;
  const safeMb = Math.max(64, Math.min(2048, value));
  return (safeMb * 1024 * 1024).toString(16);
}

function parseWallhubDepotProgress(text) {
  const matches = [...String(text || '').matchAll(/WALLHUB_DEPOT_JSON_PROGRESS:(\{[^\r\n]+\})/g)];
  if (!matches.length) return null;
  return parseWallhubDepotProgressJson(matches[matches.length - 1][1]);
}

function parseWallhubDepotProgressJson(json) {
  try {
    const data = JSON.parse(json);
    const downloaded = Number(data.downloaded || 0);
    const total = Number(data.total || 0);
    const hasNetworkDownloaded = Object.prototype.hasOwnProperty.call(data, 'networkDownloaded');
    const networkDownloaded = hasNetworkDownloaded ? Number(data.networkDownloaded || 0) : NaN;
    const percent = Number(data.percent || 0);
    const speed = Number(data.speed || 0);
    if (!Number.isFinite(downloaded) || !Number.isFinite(total) || total <= 0) return null;
    return {
      downloaded: Math.max(0, Math.floor(downloaded)),
      total: Math.max(0, Math.floor(total)),
      networkDownloaded: Number.isFinite(networkDownloaded) ? Math.max(0, Math.floor(networkDownloaded)) : null,
      percent: Number.isFinite(percent) ? percent : (downloaded / total) * 100,
      speed: Number.isFinite(speed) ? Math.max(0, speed) : 0,
    };
  } catch {
    return null;
  }
}

function createWallhubDepotProgressReader() {
  let pending = '';
  return (chunk) => {
    pending = `${pending}${String(chunk || '')}`;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() || '';
    let latest = null;
    for (const line of lines) {
      const match = line.match(/WALLHUB_DEPOT_JSON_PROGRESS:(\{.+\})/);
      if (!match) continue;
      const parsed = parseWallhubDepotProgressJson(match[1]);
      if (parsed) latest = parsed;
    }
    if (pending.length > 16000) pending = pending.slice(-4000);
    return latest;
  };
}

function stripWallhubDiagnosticOutput(text) {
  return String(text || '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .split(/\r?\n/)
    .map(line => line
      .replace(/\bWALLHUB_[A-Z0-9_]+:[^\r\n]*?(?=\s+WALLHUB_[A-Z0-9_]+:|$)/g, '')
      .trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

function cleanProcessLineForStage(text) {
  return stripWallhubDiagnosticOutput(text)
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean)
    .slice(-1)[0] || '';
}

function isDepotAuthFailureMessage(message) {
  return /two[- ]?factor|2fa|steam guard|authenticator|authentication code|mobile|password|credentials|incorrect|invalid login|invalidpassword|logon denied|login failed|unable to login|accountlogondenied|invalidloginauthcode/i.test(String(message || ''));
}

function isDepotGuardRequiredMessage(message) {
  return /steam guard!|this account is protected by steam guard|accountlogondenied|accountlogindeniedneedtwofactor|invalidloginauthcode|twofactorcodemismatch|please enter (?:(?:your|the) )?(?:2[- ]?factor|two[- ]?factor|authentication) (?:auth )?code|auth code sent to (?:your )?email|steam (?:mobile app|guard).*?(?:confirm|approval|approve)|(?:confirm|approval|approve).*?steam (?:mobile app|guard)/i.test(String(message || ''));
}

function isDepotNetworkFailureMessage(message) {
  return /timed? out|timeout|请求超时|curl:\s*\((5|6|7|28|35|52|56)\)|could not resolve|failed to connect|unable to connect|connectfailed|no\s*connection|not connected|disconnected from steam|connection\s+(timed out|refused|reset|failed|closed|aborted)|failed to establish (?:a )?connection|unable to establish (?:a )?connection|serviceunavailable|socketexception|httprequestexception|proxy connect|no route to host|network.*unreachable|host.*unreachable|name or service not known|temporary failure|steam.*unreachable|(?:the operation|a task) was cancel(?:ed|led)/i.test(String(message || ''));
}

function isDepotLoginVerifiedDespiteCanceled(message) {
  const text = String(message || '');
  return (
    /A task was canceled|task.*cancel/i.test(text) &&
    (/Logging\s+['"].+['"]\s+into Steam3\.\.\.\s+Done!/i.test(text) ||
      /Success!\s+Next time you can login with -username\s+\S+\s+-remember-password/i.test(text)) &&
    /Got\s+\d+\s+licenses\s+for account/i.test(text) &&
    /Got\s+AppInfo\s+for\s+\d+/i.test(text) &&
    !isDepotAuthFailureMessage(text)
  );
}

module.exports = {
  makeDepotLoginId,
  parseVersionParts,
  formatMajorMinor,
  dotnetRuntimeSatisfies,
  dotnetMajorInstalled,
  hexBytesFromMb,
  parseWallhubDepotProgress,
  parseWallhubDepotProgressJson,
  createWallhubDepotProgressReader,
  cleanProcessLineForStage,
  stripWallhubDiagnosticOutput,
  isDepotAuthFailureMessage,
  isDepotGuardRequiredMessage,
  isDepotNetworkFailureMessage,
  isDepotLoginVerifiedDespiteCanceled,
};
