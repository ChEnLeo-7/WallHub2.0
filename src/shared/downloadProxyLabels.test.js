'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const zhTextSource = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/lib/text/zh.ts'), 'utf8');
const enTextSource = fs.readFileSync(path.resolve(__dirname, '../../frontend/src/lib/text/en.ts'), 'utf8');

test('download proxy settings identify HTTP(S)/SOCKS5 proxy behavior in both languages', () => {
  assert.match(zhTextSource, /steamCdnRoute: 'HTTP\(S\)\/SOCKS5 代理'/);
  assert.ok(zhTextSource.includes("steamKitDepotStreamingDesc: '实验性：对 depot/chunk 视频项目按需读取 Steam 分块并在线播放；连接设置跟随 HTTP(S)/SOCKS5 代理，严格使用 SteamKit 单项目下载并发。'"));
  assert.match(enTextSource, /steamCdnRoute: 'HTTP\(S\)\/SOCKS5 proxy'/);
  assert.ok(enTextSource.includes("steamKitDepotStreamingDesc: 'Experimental: stream Steam depot/chunk video data on demand. It follows the HTTP(S)/SOCKS5 proxy setting and strictly uses the SteamKit per-item concurrency setting.'"));
});
