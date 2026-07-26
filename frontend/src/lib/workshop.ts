import { formatLocalizedCommentTime } from './dateDisplay.mjs';

export function itemType(item: { workshopType?: string; tags?: Array<string | { tag: string }> }) {
  const explicit = String(item.workshopType || '').trim();
  if (['Video', 'Web', 'Application', 'Scene'].includes(explicit)) return explicit;
  const tags = (item.tags || []).map((tag) => String(typeof tag === 'string' ? tag : tag.tag).toLowerCase());
  if (tags.includes('video')) return 'Video';
  if (tags.includes('web')) return 'Web';
  if (tags.includes('application')) return 'Application';
  return 'Scene';
}

export function localizedItemType(type: string, text: { video: string; web: string; application: string; scene: string }) {
  if (type === 'Video') return text.video;
  if (type === 'Web') return text.web;
  if (type === 'Application') return text.application;
  return text.scene;
}

const WORKSHOP_TAG_ZH: Record<string, string> = {
  Approved: '广受好评',
  'Audio responsive': '音频响应',
  Customizable: '可自定义',
  'Puppet Warp': '木偶变形',
  'Media Integration': '媒体集成',
  'User Shortcut': '用户快捷键',
  'Video Texture': '视频纹理',
  'Asset Pack': '资源包',
  Standard: '标准分辨率',
  Ultrawide: '超宽屏',
  'Dual monitor': '双显示器',
  'Triple monitor': '三显示器',
  Portrait: '竖屏',
  'Other resolution': '其他分辨率',
  'Dynamic resolution': '动态分辨率',
  Mobile: '移动端',
};

export function localizedWorkshopTag(
  value: string,
  language: 'zh' | 'en',
  text: {
    genres: Record<string, string> | object;
    scene: string;
    video: string;
    web: string;
    application: string;
    ratingEveryone: string;
    ratingQuestionable: string;
    ratingMature: string;
  },
) {
  const tag = String(value || '').trim();
  if (language !== 'zh' || !tag) return tag;
  const genre = (text.genres as Record<string, string>)[tag];
  if (genre) return genre;
  if (tag === 'Scene') return text.scene;
  if (tag === 'Video') return text.video;
  if (tag === 'Web') return text.web;
  if (tag === 'Application') return text.application;
  if (tag === 'Everyone') return text.ratingEveryone;
  if (tag === 'Questionable') return text.ratingQuestionable;
  if (tag === 'Mature') return text.ratingMature;
  return WORKSHOP_TAG_ZH[tag] || tag;
}

export function steamProxyUrl(url: string) {
  try {
    const target = new URL(url);
    const host = target.hostname.toLowerCase();
    const isStore = host === 'store.steampowered.com' || host.endsWith('.store.steampowered.com');
    if (isStore && /^\/app\/\d+(?:\/[^/?#]+)?\/?$/i.test(target.pathname)) {
      target.searchParams.set('__whp_host', target.hostname);
      return `${target.pathname}${target.search}${target.hash}`;
    }
  } catch {
    // Fall through to the generic proxy entry.
  }
  return `/url/proxy/?url=${encodeURIComponent(url)}`;
}

export function steamProxyDisplayUrl(url: string) {
  if (typeof window === 'undefined') return steamProxyUrl(url);
  return `${window.location.origin}${steamProxyUrl(url)}`;
}

export function formatCommentTime(
  comment: { timestamp?: string | number; date?: string },
  now = new Date(),
) {
  return formatLocalizedCommentTime(comment, now);
}

export function isSteamLoginError(error: unknown) {
  const e = error as { code?: string; requiresSteamLogin?: boolean; requiresSteamGuard?: boolean; message?: string };
  return (
    !!e?.requiresSteamLogin ||
    !!e?.requiresSteamGuard ||
    e?.code === 'STEAM_LOGIN_REQUIRED' ||
    e?.code === 'STEAM_GUARD_REQUIRED' ||
    /需要登录拥有 Wallpaper Engine|Steam Guard|STEAM_LOGIN_REQUIRED|STEAM_GUARD_REQUIRED/i.test(String(e?.message || ''))
  );
}

export function samePayload(a: unknown, b: unknown) {
  return JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
}

export function queueTaskSignature(task: {
  source?: string;
  id?: string | number;
  cacheKey?: string;
  title?: string;
  name?: string;
  status?: string;
  progress?: number;
  progressIndeterminate?: boolean;
  progressStage?: string;
  downloaded?: number;
  total?: number;
  size?: number;
  speed?: number;
  errorMsg?: string;
  errorCode?: string;
  requiresSteamLogin?: boolean;
  requiresSteamGuard?: boolean;
  coverUrl?: string;
  isVideo?: boolean;
  canPlay?: boolean;
}) {
  const id = String(task.id || task.cacheKey || '');
  const progress = Math.round(Number(task.progress || 0) * 10) / 10;
  const speed = Math.round(Number(task.speed || 0));
  return [
    task.source || '',
    id,
    task.title || '',
    task.name || '',
    task.status || '',
    progress,
    task.progressIndeterminate ? 1 : 0,
    task.progressStage || '',
    Math.floor(Number(task.downloaded || 0)),
    Math.floor(Number(task.total || task.size || 0)),
    speed,
    task.errorMsg || '',
    task.errorCode || '',
    task.requiresSteamLogin ? 1 : 0,
    task.requiresSteamGuard ? 1 : 0,
    task.coverUrl || '',
    task.isVideo ? 1 : 0,
    task.canPlay ? 1 : 0,
  ].join('');
}

export function queueSignature(tasks: Array<{
  source?: string;
  id?: string | number;
  cacheKey?: string;
  title?: string;
  name?: string;
  status?: string;
  progress?: number;
  progressIndeterminate?: boolean;
  progressStage?: string;
  downloaded?: number;
  total?: number;
  size?: number;
  speed?: number;
  errorMsg?: string;
  errorCode?: string;
  requiresSteamLogin?: boolean;
  requiresSteamGuard?: boolean;
  coverUrl?: string;
  isVideo?: boolean;
  canPlay?: boolean;
}>) {
  return tasks.map(queueTaskSignature).join('');
}

export function getGridColumns(width: number, mobileColumns = 2, desktopColumns = 0) {
  if (!width || width < 1) return 4;
  if (width < 640) return Math.max(1, Math.min(4, Number.parseInt(String(mobileColumns || '2'), 10) || 2));
  const fixedDesktopColumns = (() => {
    const n = Number.parseInt(String(desktopColumns || '0'), 10);
    if (!n) return 0;
    return Math.max(2, Math.min(8, n));
  })();
  if (fixedDesktopColumns) return fixedDesktopColumns;
  const gap = 16;
  const minCardWidth = 210;
  return Math.max(1, Math.floor((width + gap) / (minCardWidth + gap)));
}

export function isRuntimeSetupActive(status?: string) {
  return ['checking', 'installing', 'validating-login'].includes(String(status || ''));
}

export function compactDohEndpoint(endpoint?: string) {
  const raw = String(endpoint || '').trim();
  if (!raw) return '';
  try {
    const u = new URL(raw);
    return `${u.hostname}${u.pathname || ''}`.replace(/\/$/, '');
  } catch {
    return raw.replace(/^https?:\/\//i, '').replace(/\/$/, '');
  }
}
