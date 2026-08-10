import * as React from 'react';
import { markSearchSessionActive, PREFS_KEY, readPrefs } from '@/hooks/usePreferences';
import { useSystemTheme } from '@/hooks/useSystemTheme';
import {
  applyCustomAccentVariables,
  clearCustomAccentVariables,
} from '@/lib/normalizers';

export function useAppPreferences() {
  const initial = React.useMemo(readPrefs, []);
  const [themeMode, setThemeMode] = React.useState(initial.themeMode);
  const [customAccentColor, setCustomAccentColor] = React.useState(initial.customAccentColor);
  const [accentTheme, setAccentTheme] = React.useState(initial.accentTheme);
  const [filters, setFilters] = React.useState(initial.filters);
  const [exactPhrase, setExactPhrase] = React.useState(initial.exactPhrase);
  const [homeFilterMultiSelect, setHomeFilterMultiSelect] = React.useState(initial.homeFilterMultiSelect);
  const [view, setView] = React.useState(initial.view);
  const [mobileColumns, setMobileColumns] = React.useState(initial.mobileColumns);
  const [desktopColumns, setDesktopColumns] = React.useState(initial.desktopColumns);
  const [homePageSize, setHomePageSize] = React.useState(initial.homePageSize);
  const [prefetchNextPage, setPrefetchNextPage] = React.useState(initial.prefetchNextPage);
  const [videoPlayerMode, setVideoPlayerMode] = React.useState(initial.videoPlayerMode);
  const [language, setLanguage] = React.useState(initial.language);
  const [fixedPanelHeight, setFixedPanelHeight] = React.useState(initial.fixedPanelHeight);
  const [detailsPresentation, setDetailsPresentation] = React.useState(initial.detailsPresentation);
  const [homeCardDefaultAction, setHomeCardDefaultAction] = React.useState(initial.homeCardDefaultAction);
  const systemTheme = useSystemTheme();
  const resolvedTheme = themeMode === 'system' ? systemTheme : themeMode;

  React.useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('light', resolvedTheme === 'light');
    root.dataset.accent = accentTheme;
    if (accentTheme === 'custom') applyCustomAccentVariables(root, customAccentColor, resolvedTheme === 'light');
    else clearCustomAccentVariables(root);
    root.lang = language === 'en' ? 'en' : 'zh-CN';
    document.title = language === 'en' ? 'WallHub · Steam Workshop Wallpapers' : 'WallHub · Steam 壁纸工坊';
    markSearchSessionActive();
    localStorage.setItem(
      PREFS_KEY,
      JSON.stringify({
        filters,
        exactPhrase,
        homeFilterMultiSelect,
        view,
        themeMode,
        accentTheme,
        customAccentColor,
        mobileColumns,
        desktopColumns,
        homePageSize,
        prefetchNextPage,
        videoPlayerMode,
        language,
        fixedPanelHeight,
        detailsPresentation,
        homeCardDefaultAction,
        homeCardDefaultActionVersion: 4,
      }),
    );
  }, [accentTheme, customAccentColor, desktopColumns, detailsPresentation, exactPhrase, filters, fixedPanelHeight, homeCardDefaultAction, homeFilterMultiSelect, homePageSize, language, mobileColumns, prefetchNextPage, resolvedTheme, themeMode, videoPlayerMode, view]);

  return {
    themeMode,
    setThemeMode,
    customAccentColor,
    setCustomAccentColor,
    accentTheme,
    setAccentTheme,
    filters,
    setFilters,
    exactPhrase,
    setExactPhrase,
    homeFilterMultiSelect,
    setHomeFilterMultiSelect,
    view,
    setView,
    mobileColumns,
    setMobileColumns,
    desktopColumns,
    setDesktopColumns,
    homePageSize,
    setHomePageSize,
    prefetchNextPage,
    setPrefetchNextPage,
    videoPlayerMode,
    setVideoPlayerMode,
    language,
    setLanguage,
    fixedPanelHeight,
    setFixedPanelHeight,
    detailsPresentation,
    setDetailsPresentation,
    homeCardDefaultAction,
    setHomeCardDefaultAction,
  };
}
