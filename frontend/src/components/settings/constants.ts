export const DEFAULT_STEAM_ACCESS_DOH_ENDPOINT = 'https://1.12.12.12/resolve';
export const DEFAULT_STEAM_ACCESS_DOT_ENDPOINT = 'dot.pub:853';
export const STEAM_ACCESS_DOH_ENDPOINTS = [
  'https://1.12.12.12/resolve', 'https://doh.pub/resolve', 'https://dns.alidns.com/resolve',
  'https://doh.360.cn/dns-query', 'https://v.recipes/dns/dns.google/dns-query',
] as const;
export const STEAM_ACCESS_DOT_ENDPOINTS = [
  '1dot1dot1dot1.cloudflare-dns.com:853', 'dot.pub:853', 'dns.alidns.com:853',
  'dns.adguard.com:853', 'dns.umbrella.com:853', 'dns.google:853', 'dns.quad9.net:853', '1.1.1.1:853',
] as const;
export const STEAM_API_KEY_URL = 'https://steamcommunity.com/dev/apikey';
export const STEAM_PROXY_QUICK_LINKS = [
  { key: 'steamProxyQuickCommunity', url: 'https://steamcommunity.com/' },
  { key: 'steamProxyQuickStore', url: 'https://store.steampowered.com/' },
  { key: 'steamProxyQuickWorkshop', url: 'https://steamcommunity.com/app/431960/workshop/' },
  { key: 'steamProxyQuickCharts', url: 'https://store.steampowered.com/charts/topselling/global' },
] as const;
