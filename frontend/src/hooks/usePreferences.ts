import {
  normalizeThemeMode,
  normalizeAccentTheme,
  normalizeCustomAccentColor,
  normalizeMobileColumns,
  normalizeDesktopColumns,
  normalizeHomePageSize,
  normalizeHomeCardDefaultAction,
  normalizeLanguage,
  normalizeFilters,
  type Filters,
} from '@/lib/normalizers';
import { DEFAULT_DETAILS_PRESENTATION, normalizeDetailsPresentation } from '@/lib/detailsPresentation.mjs';
import { DEFAULT_WORKSHOP_GENRES } from '@/lib/workshopFilterCatalog';

export const PREFS_KEY = 'wallhub-react-prefs-v1';
export const SEARCH_SESSION_KEY = 'wallhub-search-session-v1';
export const SEARCH_SESSION_TTL_MS = 60 * 60 * 1000;

const DEFAULT_GENRES = [
  { id: 'Abstract' },
  { id: 'Animal' },
  { id: 'Anime' },
  { id: 'Cartoon' },
  { id: 'CGI' },
  { id: 'Cyberpunk' },
  { id: 'Fantasy' },
  { id: 'Game' },
  { id: 'Girls' },
  { id: 'Guys' },
  { id: 'Landscape' },
  { id: 'Medieval' },
  { id: 'Memes' },
  { id: 'MMD' },
  { id: 'Music' },
  { id: 'Nature' },
  { id: 'Pixel art' },
  { id: 'Relaxing' },
  { id: 'Retro' },
  { id: 'Sci-Fi' },
  { id: 'Sports' },
  { id: 'Technology' },
  { id: 'Television' },
  { id: 'Vehicle' },
  { id: 'Unspecified' },
];

const DEFAULT_TEXT = {
  all: '',
  ratingEveryone: 'Everyone',
  ratingQuestionable: 'Questionable',
  ratingMature: 'Mature',
};

export type AppPrefs = {
  filters: Filters;
  workshopFilterSemanticsVersion: number;
  exactPhrase: boolean;
  homeFilterMultiSelect: boolean;
  view: 'grid' | 'list';
  themeMode: 'system' | 'light' | 'dark';
  accentTheme: 'mono' | 'blue' | 'green' | 'rose' | 'violet' | 'custom';
  customAccentColor: string;
  mobileColumns: number;
  desktopColumns: number;
  homePageSize: number;
  prefetchNextPage: boolean;
  language: 'zh' | 'en';
  fixedPanelHeight: boolean;
  detailsPresentation: 'classic' | 'redesigned';
  homeCardDefaultAction: 'playVideo' | 'backgroundDownload' | 'clientDownload' | 'openSteamPage' | 'remoteSubscribe';
  homeCardDefaultActionVersion: number;
};

function defaultHomeFilters() {
  return normalizeFilters(
    {
      search: '',
      sort: 'trend',
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
    },
    true,
    DEFAULT_GENRES,
    DEFAULT_TEXT,
  );
}

function migrateWorkshopFilters(value: unknown, semanticsVersion: unknown) {
  const filters = value && typeof value === 'object' ? { ...(value as Partial<Filters>) } : {};
  if (Number(semanticsVersion) >= 3 || !Array.isArray(filters.genres)) return filters;
  const legacyDefaultGenres = DEFAULT_GENRES.map((genre) => genre.id).filter((genre) => genre !== 'Unspecified');
  const savedGenres = Array.from(new Set(filters.genres));
  if (savedGenres.length === legacyDefaultGenres.length && legacyDefaultGenres.every((genre) => savedGenres.includes(genre))) {
    filters.genres = [...savedGenres, 'Unspecified'];
  }
  return filters;
}

export function shouldRestoreSearchPrefs() {
  try {
    const now = Date.now();
    const previous = Number(window.sessionStorage.getItem(SEARCH_SESSION_KEY) || '0');
    window.sessionStorage.setItem(SEARCH_SESSION_KEY, String(now));
    return previous > 0 && now - previous < SEARCH_SESSION_TTL_MS;
  } catch {
    return false;
  }
}

export function markSearchSessionActive() {
  try {
    window.sessionStorage.setItem(SEARCH_SESSION_KEY, String(Date.now()));
  } catch {}
}

export function readPrefs(): AppPrefs {
  const defaults = {
    filters: defaultHomeFilters(),
    workshopFilterSemanticsVersion: 3,
    exactPhrase: false,
    homeFilterMultiSelect: false,
    view: 'grid' as const,
    themeMode: 'system' as const,
    accentTheme: 'mono' as const,
    customAccentColor: '#5e8cff',
    mobileColumns: 2,
    desktopColumns: 0,
    homePageSize: 30,
    prefetchNextPage: false,
    language: 'zh' as const,
    fixedPanelHeight: false,
    detailsPresentation: DEFAULT_DETAILS_PRESENTATION,
    homeCardDefaultAction: 'clientDownload' as const,
    homeCardDefaultActionVersion: 4,
  };
  try {
    const parsed = JSON.parse(localStorage.getItem(PREFS_KEY) || '{}');
    const parsedAction = normalizeHomeCardDefaultAction(parsed.homeCardDefaultAction);
    const restoreSearch = shouldRestoreSearchPrefs();
    const restoredFilters = migrateWorkshopFilters(parsed.filters, parsed.workshopFilterSemanticsVersion);
    return {
      filters: restoreSearch ? normalizeFilters(restoredFilters, true, DEFAULT_GENRES, DEFAULT_TEXT) : defaults.filters,
      workshopFilterSemanticsVersion: defaults.workshopFilterSemanticsVersion,
      exactPhrase: restoreSearch ? !!(parsed.exactPhrase ?? parsed.filters?.exactPhrase) : defaults.exactPhrase,
      homeFilterMultiSelect: !!parsed.homeFilterMultiSelect,
      view: parsed.view === 'list' ? 'list' : 'grid',
      themeMode: normalizeThemeMode(parsed.themeMode || parsed.theme),
      accentTheme: normalizeAccentTheme(parsed.accentTheme),
      customAccentColor: normalizeCustomAccentColor(parsed.customAccentColor),
      mobileColumns: normalizeMobileColumns(parsed.mobileColumns),
      desktopColumns: normalizeDesktopColumns(parsed.desktopColumns),
      homePageSize: normalizeHomePageSize(parsed.homePageSize),
      prefetchNextPage: !!parsed.prefetchNextPage,
      language: normalizeLanguage(parsed.language),
      fixedPanelHeight: !!parsed.fixedPanelHeight,
      detailsPresentation: normalizeDetailsPresentation(parsed.detailsPresentation),
      homeCardDefaultAction: parsedAction,
      homeCardDefaultActionVersion: defaults.homeCardDefaultActionVersion,
    };
  } catch {
    return defaults;
  }
}
