export interface WorkshopCachePruneOptions {
  now?: number;
  ttlMs?: number;
  maxEntries?: number;
}

export function pruneWorkshopCache<T extends { cachedAt?: number }>(
  cache: Map<string, T>,
  options?: WorkshopCachePruneOptions,
): Map<string, T>;
