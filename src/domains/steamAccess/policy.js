'use strict';

const net = require('net');
const {
  edgeAliasForHost,
  edgeAliasesForHost,
  fixedSniForHost,
  hostProfile,
  requestBudgetForHost,
  shouldHttpProbeHost,
  shouldProbeSteamAccessIpv6,
} = require('./routes');

const FAKE_SNI_CANDIDATES = [
  'www.bing.com',
  'www.wikipedia.org',
  'api.github.com',
  'www.example.com',
];

const FAKE_SNI_BLOCKLIST = new Set([
  'google.com',
  'www.google.com',
  'youtube.com',
  'www.youtube.com',
  'twitter.com',
  'www.twitter.com',
  'facebook.com',
  'www.facebook.com',
  'instagram.com',
  'www.instagram.com',
  'telegram.org',
  'www.telegram.org',
]);

function normalizeHost(hostname) {
  return String(hostname || '').trim().toLowerCase();
}

function normalizeExperimental(value) {
  if (!value || typeof value !== 'object') return {};
  return Object.assign({}, value);
}

function isBlockedFakeSni(hostname) {
  const host = normalizeHost(hostname).replace(/^\.+/, '');
  if (!host) return true;
  if (FAKE_SNI_BLOCKLIST.has(host)) return true;
  return Array.from(FAKE_SNI_BLOCKLIST).some(blocked => host === blocked || host.endsWith(`.${blocked}`));
}

function normalizeFakeSniCandidates(value) {
  const list = Array.isArray(value) && value.length ? value : FAKE_SNI_CANDIDATES;
  const seen = new Set();
  const out = [];
  for (const item of list) {
    const host = normalizeHost(item);
    if (!host || seen.has(host) || isBlockedFakeSni(host) || net.isIP(host)) continue;
    seen.add(host);
    out.push(host);
  }
  return out.length ? out : FAKE_SNI_CANDIDATES.slice();
}

function pickFakeSniHostname(hostname, candidates = FAKE_SNI_CANDIDATES) {
  const safe = normalizeFakeSniCandidates(candidates);
  const seed = normalizeHost(hostname).split('').reduce((sum, ch) => sum + ch.charCodeAt(0), 0);
  return safe[seed % safe.length];
}

function buildSniStrategy(mode, hostname = '') {
  if (mode === 'fake') return { type: 'fake', mode: 'custom', hostname };
  if (mode === 'original') return { type: 'original', mode: 'original', hostname: '' };
  return { type: 'hidden', mode: 'hidden', hostname: '' };
}

function defaultSniStrategies(hostname, experimental = {}) {
  const fixed = fixedSniForHost(hostname);
  const fakeHostname = pickFakeSniHostname(hostname, experimental.fakeSniCandidates);
  const includeFake = !!experimental.fakeSniFallback;
  const host = normalizeHost(hostname);
  if (host === 'api.steampowered.com' || host === 'community.steam-api.com') {
    return [buildSniStrategy('hidden')];
  }
  if (host === 'lv.queniujq.cn' || host === 'broadcast.st.dl.eccdnx.com' || host.endsWith('.fastly.steamstatic.com')) {
    return [buildSniStrategy('original'), buildSniStrategy('hidden')];
  }
  if (experimental.hiddenSniForAll || includeFake) {
    return [
      buildSniStrategy('hidden'),
      ...(includeFake ? [buildSniStrategy('fake', fakeHostname)] : []),
      buildSniStrategy('original'),
    ];
  }
  if (fixed.mode === 'original') {
    return [buildSniStrategy('original')];
  }
  return [
    buildSniStrategy('hidden'),
    ...(includeFake ? [buildSniStrategy('fake', fakeHostname)] : []),
    buildSniStrategy('original'),
  ];
}

function strategyFromRouteOptions(hostname, routeOptions = {}, experimental = {}) {
  if (!routeOptions || !routeOptions.sniMode) return null;
  if (routeOptions.sniMode === 'custom' || routeOptions.sniMode === 'fake') {
    const hostnameForSni = routeOptions.sniHostname || pickFakeSniHostname(hostname, experimental.fakeSniCandidates);
    if (isBlockedFakeSni(hostnameForSni)) return null;
    return buildSniStrategy('fake', hostnameForSni);
  }
  if (routeOptions.sniMode === 'original') return buildSniStrategy('original');
  if (routeOptions.sniMode === 'hidden') return buildSniStrategy('hidden');
  return null;
}

function createSteamAccessPolicyFactory(options = {}) {
  const enabled = typeof options.enabled === 'function' ? options.enabled : () => false;
  const directWebApi = typeof options.directWebApi === 'function' ? options.directWebApi : () => false;
  const isGatewayHost = typeof options.isGatewayHost === 'function' ? options.isGatewayHost : () => false;
  const isStaticCdnHost = typeof options.isStaticCdnHost === 'function' ? options.isStaticCdnHost : () => false;
  const reuseConnectionForHost = typeof options.reuseConnectionForHost === 'function' ? options.reuseConnectionForHost : () => true;
  const getMode = typeof options.getMode === 'function' ? options.getMode : () => 'resolver';
  const getResolverProtocol = typeof options.getResolverProtocol === 'function' ? options.getResolverProtocol : () => 'doh';
  const getExperimental = typeof options.getExperimental === 'function' ? options.getExperimental : () => ({});

  function isSteamWebApiHost(hostname) {
    const host = normalizeHost(hostname);
    return host === 'api.steampowered.com' || host === 'community.steam-api.com';
  }

  function forHost(hostname, routeOptions = {}) {
    const host = normalizeHost(hostname);
    const experimental = normalizeExperimental(getExperimental());
    const profile = hostProfile(host, isStaticCdnHost);
    const routeStrategy = strategyFromRouteOptions(host, routeOptions, experimental);
    const sniStrategies = routeStrategy ? [routeStrategy] : defaultSniStrategies(host, experimental);
    const familyPreference = shouldProbeSteamAccessIpv6(host) ? [6, 4] : [4];
    const budget = requestBudgetForHost(host, isStaticCdnHost);
    const enhanceEnabled = !!enabled() && !!host && isGatewayHost(host) && !(directWebApi() && isSteamWebApiHost(host));
    const connectionReuseEnabled = routeOptions.connectionReuse !== false && reuseConnectionForHost(host) !== false;
    const protocols = isSteamWebApiHost(host)
      ? ['h1']
      : (!connectionReuseEnabled ? ['h1'] : (experimental.http2Enabled ? ['h2', 'h1'] : ['h1']));
    return {
      host,
      profile,
      enhanceEnabled,
      connectionReuseEnabled,
      resolverMode: String(getMode() || 'resolver'),
      resolverProtocol: String(getResolverProtocol() || 'doh'),
      preferredFamilies: familyPreference,
      sniStrategies,
      protocols,
      probeLevel: shouldHttpProbeHost(host, isStaticCdnHost) ? 'application' : 'tls',
      fallbackEnabled: experimental.disableNormalFallback !== true,
      edgeAliases: edgeAliasesForHost(host),
      requestBudget: budget,
      experimental: {
        hiddenSniForAll: !!experimental.hiddenSniForAll,
        fakeSniFallback: !!experimental.fakeSniFallback,
        compressedProxy: !!experimental.compressedProxy,
        http2Enabled: !!experimental.http2Enabled,
        verboseNetworkLogs: !!experimental.verboseNetworkLogs,
      },
    };
  }

  function shouldUse(opts, proxy) {
    if (proxy) return false;
    if (!opts || (opts.protocol || 'https:') !== 'https:') return false;
    if (opts.disableSteamAccessGateway) return false;
    return forHost(opts.hostname).enhanceEnabled;
  }

  return { forHost, shouldUse };
}

module.exports = {
  FAKE_SNI_CANDIDATES,
  FAKE_SNI_BLOCKLIST,
  createSteamAccessPolicyFactory,
  defaultSniStrategies,
  isBlockedFakeSni,
  normalizeFakeSniCandidates,
  pickFakeSniHostname,
};
