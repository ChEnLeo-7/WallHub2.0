'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { createSteamProxyRewriteTools } = require('./rewrite');

function createTools() {
  return createSteamProxyRewriteTools({
    isSteamHost(hostname) {
      const host = String(hostname || '').toLowerCase();
      return host === 'steamcommunity.com' ||
        host.endsWith('.steamcommunity.com') ||
        host === 'store.steampowered.com' ||
        host.endsWith('.store.steampowered.com') ||
        host === 'steambroadcast.akamaized.net' ||
        host === 'steambroadcast-test.akamaized.net' ||
        host === 'steambroadcastchat.akamaized.net' ||
        host.endsWith('.steamcontent.com') ||
        host === 'broadcast.st.dl.eccdnx.com' ||
        host === 'lv.queniujq.cn' ||
        host.endsWith('.steamstatic.com') ||
        host.endsWith('.steamusercontent.com');
    },
    isSteamCommunityHost(hostname) {
      const host = String(hostname || '').toLowerCase();
      return host === 'steamcommunity.com' || host.endsWith('.steamcommunity.com');
    },
  });
}

test('Workshop tag constants load with legacy CommonJS semantics', () => {
  const args = [];
  if (process.allowedNodeEnvironmentFlags.has('--no-experimental-require-module')) {
    args.push('--no-experimental-require-module');
  }
  args.push('-e', `require(${JSON.stringify(path.join(__dirname, 'rewrite', 'workshopTags.js'))})`);

  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('proxy rewrites Steam Workshop tag links to virtual community paths', () => {
  const tools = createTools();
  const html = '<a href="https://steamcommunity.com/workshop/browse/?appid=431960&requiredtags[]=Video">Video</a>';
  const out = tools.rewriteWallhubProxyHtml(html, 'https://steamcommunity.com/app/431960/workshop/');

  assert.match(out, /href="\/workshop\/browse\/\?appid=431960&requiredtags%5B%5D=Video&__whp_host=steamcommunity\.com"/);
  assert.doesNotMatch(out, /\/url\/proxy\/\?url=/);
});

test('proxy rewrites relative Workshop links inside Steam community virtual pages', () => {
  const tools = createTools();
  const html = '<a href="/workshop/browse/?appid=431960&browsesort=trend">Trend</a>';
  const out = tools.rewriteWallhubProxyHtml(html, 'https://steamcommunity.com/app/431960/workshop/');

  assert.match(out, /href="\/workshop\/browse\/\?appid=431960&browsesort=trend&__whp_host=steamcommunity\.com"/);
});

test('runtime proxy intercepts dynamically assigned Workshop tag anchors before native navigation', () => {
  const tools = createTools();
  const script = tools.wallhubProxyClientScript('https://steamcommunity.com/app/431960/workshop/');

  assert.match(script, /rewriteSteamAnchorOnClick/);
  assert.match(script, /event\.preventDefault\(\)/);
  assert.doesNotThrow(() => new Function(script.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '')));
});

test('proxy builds a virtual Community Browse URL for Workshop tag buttons without native navigation', () => {
  const tools = createTools();

  assert.equal(
    tools.wallhubWorkshopTagBrowsePath('Abstract', 'https://steamcommunity.com/app/431960/workshop/'),
    '/workshop/browse/?appid=431960&requiredtags%5B%5D=Abstract&__whp_host=steamcommunity.com'
  );
  assert.equal(
    tools.wallhubWorkshopTagBrowsePath('Wallpaper', 'https://steamcommunity.com/app/431960/workshop/'),
    '/workshop/browse/?appid=431960&requiredtags%5B%5D=Wallpaper&__whp_host=steamcommunity.com'
  );
  assert.equal(tools.wallhubWorkshopTagBrowsePath('not-a-workshop-tag', 'https://steamcommunity.com/app/431960/workshop/'), '');
});

test('proxy builds virtual Community Browse paths for Workshop dropdown filter selections', () => {
  const tools = createTools();

  assert.equal(
    tools.wallhubWorkshopFilterBrowsePath('3840 x 2160 (470,597)', 'https://steamcommunity.com/app/431960/workshop/'),
    '/workshop/browse/?appid=431960&requiredtags%5B%5D=3840+x+2160&__whp_host=steamcommunity.com'
  );
  assert.equal(
    tools.wallhubWorkshopFilterBrowsePath('<未选择>', 'https://steamcommunity.com/app/431960/workshop/'),
    '/app/431960/workshop/?__whp_host=steamcommunity.com'
  );
});

test('proxy rewrites Steam broadcast iframe/video hosts through URL proxy', () => {
  const tools = createTools();
  const html = '<iframe src="https://steambroadcast.akamaized.net/broadcast/123/master.m3u8"></iframe>';
  const out = tools.rewriteWallhubProxyHtml(html, 'https://steamcommunity.com/broadcast/watch/123');

  assert.match(out, /src="\/url\/proxy\/\?url=https%3A%2F%2Fsteambroadcast\.akamaized\.net%2Fbroadcast%2F123%2Fmaster\.m3u8"/);
});

test('proxy canonicalizes Steam Fastly static asset hosts to the working Akamai alias', () => {
  const tools = createTools();
  const html = '<script src="https://community.fastly.steamstatic.com/public/shared/javascript/dash_player.js?v=test"></script>';
  const out = tools.rewriteWallhubProxyHtml(html, 'https://steamcommunity.com/broadcast/watch/123');

  assert.match(out, /url=https%3A%2F%2Fcommunity\.akamai\.steamstatic\.com%2Fpublic%2Fshared%2Fjavascript%2Fdash_player\.js/);
  assert.doesNotMatch(out, /community\.fastly\.steamstatic\.com/);
});

test('broadcast JSON and runtime client include real Steam API, video and chat distribution hosts', () => {
  const tools = createTools();
  const target = new URL('https://steamcommunity.com/broadcast/getbroadcastmpd/');
  const json = JSON.stringify({
    hls_url: 'https://cache1-sgp1.steamcontent.com/broadcast/123/master.m3u8',
    chat_url: 'https://steambroadcastchat.akamaized.net/chat/123/messages/0',
  });

  assert.equal(tools.shouldRewriteWallhubProxyText(json, 'application/json', target), true);
  assert.match(tools.rewriteWallhubProxyJsonText(json, target.toString()), /\/url\/proxy\/\?url=/);

  const script = tools.wallhubProxyClientScript(target.toString());
  assert.match(script, /'steam-api\.com'/);
  assert.match(script, /'steambroadcast\.akamaized\.net'/);
  assert.match(script, /'steambroadcastchat\.akamaized\.net'/);
  assert.doesNotMatch(script, /'akamaized\.net'/);
});

test('broadcast JSON rewrites dynamic media hosts while preserving Steam chat cursor templates', () => {
  const tools = createTools();
  const target = new URL('https://steamcommunity.com/broadcast/getbroadcastmpd/');
  const out = tools.rewriteWallhubProxyJsonText(JSON.stringify({
    media_url: 'https://lv.queniujq.cn/broadcast/123/manifest/',
    view_url_template: 'https://steambroadcastchat.akamaized.net/chat/123/messages/{0}?chat_origin=test',
  }), target.toString());

  assert.match(out, /\/url\/proxy\/\?url=https%3A%2F%2Flv\.queniujq\.cn/);
  assert.match(out, /messages%2F\{0\}/);
  assert.doesNotMatch(out, /%25?7B0%25?7D/i);
});

test('broadcast DASH rewrite keeps segment placeholder tokens unescaped for Steam player substitution', () => {
  const tools = createTools();
  const target = new URL('https://cache8-hkg1.steamcontent.com/broadcast/123/manifest/0/cache8-hkg1.steamcontent.com/');
  const xml = '<MPD><Period><AdaptationSet><SegmentTemplate media="/broadcast/123/segment/video/$RepresentationID$/$Number$/?broadcast_origin=test" initialization="/broadcast/123/segment/video/$RepresentationID$/init/?broadcast_origin=test" /></AdaptationSet></Period></MPD>';
  const out = tools.rewriteWallhubProxyMediaManifest(xml, target.toString());

  assert.match(out, /\$RepresentationID\$/);
  assert.match(out, /\$Number\$/);
  assert.doesNotMatch(out, /%24(?:RepresentationID|Number)%24/i);
});

test('broadcast DASH rewrite also restores percent-encoded segment placeholder tokens from upstream', () => {
  const tools = createTools();
  const target = new URL('https://cache8-hkg1.steamcontent.com/broadcast/123/manifest/0/cache8-hkg1.steamcontent.com/');
  const xml = '<MPD><Period><AdaptationSet><SegmentTemplate media="/broadcast/123/segment/video/%24RepresentationID%24/%24Number%24/?broadcast_origin=test" /></AdaptationSet></Period></MPD>';
  const out = tools.rewriteWallhubProxyMediaManifest(xml, target.toString());

  assert.match(out, /\$RepresentationID\$/);
  assert.match(out, /\$Number\$/);
  assert.doesNotMatch(out, /%24(?:RepresentationID|Number)%24/i);
});

test('extensionless broadcast DASH XML is selected for media manifest rewrite', () => {
  const tools = createTools();
  const target = new URL('https://lv.queniujq.cn/broadcast/123/manifest/0/origin/');
  const xml = '<MPD><Period><AdaptationSet><SegmentTemplate media="chunk-$Number$.m4s" /></AdaptationSet></Period></MPD>';

  assert.equal(tools.shouldRewriteWallhubProxyText(xml, 'application/xml', target), true);
  assert.match(tools.rewriteWallhubProxyMediaManifest(xml, target.toString()), /\/url\/proxy\/\?url=/);
});
