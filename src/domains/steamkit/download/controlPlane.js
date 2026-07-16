'use strict';

function parseWallhubCdnHostLine(text) {
  const match = String(text || '').match(/WALLHUB_DEPOT_CDN_HOST:(\{[^\r\n]+\})/);
  if (!match) return null;
  try {
    const data = JSON.parse(match[1]);
    const host = String(data.host || data.vhost || '').trim();
    if (!host) return null;
    return { host, vhost: String(data.vhost || '').trim(), port: Number(data.port || 0) };
  } catch {
    return null;
  }
}

function classifySteamKitControlPlaneOutput(chunk) {
  const text = String(chunk || '');
  const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
  let latest = null;
  for (const line of lines) {
    let match = line.match(/WALLHUB_DEPOT_BOOTSTRAP:(\S+)/);
    if (match) {
      latest = {
        key: `depot-bootstrap:${match[1]}`,
        stage: 'SteamKit 下载器进程已进入 DepotDownloader Main',
        detail: match[1],
      };
      continue;
    }

    match = line.match(/WALLHUB_STEAM3_RESOLVER_BRIDGE_FAILED:([^:]+):(.+)/);
    if (match) {
      latest = {
        key: `resolver-bridge-failed:${match[1]}`,
        stage: `SteamKit WebAPI 路由桥失败：${match[1]}`,
        detail: match[2],
        level: 'warn',
      };
      continue;
    }

    match = line.match(/WALLHUB_STEAM3_API_BROKER_DISABLED:(.+)/);
    if (match) {
      latest = {
        key: `api-broker-disabled:${match[1]}`,
        stage: 'SteamKit WallHub WebAPI 优质连接代理未启用，正在回退直连',
        detail: match[1],
        level: 'warn',
      };
      continue;
    }

    match = line.match(/WALLHUB_STEAM3_API_BROKER_REQUIRED:(.+)/);
    if (match) {
      latest = {
        key: `api-broker-required:${match[1]}`,
        stage: 'SteamKit 已启用 WallHub WebAPI 优质连接代理',
        detail: match[1],
      };
      continue;
    }

    match = line.match(/WALLHUB_STEAM3_API_BROKER_FAILED:([^:]+):(.+)/);
    if (match) {
      latest = {
        key: `api-broker-failed:${match[1]}`,
        stage: `SteamKit WallHub WebAPI 优质连接代理失败：${match[1]}`,
        detail: match[2],
        level: 'warn',
      };
      continue;
    }

    match = line.match(/WALLHUB_STEAM3_API_BROKER:([^:]+):(.+)/);
    if (match) {
      latest = {
        key: `api-broker:${match[1]}`,
        stage: `SteamKit 正在通过 WallHub 优质连接访问 Steam WebAPI：${match[1]}`,
        detail: match[2],
      };
      continue;
    }

    match = line.match(/WALLHUB_STEAM3_API_CONNECT_FAILED:([^>]+)->([^:]+):(\d+):(.+)/);
    if (match) {
      latest = {
        key: `api-connect-failed:${match[1]}:${match[2]}:${match[3]}`,
        stage: `SteamKit WebAPI 连接失败：${match[1]} -> ${match[2]}:${match[3]}`,
        detail: match[4],
        level: 'warn',
        event: 'api-connect-failed',
        host: match[1],
        ip: match[2],
        port: Number(match[3] || 0),
      };
      continue;
    }

    match = line.match(/WALLHUB_STEAM3_API_CONNECT:([^>]+)->([^:]+):(\d+)/);
    if (match) {
      latest = {
        key: `api-connect:${match[1]}:${match[2]}:${match[3]}`,
        stage: `SteamKit 正在连接 Steam WebAPI：${match[1]} -> ${match[2]}:${match[3]}`,
      };
      continue;
    }

    match = line.match(/WALLHUB_STEAM3_RESOLVE:([^>]+)->([^\s]+)/);
    if (match) {
      const ips = match[2].split(',').filter(Boolean).length;
      latest = {
        key: `api-resolve:${match[1]}`,
        stage: `SteamKit 已获取 Steam WebAPI 路由：${match[1]}`,
        detail: ips ? `${ips} 个候选 IP` : '',
      };
      continue;
    }

    match = line.match(/WALLHUB_STEAM3_PROTOCOL:(\S+)/);
    if (match) {
      latest = {
        key: `steam3-protocol:${match[1]}`,
        stage: `SteamKit 正在使用 ${match[1]} 连接 Steam3`,
      };
      continue;
    }

    const cdn = parseWallhubCdnHostLine(line);
    if (cdn) {
      latest = {
        key: `cdn:${cdn.host}:${cdn.port || 0}`,
        stage: `SteamKit 已获取 SteamPipe CDN，正在连接 ${cdn.host}${cdn.port ? `:${cdn.port}` : ''}`,
      };
      continue;
    }

    match = line.match(/CDN manifest retry\s+(\d+)\/(\d+)\s+failed on\s+([^:]+):\s*(.+)/i);
    if (match) {
      latest = {
        key: `manifest-retry:${match[1]}:${match[3]}`,
        stage: `SteamKit Manifest 下载重试 ${match[1]}/${match[2]}：${match[3]}`,
        detail: match[4],
        level: 'warn',
      };
      continue;
    }

    if (/Validating\s+(?:file|workshop)|Checking\s+local\s+file|Verifying\s+(?:file|workshop)/i.test(line)) {
      latest = { key: 'resume-validation', stage: 'SteamKit 正在校验本地文件并计算可续传分块' };
    } else if (/Pre-allocating\s+file/i.test(line)) {
      latest = { key: 'resume-validation', stage: 'SteamKit 正在准备本地文件并校验续传数据' };
    } else if (/Connecting to Steam3/i.test(line)) {
      latest = { key: 'steam3-connect', stage: 'SteamKit 正在连接 Steam3 CM' };
    } else if (/Logging\s+['"].+['"]\s+into Steam3/i.test(line)) {
      latest = { key: 'steam3-login', stage: 'SteamKit 正在登录 Steam3' };
    } else if (/Got\s+\d+\s+licenses/i.test(line)) {
      latest = { key: 'steam3-licenses', stage: 'SteamKit 已登录 Steam3，正在读取账号许可' };
    } else if (/Got\s+AppInfo/i.test(line)) {
      latest = { key: 'appinfo', stage: 'SteamKit 已获取 AppInfo，正在解析工坊 Depot/Manifest' };
    } else if (/Downloading\s+depot\s+manifest|Downloading\s+manifest/i.test(line)) {
      latest = { key: 'manifest-download', stage: 'SteamKit 正在下载 Depot Manifest' };
    } else if (/Downloading\s+depot|Downloading\s+file|Downloading\s+chunk/i.test(line)) {
      latest = { key: 'content-download', stage: 'SteamKit 正在下载文件内容' };
    }
  }
  return latest;
}

module.exports = { classifySteamKitControlPlaneOutput };
