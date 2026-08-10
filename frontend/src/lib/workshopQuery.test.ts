import { describe, expect, it } from 'vitest';
import type { Filters } from '@/lib/normalizers';
import { buildQuery, findWorkshopCacheEntry, workshopCacheKey, type WorkshopCacheEntry } from '@/lib/workshopQuery';

describe('workshopCacheKey', () => {
  it('isolates configured Steam data sources', () => {
    const filters = { search: '' } as Filters;
    expect(workshopCacheKey(filters, 1, 30, false, 'community'))
      .not.toBe(workshopCacheKey(filters, 1, 30, false, 'webapi'));
    expect(workshopCacheKey(filters, 1, 30, false, 'community'))
      .not.toBe(workshopCacheKey(filters, 1, 30, false, 'cm'));
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
  it('keeps Community dimensions as OR while preserving cross-dimension AND tags', () => {
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
      resolutions: ['1920 x 1080', '3440 x 1440'],
    } as Filters;

    const query = buildQuery(filters, 1, 30, false, true, 'community');
    const requiredTags = Object.entries(query)
      .filter(([key]) => /^requiredtags\[\d+\]$/.test(key))
      .sort(([left], [right]) => left.localeCompare(right, undefined, { numeric: true }))
      .map(([, value]) => String(value));

    expect(requiredTags).toEqual([
      'Audio responsive', 'Video', 'Approved', 'HDR', '1920 x 1080', '3440 x 1440',
    ]);
    expect([query['type_or[0]'], query['type_or[1]']]).toEqual(['Video', 'Scene']);
    expect([query['rating_or[0]'], query['rating_or[1]']]).toEqual(['Everyone', 'Questionable']);
    expect([query['genre_or[0]'], query['genre_or[1]']]).toEqual(['Anime', 'Nature']);
    expect(query.community_tag_filter).toBe('1');
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
      resolutions: [],
    } as Filters;

    const query = buildQuery(filters, 1, 30, false, true, 'community');

    expect([query['requiredtags[0]'], query['requiredtags[1]'], query['requiredtags[2]']]).toEqual(['Video', 'Everyone', 'Anime']);
    expect(Object.keys(query).some(key => /^(?:type|rating|genre)_or\[\d+\]$/.test(key))).toBe(false);
  });
});
