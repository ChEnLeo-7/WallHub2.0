'use strict';

const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const assert = require('node:assert/strict');

const textSource = fs.readFileSync(
  path.resolve(__dirname, '../../frontend/src/lib/text.ts'),
  'utf8',
);

test('download proxy settings identify HTTP(S)/SOCKS5 proxy behavior in both languages', () => {
  assert.match(textSource, /steamCdnRoute: 'HTTP\(S\)\/SOCKS5 代理'/);
  assert.ok(textSource.includes("steamKitDepotStreamingDesc: '实验性：对 depot/chunk 视频项目尝试按需读取 Steam 分块并在线播放；连接设置跟随 HTTP(S)/SOCKS5 代理，并发跟随 SteamKit 单项目下载并发。'"));
  assert.match(textSource, /steamCdnRoute: 'HTTP\(S\)\/SOCKS5 proxy'/);
  assert.ok(textSource.includes("steamKitDepotStreamingDesc: 'Experimental: try on-demand Steam depot/chunk streaming for video playback. It follows the HTTP(S)/SOCKS5 proxy setting and SteamKit per-item concurrency settings.'"));
});
