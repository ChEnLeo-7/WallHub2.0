'use strict';

function createMetadataEnricher(deps) {
  const {
    getFileDetails,
    cleanText,
    detectVideoTag,
    workshopTypeFromDetails,
    cachedItemMeta,
    logger,
  } = deps;

  return async function enrichMetadata(items) {
    for (const item of items) {
      const cached = cachedItemMeta.get(String(item.id));
      if (cached) Object.assign(item, cached);
    }

    const missingIds = items
      .map(item => String(item.id))
      .filter(Boolean)
      .filter(id => !cachedItemMeta.has(id));
    if (!missingIds.length) return;

    try {
      const details = await getFileDetails(missingIds);
      const detailMap = new Map();
      for (const detail of details || []) {
        if (detail && detail.publishedfileid) {
          detailMap.set(String(detail.publishedfileid), detail);
        }
      }
      for (const item of items) {
        const detail = detailMap.get(String(item.id));
        if (!detail) continue;
        const title = cleanText(detail.title);
        const fileSize = parseInt(detail.file_size, 10);
        const hydrated = {
          title: title || item.title,
          name: title || item.name,
          coverUrl: String(detail.preview_url || ''),
          total: fileSize || item.total,
          size: fileSize || item.size,
          isVideo: item.isVideo || detectVideoTag(detail),
          workshopType: workshopTypeFromDetails(detail),
        };
        hydrated.downloaded = hydrated.total;
        hydrated.canPlay = !!hydrated.isVideo;
        cachedItemMeta.set(String(item.id), hydrated);
        Object.assign(item, hydrated);
      }
    } catch (error) {
      logger.warn('[Cache] Failed to hydrate cached item metadata:', error.message);
    }
  };
}

module.exports = { createMetadataEnricher };
