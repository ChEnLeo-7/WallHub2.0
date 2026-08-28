import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, test, vi } from 'vitest';

import { GENRES } from '@/components/dialogs/GenreSheet';
import { LanguageContext, textFor } from '@/lib/text';
import type { Filters } from '@/lib/normalizers';
import { FilterBar } from './FilterBar';

const filters: Filters = {
  search: '',
  sort: 'trend',
  personalFilter: '',
  personalSort: 'lastupdated',
  days: '30',
  types: [],
  rating: 'Everyone',
  ratings: ['Everyone'],
  genres: GENRES.map((genre) => genre.id),
  officialTags: [],
  excludedOfficialTags: [],
  categories: ['Wallpaper'],
  resolutions: ['3440 x 1440'],
  mobileCompatibleOnly: false,
};

describe('FilterBar advanced-filter status', () => {
  test('counts an active resolution when every genre is unrestricted', () => {
    render(
      <LanguageContext.Provider value={{ language: 'zh', text: textFor('zh') }}>
        <FilterBar
          filters={filters}
          genresCount={filters.genres.length}
          totalGenres={GENRES.length}
          homeFilterMultiSelect={false}
          setFilters={vi.fn()}
          nsfw
          view="grid"
          setView={vi.fn()}
          onGenres={vi.fn()}
          steamLoggedIn
          onLoginRequired={vi.fn()}
        />
      </LanguageContext.Provider>,
    );

    const filterButton = screen.getByRole('button', { name: /筛选/ });
    expect(within(filterButton).getByText('1')).toBeInTheDocument();
  });

  test('Community exposes three-month and half-year trend windows only', async () => {
    const setFilters = vi.fn();
    const { rerender } = render(
      <LanguageContext.Provider value={{ language: 'zh', text: textFor('zh') }}>
        <FilterBar filters={filters} genresCount={filters.genres.length} totalGenres={GENRES.length} homeFilterMultiSelect={false} setFilters={setFilters} nsfw view="grid" setView={vi.fn()} onGenres={vi.fn()} steamLoggedIn onLoginRequired={vi.fn()} steamDataSource="community" />
      </LanguageContext.Provider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /本月/ }));
    expect(screen.getByText('三个月')).toBeInTheDocument();
    expect(screen.getByText('半年')).toBeInTheDocument();
    rerender(
      <LanguageContext.Provider value={{ language: 'zh', text: textFor('zh') }}>
        <FilterBar filters={filters} genresCount={filters.genres.length} totalGenres={GENRES.length} homeFilterMultiSelect={false} setFilters={setFilters} nsfw view="grid" setView={vi.fn()} onGenres={vi.fn()} steamLoggedIn onLoginRequired={vi.fn()} steamDataSource="cm" />
      </LanguageContext.Provider>,
    );
    await userEvent.click(screen.getByRole('button', { name: /本月/ }));
    expect(screen.queryByText('三个月')).not.toBeInTheDocument();
    expect(screen.queryByText('半年')).not.toBeInTheDocument();
  });

  test('omits Application from the type choices', async () => {
    const user = userEvent.setup();
    render(
      <LanguageContext.Provider value={{ language: 'zh', text: textFor('zh') }}>
        <FilterBar
          filters={filters}
          genresCount={filters.genres.length}
          totalGenres={GENRES.length}
          homeFilterMultiSelect={false}
          setFilters={vi.fn()}
          nsfw
          view="grid"
          setView={vi.fn()}
          onGenres={vi.fn()}
          steamLoggedIn
          onLoginRequired={vi.fn()}
        />
      </LanguageContext.Provider>,
    );

    const typeControl = screen.getByText('类型选择').parentElement;
    expect(typeControl).not.toBeNull();
    await user.click(within(typeControl as HTMLElement).getByRole('button', { name: '全部' }));

    expect(within(typeControl as HTMLElement).getByRole('button', { name: '场景' })).toBeInTheDocument();
    expect(within(typeControl as HTMLElement).getByRole('button', { name: '视频' })).toBeInTheDocument();
    expect(within(typeControl as HTMLElement).getByRole('button', { name: '网页' })).toBeInTheDocument();
    expect(within(typeControl as HTMLElement).queryByRole('button', { name: '应用' })).not.toBeInTheDocument();
  });

  test('uses calendar-relative labels for trend windows', async () => {
    const user = userEvent.setup();
    render(
      <LanguageContext.Provider value={{ language: 'zh', text: textFor('zh') }}>
        <FilterBar
          filters={filters}
          genresCount={filters.genres.length}
          totalGenres={GENRES.length}
          homeFilterMultiSelect={false}
          setFilters={vi.fn()}
          nsfw
          view="grid"
          setView={vi.fn()}
          onGenres={vi.fn()}
          steamLoggedIn
          onLoginRequired={vi.fn()}
        />
      </LanguageContext.Provider>,
    );

    await user.click(screen.getByRole('button', { name: '本月' }));
    expect(screen.getByRole('option', { name: '今日' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '本周' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '本月' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: '今年' })).toBeInTheDocument();
  });
});
