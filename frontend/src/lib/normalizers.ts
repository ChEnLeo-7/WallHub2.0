import {
  DEFAULT_WORKSHOP_GENRES,
  VISIBLE_WORKSHOP_TYPES,
  WORKSHOP_RESOLUTIONS,
  WORKSHOP_UTILITY_TAGS,
} from '@/lib/workshopFilterCatalog';

export function normalizeLanguage(value: unknown): 'zh' | 'en' {
  return value === 'en' ? 'en' : 'zh';
}

export function normalizeAccentTheme(value: unknown): 'mono' | 'blue' | 'green' | 'rose' | 'violet' | 'custom' {
  return ['blue', 'green', 'rose', 'violet', 'custom'].includes(String(value)) ? (value as 'mono' | 'blue' | 'green' | 'rose' | 'violet' | 'custom') : 'mono';
}

export function normalizeThemeMode(value: unknown): 'system' | 'light' | 'dark' {
  if (value === 'light' || value === 'dark') return value;
  return 'system';
}

export function normalizeHomeCardDefaultAction(value: unknown): 'playVideo' | 'backgroundDownload' | 'clientDownload' | 'openSteamPage' | 'remoteSubscribe' {
  const raw = String(value || '');
  if (raw === 'subscribe') return 'remoteSubscribe';
  return ['playVideo', 'clientDownload', 'openSteamPage', 'remoteSubscribe'].includes(raw)
    ? (raw as 'playVideo' | 'backgroundDownload' | 'clientDownload' | 'openSteamPage' | 'remoteSubscribe')
    : 'clientDownload';
}

export function themeModeOptions(text: { themeSystem: string; themeLight: string; themeDark: string }) {
  return [
    { value: 'system', label: text.themeSystem },
    { value: 'light', label: text.themeLight },
    { value: 'dark', label: text.themeDark },
  ];
}

export function accentThemeOptions(text: { accentMono: string; accentBlue: string; accentGreen: string; accentRose: string; accentViolet: string; accentCustom: string }) {
  return [
    { value: 'mono', label: text.accentMono },
    { value: 'blue', label: text.accentBlue },
    { value: 'green', label: text.accentGreen },
    { value: 'rose', label: text.accentRose },
    { value: 'violet', label: text.accentViolet },
    { value: 'custom', label: text.accentCustom },
  ];
}

export function homeCardDefaultActionOptions(text: { actionClientDownload: string; defaultMark: string; actionPlayVideo: string; actionOpenSteamPage: string; actionSubscribe: string }) {
  const options = [
    { value: 'clientDownload', label: `${text.actionClientDownload}（${text.defaultMark}）` },
    { value: 'playVideo', label: text.actionPlayVideo },
    { value: 'openSteamPage', label: text.actionOpenSteamPage },
  ];
  options.push({ value: 'remoteSubscribe', label: text.actionSubscribe });
  return options;
}

export function normalizeMobileColumns(value: unknown) {
  const n = Number.parseInt(String(value || '2'), 10);
  return Math.max(1, Math.min(4, n || 2));
}

export function normalizeDesktopColumns(value: unknown) {
  const n = Number.parseInt(String(value || '0'), 10);
  if (!n) return 0;
  return Math.max(2, Math.min(8, n));
}

export function normalizeHomePageSize(value: unknown) {
  const n = Number.parseInt(String(value || '30'), 10);
  return [10, 15, 30, 50].includes(n) ? n : 30;
}

export function normalizeConcurrentDownloads(value: unknown) {
  const n = Number.parseInt(String(value || '1'), 10);
  return Math.max(1, Math.min(4, n || 1));
}

export function normalizeSteamCdnRouteStrategy(value: unknown): 'nearest' | 'proxy' {
  return value === 'proxy' ? 'proxy' : 'nearest';
}

export function normalizeSteamKitMaxDownloads(value: unknown) {
  const n = Number.parseInt(String(value || '0'), 10);
  if (!n) return 0;
  return Math.max(1, Math.min(32, n));
}

export function normalizeDepotStreamCacheMaxMb(value: unknown) {
  const n = Number.parseInt(String(value || '512'), 10);
  if (!Number.isFinite(n) || n <= 0) return 512;
  return Math.max(64, Math.min(65536, n));
}

export function normalizeSteamAccessDohEndpoint(value: unknown, defaultEndpoint: string) {
  const raw = String(value || '').trim();
  if (!raw) return defaultEndpoint;
  try {
    const url = new URL(raw);
    if (url.protocol !== 'https:' || !url.hostname) return defaultEndpoint;
    return url.toString();
  } catch {
    return defaultEndpoint;
  }
}

export function normalizeSteamAccessDotEndpoint(value: unknown, defaultEndpoint: string) {
  const raw = String(value || '').trim();
  if (!raw) return defaultEndpoint;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) || /[/?#\\]/.test(raw)) return defaultEndpoint;
  const lastColon = raw.lastIndexOf(':');
  const hasPort = lastColon > 0 && /^\d+$/.test(raw.slice(lastColon + 1));
  const host = (hasPort ? raw.slice(0, lastColon) : raw).trim().toLowerCase();
  const port = hasPort ? Number.parseInt(raw.slice(lastColon + 1), 10) : 853;
  if (!host || /[:\s]/.test(host) || !Number.isFinite(port) || port < 1 || port > 65535) return defaultEndpoint;
  return `${host}:${port}`;
}

export function validateSteamAccessEndpoint(value: unknown, protocol: 'doh' | 'dot') {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (protocol === 'dot') {
    const normalized = normalizeSteamAccessDotEndpoint(raw, '');
    if (!normalized) return '';
    return normalized;
  }
  const normalized = normalizeSteamAccessDohEndpoint(raw, '');
  if (!normalized || !raw.toLowerCase().startsWith('https://')) return '';
  return normalized;
}

export function normalizeSteamAccessResolverProtocol(value: unknown): 'doh' | 'dot' {
  return value === 'dot' ? 'dot' : 'doh';
}

export function normalizeSteamAccessMode(value: unknown): 'resolver' | 'hosts' {
  return value === 'hosts' ? 'hosts' : 'resolver';
}

export function normalizeSteamAccessResolverMode(value: unknown): 'fastest' | 'fixed' {
  return value === 'fixed' ? 'fixed' : 'fastest';
}

export function normalizeSteamAccessEndpointList(value: unknown, protocol: 'doh' | 'dot', limit = 64) {
  const raw = Array.isArray(value) ? value : [];
  const normalized: string[] = [];
  const seen = new Set<string>();
  for (const item of raw) {
    const endpoint = validateSteamAccessEndpoint(item, protocol);
    if (!endpoint || seen.has(endpoint)) continue;
    seen.add(endpoint);
    normalized.push(endpoint);
    if (normalized.length >= limit) break;
  }
  return normalized;
}

export function normalizeSteamAccessHostsUrl(value: unknown) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) return '';
    return url.toString();
  } catch {
    return '';
  }
}

export function normalizeSteamAccessHostsUpdateIntervalHours(value: unknown) {
  const n = Number.parseFloat(String(value || '24'));
  if (!Number.isFinite(n) || n <= 0) return 24;
  return Math.max(0.5, Math.min(168, n));
}

export function normalizeCustomAccentColor(value: unknown) {
  const raw = String(value || '').trim();
  return /^#[0-9a-f]{6}$/i.test(raw) ? raw : '#5e8cff';
}

export function hexToHsl(hex: string) {
  const raw = normalizeCustomAccentColor(hex).replace('#', '');
  const r = parseInt(raw.slice(0, 2), 16) / 255;
  const g = parseInt(raw.slice(2, 4), 16) / 255;
  const b = parseInt(raw.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function applyCustomAccentVariables(root: HTMLElement, color: string, light: boolean) {
  const { h, s } = hexToHsl(color);
  const values: Record<string, string> = light
    ? {
        '--background': `${h} ${Math.max(18, Math.round(s * 0.42))}% 97%`,
        '--foreground': `${h} 34% 13%`,
        '--card': `${h} ${Math.max(20, Math.round(s * 0.46))}% 99%`,
        '--popover': `${h} ${Math.max(20, Math.round(s * 0.46))}% 99%`,
        '--primary': `${h} ${Math.max(34, Math.round(s * 0.72))}% 38%`,
        '--primary-foreground': '0 0% 100%',
        '--secondary': `${h} ${Math.max(20, Math.round(s * 0.36))}% 92%`,
        '--muted': `${h} ${Math.max(18, Math.round(s * 0.32))}% 93%`,
        '--muted-foreground': `${h} 18% 42%`,
        '--accent': `${h} ${Math.max(22, Math.round(s * 0.42))}% 90%`,
        '--accent-foreground': `${h} 38% 20%`,
        '--border': `${h} ${Math.max(16, Math.round(s * 0.26))}% 74%`,
        '--input': `${h} ${Math.max(18, Math.round(s * 0.3))}% 84%`,
        '--ring': `${h} ${Math.max(34, Math.round(s * 0.68))}% 46%`,
      }
    : {
        '--background': `${h} ${Math.max(16, Math.round(s * 0.32))}% 7%`,
        '--foreground': `${h} 36% 97%`,
        '--card': `${h} ${Math.max(14, Math.round(s * 0.28))}% 12%`,
        '--popover': `${h} ${Math.max(15, Math.round(s * 0.3))}% 14%`,
        '--primary': `${h} ${Math.max(42, Math.round(s * 0.75))}% 72%`,
        '--primary-foreground': `${h} 44% 10%`,
        '--secondary': `${h} ${Math.max(12, Math.round(s * 0.24))}% 18%`,
        '--muted': `${h} ${Math.max(12, Math.round(s * 0.22))}% 17%`,
        '--muted-foreground': `${h} 18% 68%`,
        '--accent': `${h} ${Math.max(18, Math.round(s * 0.3))}% 24%`,
        '--accent-foreground': `${h} 58% 94%`,
        '--border': `${h} ${Math.max(12, Math.round(s * 0.22))}% 31%`,
        '--input': `${h} ${Math.max(14, Math.round(s * 0.25))}% 22%`,
        '--ring': `${h} ${Math.max(42, Math.round(s * 0.68))}% 62%`,
      };
  Object.entries(values).forEach(([key, value]) => root.style.setProperty(key, value));
}

export function clearCustomAccentVariables(root: HTMLElement) {
  ['--background', '--foreground', '--card', '--popover', '--primary', '--primary-foreground', '--secondary', '--muted', '--muted-foreground', '--accent', '--accent-foreground', '--border', '--input', '--ring'].forEach((key) => root.style.removeProperty(key));
}

type RatingText = { all: string; ratingEveryone: string; ratingQuestionable: string; ratingMature: string };

const DEFAULT_RATING_TEXT: RatingText = {
  all: '',
  ratingEveryone: 'Everyone',
  ratingQuestionable: 'Questionable',
  ratingMature: 'Mature',
};

export function normalizeRating(value: string, nsfw: boolean, text: RatingText = DEFAULT_RATING_TEXT) {
  const all = '';
  if (!nsfw && value === 'Mature') return text.ratingEveryone;
  const allowed = ratingOptions(nsfw, text).map((option) => option.value);
  if (!allowed.includes(value)) return nsfw ? all : text.ratingEveryone;
  return value;
}

export function ratingOptions(nsfw: boolean, text: RatingText) {
  const base = [
    { value: '', label: text.all },
    { value: 'Everyone', label: text.ratingEveryone },
    { value: 'Questionable', label: text.ratingQuestionable },
  ];
  return nsfw ? [...base, { value: 'Mature', label: text.ratingMature }] : base;
}

export function normalizeRatings(value: unknown, nsfw: boolean, text: RatingText = DEFAULT_RATING_TEXT, legacyRating?: unknown) {
  const raw = Array.isArray(value) ? value : legacyRating !== undefined ? [legacyRating] : ['Everyone'];
  const allowed = ratingOptions(nsfw, text).map((option) => option.value);
  const normalized = raw
    .map((item) => normalizeRating(String(item ?? ''), nsfw, text))
    .filter((item) => allowed.includes(item));
  const unique = Array.from(new Set(normalized));
  if (unique.includes('')) return [''];
  if (!unique.length) return [normalizeRating('Everyone', nsfw, text)];
  return unique;
}

export function primaryRating(ratings: string[], nsfw: boolean, text: RatingText = DEFAULT_RATING_TEXT) {
  const normalized = normalizeRatings(ratings, nsfw, text);
  return normalized.length ? normalized[0] : normalizeRating('Everyone', nsfw, text);
}

export function normalizeFilterTypes(value: unknown, legacyType?: unknown) {
  const raw = Array.isArray(value) ? value : legacyType ? [legacyType] : [];
  return Array.from(new Set(raw.map((item) => String(item || '').trim()).filter((item) => VISIBLE_WORKSHOP_TYPES.includes(item as typeof VISIBLE_WORKSHOP_TYPES[number]))));
}

const PERSONAL_FILTERS = ['mysubscriptions', 'myfavorites', 'voted', 'friendsfavorites', 'friendscreated', 'followedcreated'];
const PERSONAL_SORTS = ['subscriptiondate', 'alpha', 'lastupdated', 'creationorder'];

function normalizeTagList(value: unknown, allowed: string[]) {
  const raw = Array.isArray(value) ? value : [];
  return Array.from(new Set(raw.map((item) => String(item || '').trim()).filter((item) => allowed.includes(item))));
}

export function normalizeResolutionTags(value: unknown) {
  const normalized = normalizeTagList(value, [...WORKSHOP_RESOLUTIONS]);
  return normalized.length === WORKSHOP_RESOLUTIONS.length ? [] : normalized;
}

export function normalizeResolutionSelection(value: unknown, _steamDataSource: 'community' | 'webapi' | 'cm') {
  return normalizeResolutionTags(value);
}

export type Filters = {
  search: string;
  sort: string;
  personalFilter: string;
  personalSort: string;
  days: string;
  types: string[];
  rating: string;
  ratings: string[];
  genres: string[];
  officialTags: string[];
  excludedOfficialTags: string[];
  categories: string[];
  resolutions: string[];
  mobileCompatibleOnly: boolean;
};

export function normalizeFilterDays(value: unknown) {
  const days = String(value || '30');
  return ['1', '7', '30', '90', '180', '365'].includes(days) ? days : '30';
}

export function normalizeFilters(value: unknown, nsfw = true, GENRES: { id: string }[], text: { all: string; ratingEveryone: string; ratingQuestionable: string; ratingMature: string }): Filters {
  const raw = (value || {}) as Partial<Filters> & { type?: string };
  const ratings = normalizeRatings(raw.ratings, nsfw, text, raw.rating);
  return {
    search: String(raw.search || ''),
    sort: ['trend', 'mostrecent', 'toprated', 'mostvotes', 'totaluniquesubscribers'].includes(String(raw.sort)) ? String(raw.sort) : 'trend',
    personalFilter: PERSONAL_FILTERS.includes(String(raw.personalFilter || '')) ? String(raw.personalFilter) : '',
    personalSort: PERSONAL_SORTS.includes(String(raw.personalSort || '')) ? String(raw.personalSort) : 'lastupdated',
    days: normalizeFilterDays(raw.days),
    types: normalizeFilterTypes(raw.types, raw.type),
    rating: primaryRating(ratings, nsfw, text),
    ratings,
    genres: Array.isArray(raw.genres) ? raw.genres.filter((g) => GENRES.some((x) => x.id === g)) : DEFAULT_WORKSHOP_GENRES.filter((g) => GENRES.some((x) => x.id === g)),
    officialTags: normalizeTagList(raw.officialTags, [...WORKSHOP_UTILITY_TAGS]),
    excludedOfficialTags: normalizeTagList(raw.excludedOfficialTags, [...WORKSHOP_UTILITY_TAGS])
      .filter((tag) => !normalizeTagList(raw.officialTags, [...WORKSHOP_UTILITY_TAGS]).includes(tag)),
    categories: ['Wallpaper'],
    resolutions: normalizeResolutionTags(raw.resolutions),
    mobileCompatibleOnly: !!raw.mobileCompatibleOnly,
  };
}

export function defaultHomeFilters(GENRES: { id: string }[], text: { all: string; ratingEveryone: string; ratingQuestionable: string; ratingMature: string }): Filters {
  return normalizeFilters({
    search: '',
    sort: 'trend',
    personalFilter: '',
    personalSort: 'lastupdated',
    days: '30',
    types: [],
    rating: 'Everyone',
    ratings: ['Everyone'],
    genres: DEFAULT_WORKSHOP_GENRES,
    officialTags: [],
    excludedOfficialTags: [],
    categories: ['Wallpaper'],
    resolutions: [],
    mobileCompatibleOnly: false,
  }, true, GENRES, text);
}

export function shouldRestoreSearchPrefs(SEARCH_SESSION_KEY: string, SEARCH_SESSION_TTL_MS: number) {
  try {
    const now = Date.now();
    const previous = Number(window.sessionStorage.getItem(SEARCH_SESSION_KEY) || '0');
    window.sessionStorage.setItem(SEARCH_SESSION_KEY, String(now));
    return previous > 0 && now - previous < SEARCH_SESSION_TTL_MS;
  } catch {
    return false;
  }
}

export function markSearchSessionActive(SEARCH_SESSION_KEY: string) {
  try {
    window.sessionStorage.setItem(SEARCH_SESSION_KEY, String(Date.now()));
  } catch {}
}
