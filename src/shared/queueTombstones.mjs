function queueTaskId(task) {
  return String(task?.id || task?.cacheKey || '');
}

export function pruneQueueDeleteTombstones(tombstones, now = Date.now()) {
  for (const [taskId, tombstone] of tombstones) {
    if (!tombstone || tombstone.expiresAt <= now) tombstones.delete(taskId);
  }
  return tombstones;
}

export function filterQueueTasksAfterDelete(tasks, tombstones, now = Date.now()) {
  pruneQueueDeleteTombstones(tombstones, now);
  return tasks.filter((task) => {
    const taskId = queueTaskId(task);
    const tombstone = taskId ? tombstones.get(taskId) : null;
    if (!tombstone) return true;
    const addTime = Number(task?.addTime);
    return Number.isFinite(addTime) && addTime >= tombstone.deletedAt;
  });
}
