import { beforeEach, describe, expect, it } from 'vitest';
import { PREFS_KEY, SEARCH_SESSION_KEY, readPrefs } from './usePreferences';

describe('readPrefs defaults', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('starts with next-page preloading disabled and 30 home cards per page', () => {
    const preferences = readPrefs();

    expect(preferences.prefetchNextPage).toBe(false);
    expect(preferences.homePageSize).toBe(30);
    expect(preferences.workshopFilterSemanticsVersion).toBe(3);
    expect(preferences.filters.days).toBe('30');
    expect(preferences.filters.sort).toBe('trend');
    expect(preferences.filters.rating).toBe('Everyone');
    expect(preferences.filters.ratings).toEqual(['Everyone']);
    expect(preferences.filters.types).toEqual([]);
    expect(preferences.filters.categories).toEqual(['Wallpaper']);
    expect(preferences.filters.genres).toContain('Unspecified');
  });

  it('uses the new defaults for missing fields without replacing saved choices', () => {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ themeMode: 'dark' }));
    expect(readPrefs()).toMatchObject({
      themeMode: 'dark',
      prefetchNextPage: false,
      homePageSize: 30,
    });

    localStorage.setItem(PREFS_KEY, JSON.stringify({
      prefetchNextPage: true,
      homePageSize: 50,
    }));
    expect(readPrefs()).toMatchObject({
      prefetchNextPage: true,
      homePageSize: 50,
    });
  });

  it('drops a previously saved Application type filter', () => {
    sessionStorage.setItem(SEARCH_SESSION_KEY, String(Date.now()));
    localStorage.setItem(PREFS_KEY, JSON.stringify({
      filters: {
        types: ['Application', 'Video'],
      },
    }));

    expect(readPrefs().filters.types).toEqual(['Video']);
  });

  it.each(['0'])('migrates legacy %s-day windows to the default month window', (days) => {
    sessionStorage.setItem(SEARCH_SESSION_KEY, String(Date.now()));
    localStorage.setItem(PREFS_KEY, JSON.stringify({ workshopFilterSemanticsVersion: 3, filters: { days } }));

    const preferences = readPrefs();
    expect(preferences.filters.days).toBe('30');
    expect(preferences.filters.categories).toEqual(['Wallpaper']);
    expect(preferences.filters.excludedOfficialTags).toEqual([]);
    expect(preferences.filters.mobileCompatibleOnly).toBe(false);
  });

  it.each(['90', '180'])('retains Community trend window %s days', (days) => {
    sessionStorage.setItem(SEARCH_SESSION_KEY, String(Date.now()));
    localStorage.setItem(PREFS_KEY, JSON.stringify({ workshopFilterSemanticsVersion: 3, filters: { days } }));
    expect(readPrefs().filters.days).toBe(days);
  });

  it('migrates the previous default genre set while preserving custom genre choices', () => {
    sessionStorage.setItem(SEARCH_SESSION_KEY, String(Date.now()));
    const legacyDefaults = [
      'Abstract', 'Animal', 'Anime', 'Cartoon', 'CGI', 'Cyberpunk', 'Fantasy', 'Game', 'Girls', 'Guys',
      'Landscape', 'Medieval', 'Memes', 'MMD', 'Music', 'Nature', 'Pixel art', 'Relaxing', 'Retro', 'Sci-Fi',
      'Sports', 'Technology', 'Television', 'Vehicle',
    ];
    localStorage.setItem(PREFS_KEY, JSON.stringify({ workshopFilterSemanticsVersion: 2, filters: { genres: legacyDefaults, categories: ['Preset'] } }));
    expect(readPrefs().filters).toMatchObject({ genres: [...legacyDefaults, 'Unspecified'], categories: ['Wallpaper'] });

    localStorage.setItem(PREFS_KEY, JSON.stringify({ workshopFilterSemanticsVersion: 2, filters: { genres: ['Anime'] } }));
    expect(readPrefs().filters.genres).toEqual(['Anime']);
  });
});
