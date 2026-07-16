const MAX_DETAIL_TAGS = 12;

export function normalizeDetailTags(values) {
  const result = [];
  const seen = new Set();
  for (const value of Array.isArray(values) ? values : []) {
    const tag = String(value ?? '').replace(/\s+/g, ' ').trim();
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) continue;
    seen.add(key);
    result.push(tag);
    if (result.length >= MAX_DETAIL_TAGS) break;
  }
  return result;
}

export function encodeDetailTagSearch(tags) {
  const normalized = normalizeDetailTags(tags);
  return normalized.length ? `tag:${normalized.join('|')}` : '';
}

export function parseDetailTagSearch(value) {
  const match = String(value ?? '').trim().match(/^tag:\s*(.+)$/i);
  return match ? normalizeDetailTags(match[1].split('|')) : [];
}
