export interface QueueDeleteTombstone {
  deletedAt: number;
  expiresAt: number;
}

export interface QueueTaskWithIdentity {
  id?: string | number;
  cacheKey?: string;
  addTime?: number;
}

export function pruneQueueDeleteTombstones(
  tombstones: Map<string, QueueDeleteTombstone>,
  now?: number,
): Map<string, QueueDeleteTombstone>;

export function filterQueueTasksAfterDelete<T extends QueueTaskWithIdentity>(
  tasks: readonly T[],
  tombstones: Map<string, QueueDeleteTombstone>,
  now?: number,
): T[];
