import { describe, expect, it } from 'vitest';
import type { Filters } from '@/lib/normalizers';
import { buildQuery, findWorkshopCacheEntry, workshopCacheKey, type WorkshopCacheEntry } from '@/lib/workshopQuery';

const officialFilterDefaults = {
  excludedOfficialTags: [] as string[],
  categories: ['Wallpaper'],
  mobileCompatibleOnly: false,
};

describe('workshopCacheKey', () => {
  it('isolates configured Steam data sources', () => {
    const filters = { search: '' } as Filters;
    expect(workshopCacheKey(filters, 1, 30, false, 'community'))
      .not.toBe(workshopCacheKey(filters, 1, 30, false, 'webapi'));
    expect(workshopCacheKey(filters, 1, 30, false, 'community'))
      .not.toBe(workshopCacheKey(filters, 1, 30, false, 'cm'));
  });

  it('isolates query languages', () => {
    const filters = { search: '极客湾' } as Filters;
    expect(workshopCacheKey(filters, 1, 30, false, 'cm', 'zh'))
      .not.toBe(workshopCacheKey(filters, 1, 30, false, 'cm', 'en'));
  });

  it('does not reuse a smaller Community HTML page for a larger page size', () => {
    const filters = { search: '' } as Filters;
    const entry: WorkshopCacheEntry = {
      pageSize: 10,
      items: [{ publishedfileid: '1' }],
      total: 1,
      source: 'community-html',
      cachedAt: Date.now(),
    };
    const cache = new Map([[workshopCacheKey(filters, 1, 10, false, 'community'), entry]]);

    expect(findWorkshopCacheEntry(cache, filters, 1, 30, false, 'community')).toBeUndefined();
    expect(findWorkshopCacheEntry(cache, filters, 1, 10, false, 'community')).toBe(entry);
  });
});

describe('buildQuery', () => {
  it('passes the selected Steam search language to non-Community sources', () => {
    const searchFilters = {
      search: '极客湾',
      sort: 'trend',
      personalFilter: '',
      personalSort: 'lastupdated',
      days: '30',
      types: [],
      rating: 'Everyone',
      ratings: ['Everyone'],
      genres: [],
      officialTags: [],
      ...officialFilterDefaults,
      resolutions: [],
    } as Filters;

    expect(buildQuery(searchFilters, 1, 30, false, true, 'cm', 'zh').language).toBe('schinese');
    expect(buildQuery(searchFilters, 1, 30, false, true, 'webapi', 'en').language).toBe('english');
    expect(buildQuery(searchFilters, 1, 30, false, true, 'community', 'zh').language).toBeUndefined();
  });

  it('keeps the selected trend query and does not apply the local exact-phrase scanner', () => {
    const searchFilters = {
      search: 'city rain',
      sort: 'trend',
      personalFilter: '',
      personalSort: 'lastupdated',
      days: '30',
      types: [],
      rating: '',
      ratings: [''],
      genres: [],
      officialTags: [],
      ...officialFilterDefaults,
      resolutions: [],
    } as Filters;

    const community = buildQuery(searchFilters, 1, 30, true, true, 'community', 'zh');
    const webApi = buildQuery(searchFilters, 1, 30, true, true, 'webapi', 'zh');
    expect(community.query_type).toBe(1);
    expect(community.days).toBe(30);
    expect(community.search_text).toBe('"city rain"');
    expect(community.exact_phrase).toBeUndefined();
    expect(webApi.query_type).toBe(1);
    expect(webApi.days).toBe(30);
    expect(webApi.search_text).toBe('"city rain"');
    expect(webApi.search_text_target).toBeUndefined();
  });

  it('does not submit the removed Application type filter', () => {
    const filters = {
      search: '',
      sort: 'trend',
      personalFilter: '',
      personalSort: 'lastupdated',
      days: '30',
      types: ['Application'],
      rating: '',
      ratings: [''],
      genres: [],
      officialTags: [],
      ...officialFilterDefaults,
      resolutions: [],
    } as Filters;

    const query = buildQuery(filters, 1, 30, false, true, 'community');
    expect([query['type_or[0]'], query['type_or[1]'], query['type_or[2]']]).toEqual(['Scene', 'Video', 'Web']);
    expect(Object.values(query)).not.toContain('Application');
  });

  it('keeps trend windows distinct for Steam CM text searches', () => {
    const searchFilters = {
      search: '极客湾',
      sort: 'trend',
      personalFilter: '',
      personalSort: 'lastupdated',
      days: '1',
      types: ['Video'],
      rating: 'Everyone',
      ratings: ['Everyone'],
      genres: [],
      officialTags: [],
      ...officialFilterDefaults,
      resolutions: [],
    } as Filters;

    const today = buildQuery(searchFilters, 1, 30, false, true, 'cm', 'zh');
    const week = buildQuery({ ...searchFilters, days: '7' }, 1, 30, false, true, 'cm', 'zh');
    const month = buildQuery({ ...searchFilters, days: '30' }, 1, 30, false, true, 'cm', 'zh');
    expect(today.query_type).toBe(1);
    expect(week.query_type).toBe(1);
    expect(month.query_type).toBe(1);
    expect(today.days).toBe(1);
    expect(week.days).toBe(7);
    expect(month.days).toBe(30);
    expect(workshopCacheKey(searchFilters, 1, 30, false, 'cm', 'zh'))
      .not.toBe(workshopCacheKey({ ...searchFilters, days: '7' }, 1, 30, false, 'cm', 'zh'));
  });

  it('keeps Community AND tags while encoding resolution selection separately', () => {
    const filters = {
      search: 'tag:Audio responsive|Video',
      sort: 'trend',
      personalFilter: '',
      personalSort: 'lastupdated',
      days: '30',
      types: ['Video', 'Scene'],
      rating: 'Everyone',
      ratings: ['Everyone', 'Questionable'],
      genres: ['Anime', 'Nature'],
      officialTags: ['Approved', 'HDR'],
      ...officialFilterDefaults,
      resolutions: ['3440 x 1440'],
    } as Filters;

    const query = buildQuery(filters, 1, 30, false, true, 'community');
    const requiredTags = Object.entries(query)
      .filter(([key]) => /^requiredtags\[\d+\]$/.test(key))
      .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
      .map(([, value]) => String(value));

    expect(requiredTags).toEqual(['Audio responsive', 'Video', 'Approved', 'HDR']);
    expect([query['type_or[0]'], query['type_or[1]']]).toEqual(['Video', 'Scene']);
    expect([query['rating_or[0]'], query['rating_or[1]']]).toEqual(['Everyone', 'Questionable']);
    expect([query['genre_or[0]'], query['genre_or[1]']]).toEqual(['Anime', 'Nature']);
    expect(query['resolution_or[0]']).toBe('Ultrawide 3440 x 1440');
    expect(query.community_tag_filter).toBe('1');
  });

  it('groups selected resolutions for every source without weakening common tags', () => {
    const filters = {
      search: '',
      sort: 'trend',
      personalFilter: '',
      personalSort: 'lastupdated',
      days: '30',
      types: ['Video'],
      rating: 'Everyone',
      ratings: ['Everyone'],
      genres: [],
      officialTags: [],
      ...officialFilterDefaults,
      resolutions: ['Ultrawide', '2560 x 1080', '3440 x 1440'],
    } as Filters;

    for (const source of ['community', 'cm', 'webapi'] as const) {
      const query = buildQuery(filters, 1, 30, false, true, source);
      expect(query['requiredtags[0]']).toBeUndefined();
      expect(query['type_or[0]']).toBe('Video');
      expect(query['rating_or[0]']).toBe('Everyone');
      expect([query['resolution_or[0]'], query['resolution_or[1]'], query['resolution_or[2]']]).toEqual([
        'Ultrawide Standard Definition',
        'Ultrawide 2560 x 1080',
        'Ultrawide 3440 x 1440',
      ]);
    }
  });

  it('keeps singleton Community dimensions on the single-page required-tag path', () => {
    const filters = {
      search: '',
      sort: 'trend',
      personalFilter: '',
      personalSort: 'lastupdated',
      days: '30',
      types: ['Video'],
      rating: 'Everyone',
      ratings: ['Everyone'],
      genres: ['Anime'],
      officialTags: [],
      ...officialFilterDefaults,
      resolutions: [],
    } as Filters;

    const query = buildQuery(filters, 1, 30, false, true, 'community');

    expect(query['requiredtags[0]']).toBeUndefined();
    expect(query['type_or[0]']).toBe('Video');
    expect(query['rating_or[0]']).toBe('Everyone');
    expect(query['genre_or[0]']).toBe('Anime');
  });

  it('submits Utility exclusions, forces Wallpaper, and keeps mobile compatibility source-aware', () => {
    const filters = {
      search: 'city rain',
      sort: 'trend',
      personalFilter: '',
      personalSort: 'lastupdated',
      days: '365',
      types: [],
      rating: 'Everyone',
      ratings: ['Everyone'],
      genres: [],
      officialTags: ['Approved'],
      excludedOfficialTags: ['HDR'],
      categories: [],
      resolutions: [],
      mobileCompatibleOnly: true,
    } as Filters;

    const cm = buildQuery(filters, 1, 30, false, true, 'cm');
    const community = buildQuery(filters, 1, 30, false, true, 'community');
    expect(cm['requiredtags[0]']).toBe('Approved');
    expect(cm['category_or[0]']).toBe('Wallpaper');
    expect(Object.values(cm)).not.toContain('Preset');
    expect(cm.mobile_compatible).toBe(1);
    expect(cm.search_text_target).toBeUndefined();
    expect(community.mobile_compatible).toBeUndefined();
    expect(community.search_text_target).toBeUndefined();
  });
});
