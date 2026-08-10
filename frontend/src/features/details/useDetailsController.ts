import * as React from 'react';
import { getComments, getDetails, getPersonalSource, type Details, type WorkshopItem } from '@/lib/api';

type DetailsCacheEntry = {
  value: Details;
  expiresAt: number;
};

const DETAILS_CACHE_TTL_MS = 20 * 60 * 1000;
const DETAILS_CACHE_MAX_ENTRIES = 150;
const DETAILS_CACHE_MAX_COMMENTS = 100;

function readDetailsCache(cache: Map<string, DetailsCacheEntry>, id: string) {
  const entry = cache.get(id);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(id);
    return null;
  }
  cache.delete(id);
  cache.set(id, entry);
  return entry.value;
}

function detailsForCache(value: Details): Details {
  const comments = value.comments || [];
  if (comments.length <= DETAILS_CACHE_MAX_COMMENTS) return value;
  const commentsStart = Number(value.commentsStart || 0);
  return {
    ...value,
    comments: comments.slice(0, DETAILS_CACHE_MAX_COMMENTS),
    commentsNextStart: commentsStart + DETAILS_CACHE_MAX_COMMENTS,
    commentsHasMore: true,
  };
}

function writeDetailsCache(cache: Map<string, DetailsCacheEntry>, id: string, value: Details) {
  cache.delete(id);
  cache.set(id, {
    value: detailsForCache(value),
    expiresAt: Date.now() + DETAILS_CACHE_TTL_MS,
  });
  while (cache.size > DETAILS_CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest === undefined) break;
    cache.delete(oldest);
  }
}

type UseDetailsControllerOptions = {
  personalFilter: string;
  steamLoggedIn: boolean;
  steamUsername: string;
};

export function useDetailsController({
  personalFilter,
  steamLoggedIn,
  steamUsername,
}: UseDetailsControllerOptions) {
  const [selected, setSelected] = React.useState<WorkshopItem | null>(null);
  const [details, setDetails] = React.useState<Details | null>(null);
  const [detailsLoading, setDetailsLoading] = React.useState(false);
  const [personalSourceLabel, setPersonalSourceLabel] = React.useState('');
  const detailsCacheRef = React.useRef(new Map<string, DetailsCacheEntry>());
  const personalSourceCacheRef = React.useRef(new Map<string, string>());

  React.useEffect(() => {
    personalSourceCacheRef.current.clear();
    setPersonalSourceLabel('');
  }, [steamLoggedIn, steamUsername]);

  React.useEffect(() => {
    if (!selected) {
      setDetails(null);
      setDetailsLoading(false);
      return;
    }
    const id = String(selected.publishedfileid);
    const cached = readDetailsCache(detailsCacheRef.current, id);
    if (cached) {
      setDetails(cached);
      setDetailsLoading(false);
      return;
    }
    let cancelled = false;
    setDetails(null);
    setDetailsLoading(true);
    getDetails(id)
      .then((data) => {
        if (cancelled) return;
        writeDetailsCache(detailsCacheRef.current, id, data);
        setDetails(data);
      })
      .catch((error) => {
        if (cancelled) return;
        console.warn('[details]', error);
        setDetails(null);
      })
      .finally(() => {
        if (!cancelled) setDetailsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selected]);

  React.useEffect(() => {
    const filter = String(personalFilter || '').trim().toLowerCase();
    if (!selected || !filter) {
      setPersonalSourceLabel('');
      return;
    }

    const author = String(details?.author || selected.author || '').trim();
    if (filter === 'mysubscriptions') {
      setPersonalSourceLabel('个人订阅');
      return;
    }
    if (filter === 'myfavorites') {
      setPersonalSourceLabel('我的收藏');
      return;
    }
    if (filter === 'voted') {
      setPersonalSourceLabel('我的投票');
      return;
    }
    if (filter === 'friendscreated') {
      setPersonalSourceLabel(author ? `好友 ${author} 创建` : '好友创建');
      return;
    }
    if (filter === 'followedcreated') {
      setPersonalSourceLabel(author ? `关注者 ${author} 创建` : '关注者创建');
      return;
    }
    if (filter !== 'friendsfavorites') {
      setPersonalSourceLabel('');
      return;
    }

    const id = String(selected.publishedfileid || '');
    const cacheKey = `${filter}:${id}`;
    const cached = personalSourceCacheRef.current.get(cacheKey);
    if (cached) {
      setPersonalSourceLabel(cached);
      return;
    }
    let cancelled = false;
    setPersonalSourceLabel('好友收藏');
    getPersonalSource(id, filter)
      .then((result) => {
        if (cancelled) return;
        const label = String(result.label || '好友收藏');
        personalSourceCacheRef.current.set(cacheKey, label);
        setPersonalSourceLabel(label);
      })
      .catch((error) => {
        if (!cancelled) console.warn('[personal-source]', error);
      });
    return () => { cancelled = true; };
  }, [selected, details?.author, personalFilter]);

  const loadMoreComments = React.useCallback(async (id: string) => {
    const current = String(details?.publishedfileid || '') === id
      ? details
      : readDetailsCache(detailsCacheRef.current, id);
    if (!current) return;
    const existingCount = current.comments?.length || 0;
    const commentPageSize = Number(current.commentsCount || 10);
    const likelyHasMore = !!current.commentsHasMore || existingCount >= commentPageSize || (existingCount === 0 && Number(current.commentsNextStart || 0) === 0);
    if (!likelyHasMore) return;
    const start = Number(current.commentsNextStart ?? existingCount ?? 0);
    const page = await getComments(id, start, commentPageSize, current.commentsOwnerId || current.creator || '');
    const existing = current.comments || [];
    const seen = new Set(existing.map((comment) => `${comment.author || ''}\u001f${comment.date || comment.timestamp || ''}\u001f${comment.text || ''}`));
    const appended = (page.comments || []).filter((comment) => {
      const key = `${comment.author || ''}\u001f${comment.date || comment.timestamp || ''}\u001f${comment.text || ''}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    const next: Details = {
      ...current,
      comments: existing.concat(appended),
      commentsNextStart: page.nextStart ?? start + appended.length,
      commentsTotal: page.total ?? current.commentsTotal,
      commentsOwnerId: page.ownerId || current.commentsOwnerId || current.creator || '',
      commentsHasMore: !!page.hasMore && (page.nextStart ?? start) > start,
      commentsCount: page.count ?? current.commentsCount,
    };
    writeDetailsCache(detailsCacheRef.current, id, next);
    setDetails((value) => (String(value?.publishedfileid || '') === id ? next : value));
  }, [details]);

  const selectItemById = React.useCallback((id: string | number, items: WorkshopItem[]) => {
    const idText = String(id);
    const cachedItem = items.find((item) => String(item.publishedfileid) === idText);
    if (cachedItem) {
      setSelected(cachedItem);
      return;
    }
    const detail = readDetailsCache(detailsCacheRef.current, idText);
    setSelected(detail || { publishedfileid: idText });
  }, []);

  const clearDetailsCache = React.useCallback(() => {
    detailsCacheRef.current.clear();
  }, []);

  return {
    selected,
    setSelected,
    details,
    detailsLoading,
    personalSourceLabel,
    loadMoreComments,
    selectItemById,
    clearDetailsCache,
  };
}
