'use strict';

function decodeHtml(value) {
  return String(value || '')
    .replace(/&quot;|&#34;|&#x22;/gi, '"')
    .replace(/&#39;|&#x27;|&apos;/gi, "'")
    .replace(/&amp;|&#38;|&#x26;/gi, '&')
    .replace(/&lt;|&#60;|&#x3c;/gi, '<')
    .replace(/&gt;|&#62;|&#x3e;/gi, '>')
    .replace(/&nbsp;|&#160;/gi, ' ');
}

function cleanPersonaName(value) {
  const text = decodeHtml(String(value || '').replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || /^\d{15,20}$/.test(text)) return '';
  if (/^(?:view\s+profile|steam\s+community|profile|好友|friend)$/i.test(text)) return '';
  return text.slice(0, 80);
}

function parseFriendFavoriteNames(html) {
  const source = String(html || '');
  const candidates = [];
  const add = (value) => {
    const name = cleanPersonaName(value);
    if (name && !candidates.includes(name)) candidates.push(name);
  };

  const blocks = [];
  const blockRe = /<[^>]+class=["'][^"']*(?:friend_favorited_block|hover_friend_block|friendBlock_(?:offline|online|in-game|ignored))[^"']*["'][^>]*>[\s\S]{0,1800}?(?=<[^>]+class=["'][^"']*(?:friend_favorited_block|hover_friend_block|friendBlock_(?:offline|online|in-game|ignored))|$)/gi;
  for (const match of source.matchAll(blockRe)) blocks.push(match[0]);
  const scan = blocks.length ? blocks : [source];

  for (const block of scan) {
    for (const match of block.matchAll(/\b(?:data-personaname|data-persona-name|title|aria-label)=["']([^"']+)["']/gi)) add(match[1]);
    for (const match of block.matchAll(/<img\b[^>]*\balt=["']([^"']+)["'][^>]*>/gi)) add(match[1]);
    for (const match of block.matchAll(/<a\b[^>]*href=["'][^"']*steamcommunity\.com\/(?:profiles|id)\/[^"']+["'][^>]*>([\s\S]*?)<\/a>/gi)) add(match[1]);
    for (const match of block.matchAll(/<[^>]+class=["'][^"']*(?:friend_name|persona_name|linkFriend)[^"']*["'][^>]*>([\s\S]*?)<\/[^>]+>/gi)) add(match[1]);
  }
  return candidates.slice(0, 6);
}

function parseFriendFavoriteSteamIds(payload) {
  let parsed;
  try { parsed = typeof payload === 'string' || Buffer.isBuffer(payload) ? JSON.parse(String(payload)) : payload; }
  catch { return []; }
  const source = Array.isArray(parsed)
    ? parsed
    : (Array.isArray(parsed && parsed.response) ? parsed.response
      : (Array.isArray(parsed && parsed.results) ? parsed.results
        : (Array.isArray(parsed && parsed.data) ? parsed.data : [])));
  const out = [];
  const seen = new Set();
  for (const entry of source) {
    const steamid = String(entry && typeof entry === 'object'
      ? (entry.steamid || entry.steam_id || entry.id || '')
      : entry || '').replace(/[^\d]/g, '');
    if (!/^7656119\d{10}$/.test(steamid) || seen.has(steamid)) continue;
    seen.add(steamid);
    out.push(steamid);
  }
  return out.slice(0, 20);
}

function buildPersonalSourceLabel(filter, options = {}) {
  const key = String(filter || '').trim().toLowerCase();
  const author = cleanPersonaName(options.author || '');
  const names = Array.from(new Set((options.names || []).map(cleanPersonaName).filter(Boolean)));
  if (key === 'myfavorites') return '我的收藏';
  if (key === 'voted') return '我的投票';
  if (key === 'friendsfavorites') {
    const shown = names.slice(0, 3);
    if (!shown.length) return '好友收藏';
    return `好友 ${shown.join('、')}${names.length > shown.length ? ' 等' : ''} 收藏`;
  }
  if (key === 'friendscreated') return author ? `好友 ${author} 创建` : '好友创建';
  if (key === 'followedcreated') return author ? `关注者 ${author} 创建` : '关注者创建';
  return '';
}

module.exports = {
  parseFriendFavoriteNames,
  parseFriendFavoriteSteamIds,
  buildPersonalSourceLabel,
};
