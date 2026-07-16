'use strict';

const { cleanText, looksLikeSteamId } = require('../workshop/text');

function createSteamPersonaService(options = {}) {
  const get = options.get;
  const logger = options.logger || console;
  const cache = new Map();

  async function resolveName(steamId) {
    const sid = String(steamId || '').trim();
    if (!looksLikeSteamId(sid)) return '';
    if (cache.has(sid)) return cache.get(sid);
    try {
      const html = (await get(`https://steamcommunity.com/profiles/${sid}/?xml=1`, {
        'Accept': 'application/xml,text/xml,*/*;q=0.8',
      }, 12000)).toString('utf8');
      const match = html.match(/<steamID><!\[CDATA\[([\s\S]*?)\]\]><\/steamID>/i) ||
        html.match(/<steamID>([\s\S]*?)<\/steamID>/i);
      const name = cleanText(match ? match[1] : '');
      cache.set(sid, name);
      return name;
    } catch (e) {
      if (process.env.WALLHUB_PERSONA_DEBUG === '1') {
        logger.warn(`[Persona] Failed to resolve ${sid}: ${e.message}`);
      }
      cache.set(sid, '');
      return '';
    }
  }

  function clear() {
    cache.clear();
  }

  return {
    resolveName,
    clear,
    cache,
  };
}

module.exports = {
  createSteamPersonaService,
};
