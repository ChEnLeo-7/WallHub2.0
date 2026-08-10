'use strict';

const prelude = require('./clientScriptFragments/prelude');
const runtimeHooks = require('./clientScriptFragments/runtimeHooks');
const storeHighlight = require('./clientScriptFragments/storeHighlight');

function wallhubProxyClientScript(options = {}, baseUrl = '') {
  const virtualHostParam = options.virtualHostParam || '__whp_host';
  const workshopCommunityTags = options.workshopCommunityTags || new Set();
  const runtimePrelude = prelude
    .replace('__WALLHUB_PAGE_TARGET__', JSON.stringify(String(baseUrl || '')))
    .replace('__WALLHUB_VIRTUAL_HOST_PARAM__', JSON.stringify(virtualHostParam))
    .replace('__WALLHUB_WORKSHOP_TAGS__', JSON.stringify(Array.from(workshopCommunityTags)));
  return `<script data-wallhub-url-proxy="1">
${runtimePrelude}${runtimeHooks}${storeHighlight}</script>`;
}

module.exports = { wallhubProxyClientScript };
