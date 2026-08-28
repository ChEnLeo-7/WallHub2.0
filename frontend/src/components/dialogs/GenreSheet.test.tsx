import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, test, vi } from 'vitest';

import { LanguageContext, textFor } from '@/lib/text';
import type { Filters } from '@/lib/normalizers';
import { GenreSheet } from './GenreSheet';

const filters: Filters = {
  search: '',
  sort: 'trend',
  personalFilter: '',
  personalSort: 'lastupdated',
  days: '30',
  types: [],
  rating: 'Everyone',
  ratings: ['Everyone'],
  genres: [],
  officialTags: [],
  excludedOfficialTags: [],
  categories: ['Wallpaper'],
  resolutions: [],
  mobileCompatibleOnly: false,
};

async function renderSheet(resolutions: string[] = [], steamDataSource: 'community' | 'webapi' | 'cm' = 'community') {
  const setFilters = vi.fn();
  Object.defineProperty(window, 'scrollTo', { configurable: true, value: vi.fn() });
  render(
    <LanguageContext.Provider value={{ language: 'zh', text: textFor('zh') }}>
      <GenreSheet
        open
        onOpenChange={vi.fn()}
        fixedPanelHeight={false}
        filters={{ ...filters, resolutions }}
        setFilters={setFilters}
        steamDataSource={steamDataSource}
      />
    </LanguageContext.Provider>,
  );
  fireEvent.click(screen.getByRole('button', { name: /分辨率/ }));
  await screen.findByRole('button', { name: '3440 x 1440' });
  return setFilters;
}

describe('GenreSheet resolution filter', () => {
  test('shows every Community resolution selected for the unrestricted default', async () => {
    await renderSheet();

    expect(screen.getByRole('button', { name: `分辨率 ${25}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3440 x 1440' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '2560 x 1080' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '3840 x 2160 - 4K' })).toHaveAttribute('aria-pressed', 'true');
  });

  test.each(['community', 'webapi', 'cm'] as const)('builds a multi-resolution selection for %s', async (source) => {
    const setFilters = await renderSheet([], source);

    expect(screen.getByRole('button', { name: '清除' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '3440 x 1440' }));
    fireEvent.click(screen.getByRole('button', { name: '2560 x 1080' }));
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));

    expect(setFilters).toHaveBeenCalledWith(expect.objectContaining({
      resolutions: ['3440 x 1440', '2560 x 1080'],
    }));
  });

  test('CM resolution action switches between Clear and Select all', async () => {
    await renderSheet([], 'cm');

    expect(screen.getByRole('button', { name: `分辨率 ${25}` })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '清除' }));
    expect(screen.getByRole('button', { name: '分辨率 0' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3440 x 1440' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: '全选' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    expect(screen.getByRole('button', { name: `分辨率 ${25}` })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3440 x 1440' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '清除' })).toBeInTheDocument();
  });

  test('keeps multiple selected resolutions in Community mode', async () => {
    const setFilters = await renderSheet();

    fireEvent.click(screen.getByRole('button', { name: '3440 x 1440' }));
    fireEvent.click(screen.getByRole('button', { name: '2560 x 1080' }));
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));

    expect(setFilters).toHaveBeenCalledWith(expect.objectContaining({
      resolutions: ['3440 x 1440', '2560 x 1080'],
    }));
  });

  test('clicking the active resolution restores unrestricted filtering', async () => {
    const setFilters = await renderSheet(['3440 x 1440']);

    fireEvent.click(screen.getByRole('button', { name: '3440 x 1440' }));
    expect(screen.getByRole('button', { name: '2560 x 1080' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));

    expect(setFilters).toHaveBeenCalledWith(expect.objectContaining({ resolutions: [] }));
  });

  test('the Community select-all action restores every resolution button', async () => {
    const setFilters = await renderSheet(['3440 x 1440']);

    fireEvent.click(screen.getByRole('button', { name: '全选' }));
    expect(screen.getByRole('button', { name: '3440 x 1440' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: '2560 x 1080' })).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));

    expect(setFilters).toHaveBeenCalledWith(expect.objectContaining({ resolutions: [] }));
  });
});

describe('GenreSheet official filters', () => {
  async function renderOfficialSheet(source: 'community' | 'webapi' | 'cm' = 'cm') {
    const setFilters = vi.fn();
    render(
      <LanguageContext.Provider value={{ language: 'zh', text: textFor('zh') }}>
        <GenreSheet
          open
          onOpenChange={vi.fn()}
          fixedPanelHeight={false}
          filters={filters}
          setFilters={setFilters}
          steamDataSource={source}
        />
      </LanguageContext.Provider>,
    );
    fireEvent.click(screen.getByRole('button', { name: /官方筛选/ }));
    await screen.findByRole('button', { name: '广受好评' });
    return setFilters;
  }

  test('official filters use the same single-check toggle style as other tags', async () => {
    const setFilters = await renderOfficialSheet();
    const approved = screen.getByRole('button', { name: '广受好评' });
    fireEvent.click(approved);
    expect(approved).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));

    expect(setFilters).toHaveBeenCalledWith(expect.objectContaining({
      officialTags: ['Approved'],
      excludedOfficialTags: [],
    }));
  });

  test('mobile compatibility is disabled for Community and selectable for CM', async () => {
    await renderOfficialSheet('community');
    expect(screen.getByRole('button', { name: '移动设备兼容' })).toBeDisabled();

    cleanup();
    const setFilters = await renderOfficialSheet('cm');
    fireEvent.click(screen.getByRole('button', { name: '移动设备兼容' }));
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(setFilters).toHaveBeenCalledWith(expect.objectContaining({ mobileCompatibleOnly: true }));
  });

  test('does not expose project categories and always applies Wallpaper', async () => {
    const setFilters = vi.fn();
    render(
      <LanguageContext.Provider value={{ language: 'zh', text: textFor('zh') }}>
        <GenreSheet open onOpenChange={vi.fn()} fixedPanelHeight={false} filters={filters} setFilters={setFilters} steamDataSource="cm" />
      </LanguageContext.Provider>,
    );
    expect(screen.queryByRole('button', { name: /项目分类/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '预设' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '应用筛选' }));
    expect(setFilters).toHaveBeenCalledWith(expect.objectContaining({ categories: ['Wallpaper'] }));
  });
});
