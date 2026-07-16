'use strict';

const { execFileSync } = require('child_process');
const net = require('net');
const { URL } = require('url');
const { normalizeProxyInput } = require('../../config/normalizers');
const { isTermuxLikeEnv } = require('../../config/platform');

function parseProxyUrl(raw) {
  if (!raw) return null;
  let value = normalizeProxyInput(raw);
  if (!value) return null;
  if (/^(https?|socks4a?|socks5h?)$/i.test(value)) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(value)) value = `http://${value}`;
  try {
    const parsed = new URL(value);
    if (!parsed.hostname) return null;
    const protocol = (parsed.protocol || 'http:').toLowerCase();
    return {
      protocol,
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : (protocol === 'https:' ? 443 : (isSocksProxyProtocol(protocol) ? 1080 : 80)),
      username: decodeURIComponent(parsed.username || ''),
      password: decodeURIComponent(parsed.password || ''),
    };
  } catch {
    return null;
  }
}

function isSocksProxyProtocol(protocol) {
  return /^socks(?:4a?|5h?)?:$/i.test(String(protocol || ''));
}

function isSocks5ProxyProtocol(protocol) {
  return /^socks5h?:$/i.test(String(protocol || ''));
}

function parseWinProxyServer(raw, protocol) {
  const value = String(raw || '').trim();
  if (!value) return null;
  const map = {};
  for (const segment of value.split(';').map(s => s.trim()).filter(Boolean)) {
    const match = segment.match(/^([^=]+)=(.+)$/);
    if (match) map[match[1].toLowerCase()] = match[2].trim();
  }
  const key = protocol === 'https:' ? 'https' : 'http';
  const pick = map[key] || map.http || map.https || (Object.keys(map).length ? '' : value);
  return parseProxyUrl(pick);
}

function readWindowsSystemProxy(protocol) {
  if (process.platform !== 'win32') return null;
  try {
    const enable = execFileSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyEnable'],
      { encoding: 'utf8' }
    );
    if (!/\b0x1\b/i.test(enable)) return null;
    const server = execFileSync(
      'reg.exe',
      ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', 'ProxyServer'],
      { encoding: 'utf8' }
    );
    const match = server.match(/ProxyServer\s+REG_\w+\s+([^\r\n]+)/i);
    return match ? parseWinProxyServer(match[1], protocol) : null;
  } catch {
    return null;
  }
}

function readLinuxSystemProxy(protocol) {
  if (process.platform !== 'linux') return null;
  try {
    const isHttps = protocol === 'https:';
    const proxyEnv = isHttps
      ? (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy)
      : (process.env.HTTP_PROXY || process.env.http_proxy);

    if (proxyEnv) return parseProxyUrl(proxyEnv);
    if (isTermuxLikeEnv() || !process.env.DBUS_SESSION_BUS_ADDRESS) return null;

    const gsettings = execFileSync('which', ['gsettings'], { encoding: 'utf8', stdio: 'pipe' }).trim();
    if (!gsettings) return null;
    try {
      const mode = execFileSync('gsettings', ['get', 'org.gnome.system.proxy', 'mode'], { encoding: 'utf8' }).trim();
      if (!mode.includes('manual')) return null;
      const httpHost = execFileSync('gsettings', ['get', 'org.gnome.system.proxy.http', 'host'], { encoding: 'utf8' }).trim().replace(/['"]/g, '');
      const httpPort = parseInt(execFileSync('gsettings', ['get', 'org.gnome.system.proxy.http', 'port'], { encoding: 'utf8' }).trim(), 10) || 8080;
      if (httpHost && httpPort) return parseProxyUrl(`http://${httpHost}:${httpPort}`);
    } catch {}
    return null;
  } catch {
    return null;
  }
}

function resolveProxyForProtocol(protocol) {
  if (isTermuxLikeEnv() || process.platform === 'android') return null;
  const isHttps = protocol === 'https:';
  const envRaw = isHttps
    ? (process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY || process.env.all_proxy || '')
    : (process.env.HTTP_PROXY || process.env.http_proxy || process.env.ALL_PROXY || process.env.all_proxy || '');
  return parseProxyUrl(envRaw) || readWindowsSystemProxy(protocol) || readLinuxSystemProxy(protocol);
}

function proxyAuth(proxy) {
  if (!proxy || !proxy.username) return '';
  const token = Buffer.from(`${proxy.username}:${proxy.password || ''}`, 'utf8').toString('base64');
  return `Basic ${token}`;
}

function formatProxyUrl(proxy) {
  if (!proxy || !proxy.hostname) return '';
  const auth = proxy.username
    ? `${encodeURIComponent(proxy.username)}:${encodeURIComponent(proxy.password || '')}@`
    : '';
  const protocol = String(proxy.protocol || 'http:').replace(/:$/, '') || 'http';
  const port = proxy.port || (protocol === 'https' ? 443 : (isSocksProxyProtocol(`${protocol}:`) ? 1080 : 80));
  return `${protocol}://${auth}${proxy.hostname}:${port}`;
}

function formatProxyHostPort(proxy) {
  if (!proxy || !proxy.hostname) return '';
  const host = String(proxy.hostname || '');
  const wrappedHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const port = proxy.port || (isSocksProxyProtocol(proxy.protocol) ? 1080 : 80);
  return `${wrappedHost}:${port}`;
}

function appendCurlProxyArgs(args, proxy) {
  if (!proxy || !proxy.hostname) return;
  const protocol = String(proxy.protocol || 'http:').toLowerCase();
  if (isSocksProxyProtocol(protocol)) {
    const hostPort = formatProxyHostPort(proxy);
    if (!hostPort) return;
    if (proxy.username) args.push('--proxy-user', `${proxy.username}:${proxy.password || ''}`);
    if (protocol === 'socks5h:') args.push('--socks5-hostname', hostPort);
    else if (protocol === 'socks5:') args.push('--socks5', hostPort);
    else if (protocol === 'socks4a:') args.push('--socks4a', hostPort);
    else args.push('--socks4', hostPort);
    return;
  }
  args.push('--proxy', formatProxyUrl(proxy));
}

function proxyKey(proxy) {
  if (!proxy) return 'direct';
  return `${proxy.protocol || 'http:'}|${proxy.hostname}|${proxy.port || 80}|${proxy.username || ''}|${proxy.password || ''}`;
}

function shouldRetryWithNextProxy(err) {
  if (!err) return false;
  if (err.code && ['ECONNREFUSED', 'ETIMEDOUT', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'EPROTO'].includes(err.code)) return true;
  const message = String(err.message || '');
  return /Proxy CONNECT|ECONNREFUSED|ETIMEDOUT|socket hang up|curl:\s*\(28\)|Operation timed out/i.test(message);
}

function encodeSocksHost(hostname) {
  const host = String(hostname || '');
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return { atyp: 0x01, data: Buffer.from(host.split('.').map(v => parseInt(v, 10) & 0xff)) };
  }
  const data = Buffer.from(host, 'utf8');
  if (data.length > 255) throw new Error('SOCKS host name is too long');
  return { atyp: 0x03, data: Buffer.concat([Buffer.from([data.length]), data]) };
}

function socksReplyMessage(code) {
  return ({
    0x01: 'general failure',
    0x02: 'connection not allowed',
    0x03: 'network unreachable',
    0x04: 'host unreachable',
    0x05: 'connection refused',
    0x06: 'TTL expired',
    0x07: 'command not supported',
    0x08: 'address type not supported',
  })[code] || `error ${code}`;
}

function readSocketBytes(socket, length, timeoutMs) {
  return new Promise((resolve, reject) => {
    let timer = null;
    const chunks = [];
    let total = 0;
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      socket.off('data', onData);
      socket.off('error', onError);
      socket.off('close', onClose);
    };
    const onError = (e) => { cleanup(); reject(e); };
    const onClose = () => { cleanup(); reject(new Error('SOCKS proxy closed connection')); };
    const onData = (chunk) => {
      chunks.push(chunk);
      total += chunk.length;
      if (total < length) return;
      cleanup();
      const buf = Buffer.concat(chunks, total);
      const wanted = buf.subarray(0, length);
      const rest = buf.subarray(length);
      if (rest.length) socket.unshift(rest);
      resolve(wanted);
    };
    timer = setTimeout(() => {
      cleanup();
      reject(new Error('SOCKS proxy timeout'));
    }, timeoutMs || 12000);
    socket.on('data', onData);
    socket.on('error', onError);
    socket.on('close', onClose);
  });
}

async function connectViaSocksProxy(proxy, targetHost, targetPort, timeoutMs) {
  const socket = net.connect({
    host: proxy.hostname,
    port: proxy.port || 1080,
    timeout: timeoutMs || 12000,
  });
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      socket.off('connect', onConnect);
      socket.off('error', onError);
      socket.off('timeout', onTimeout);
    };
    const onConnect = () => { cleanup(); resolve(); };
    const onError = (e) => { cleanup(); reject(e); };
    const onTimeout = () => {
      cleanup();
      socket.destroy();
      reject(new Error('SOCKS proxy timeout'));
    };
    socket.once('connect', onConnect);
    socket.once('error', onError);
    socket.once('timeout', onTimeout);
  });

  try {
    if (isSocks5ProxyProtocol(proxy.protocol)) {
      const methods = proxy.username ? Buffer.from([0x05, 0x02, 0x00, 0x02]) : Buffer.from([0x05, 0x01, 0x00]);
      socket.write(methods);
      const methodRes = await readSocketBytes(socket, 2, timeoutMs);
      if (methodRes[0] !== 0x05) throw new Error('Invalid SOCKS5 response');
      if (methodRes[1] === 0x02) {
        const user = Buffer.from(proxy.username || '', 'utf8');
        const pass = Buffer.from(proxy.password || '', 'utf8');
        if (user.length > 255 || pass.length > 255) throw new Error('SOCKS5 credentials are too long');
        socket.write(Buffer.concat([Buffer.from([0x01, user.length]), user, Buffer.from([pass.length]), pass]));
        const authRes = await readSocketBytes(socket, 2, timeoutMs);
        if (authRes[1] !== 0x00) throw new Error('SOCKS5 authentication failed');
      } else if (methodRes[1] !== 0x00) {
        throw new Error('SOCKS5 proxy requires unsupported authentication');
      }
      const host = encodeSocksHost(targetHost);
      const portBuf = Buffer.alloc(2);
      portBuf.writeUInt16BE(targetPort || 443, 0);
      socket.write(Buffer.concat([Buffer.from([0x05, 0x01, 0x00, host.atyp]), host.data, portBuf]));
      const head = await readSocketBytes(socket, 4, timeoutMs);
      if (head[0] !== 0x05) throw new Error('Invalid SOCKS5 connect response');
      if (head[1] !== 0x00) throw new Error(`SOCKS5 connect failed: ${socksReplyMessage(head[1])}`);
      const addrLen = head[3] === 0x01 ? 4 : head[3] === 0x04 ? 16 : head[3] === 0x03 ? (await readSocketBytes(socket, 1, timeoutMs))[0] : 0;
      if (!addrLen) throw new Error('Invalid SOCKS5 address type');
      await readSocketBytes(socket, addrLen + 2, timeoutMs);
      return socket;
    }

    const isSocks4a = String(proxy.protocol || '').toLowerCase() === 'socks4a:';
    const user = Buffer.from(proxy.username || '', 'utf8');
    const portBuf = Buffer.alloc(2);
    portBuf.writeUInt16BE(targetPort || 443, 0);
    let hostBuf;
    let domainTail = Buffer.alloc(0);
    if (!isSocks4a && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(String(targetHost || ''))) {
      hostBuf = Buffer.from(String(targetHost).split('.').map(v => parseInt(v, 10) & 0xff));
    } else {
      hostBuf = Buffer.from([0, 0, 0, 1]);
      domainTail = Buffer.concat([Buffer.from(String(targetHost || ''), 'utf8'), Buffer.from([0])]);
    }
    socket.write(Buffer.concat([Buffer.from([0x04, 0x01]), portBuf, hostBuf, user, Buffer.from([0]), domainTail]));
    const res = await readSocketBytes(socket, 8, timeoutMs);
    if (res[1] !== 0x5a) throw new Error(`SOCKS4 connect failed: ${socksReplyMessage(res[1])}`);
    return socket;
  } catch (e) {
    try { socket.destroy(); } catch {}
    throw e;
  }
}

module.exports = {
  parseProxyUrl,
  isSocksProxyProtocol,
  isSocks5ProxyProtocol,
  parseWinProxyServer,
  readWindowsSystemProxy,
  readLinuxSystemProxy,
  resolveProxyForProtocol,
  proxyAuth,
  formatProxyUrl,
  formatProxyHostPort,
  appendCurlProxyArgs,
  proxyKey,
  shouldRetryWithNextProxy,
  encodeSocksHost,
  socksReplyMessage,
  readSocketBytes,
  connectViaSocksProxy,
};
