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
import { DEFAULT_DETAILS_PRESENTATION, normalizeDetailsPresentation } from '../../../src/shared/detailsPresentation.mjs';
import { DEFAULT_VIDEO_PLAYER_MODE, normalizeVideoPlayerMode } from '../../../src/shared/videoControls.mjs';

export const PREFS_KEY = 'wallhub-react-prefs-v1';
export const SEARCH_SESSION_KEY = 'wallhub-search-session-v1';
export const SEARCH_SESSION_TTL_MS = 60 * 60 * 1000;

export type VideoPlayerMode = 'native' | 'compatibility';

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
  videoPlayerMode: VideoPlayerMode;
  language: 'zh' | 'en';
  fixedPanelHeight: boolean;
  detailsPresentation: 'classic' | 'redesigned';
  homeCardDefaultAction: 'playVideo' | 'backgroundDownload' | 'clientDownload' | 'openSteamPage' | 'remoteSubscribe';
  homeCardDefaultActionVersion: number;
};

function defaultHomeFilters() {
  return normalizeFilters(
    { search: '', sort: 'trend', days: '30', types: [], rating: 'Everyone', ratings: ['Everyone'], genres: DEFAULT_GENRES.map((g) => g.id) },
    true,
    DEFAULT_GENRES,
    DEFAULT_TEXT,
  );
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
    videoPlayerMode: DEFAULT_VIDEO_PLAYER_MODE as VideoPlayerMode,
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
    return {
      filters: restoreSearch ? normalizeFilters(parsed.filters, true, DEFAULT_GENRES, DEFAULT_TEXT) : defaults.filters,
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
      videoPlayerMode: normalizeVideoPlayerMode(parsed.videoPlayerMode) as VideoPlayerMode,
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
