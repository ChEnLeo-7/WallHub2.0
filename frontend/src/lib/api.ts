export type WorkshopItem = {
  publishedfileid: string;
  title?: string;
  preview_url?: string;
  short_description?: string;
  description?: string;
  creator?: string;
  author?: string;
  subscriptions?: string | number;
  lifetime_subscriptions?: string | number;
  favorited?: string | number;
  lifetime_favorited?: string | number;
  views?: string | number;
  file_size?: string | number;
  time_updated?: string | number;
  tags?: Array<string | { tag: string }>;
  workshopType?: string;
};

export type CommentItem = { author?: string; date?: string; timestamp?: string | number; text?: string };

export type CommentsPage = {
  comments: CommentItem[];
  start?: number;
  count?: number;
  nextStart?: number;
  total?: number;
  hasMore?: boolean;
  ownerId?: string;
};

export type Details = WorkshopItem & {
  comments?: CommentItem[];
  commentsStart?: number;
  commentsCount?: number;
  commentsNextStart?: number;
  commentsTotal?: number;
  commentsHasMore?: boolean;
  commentsOwnerId?: string;
};
export type PersonalSourceResult = {
  filter: string;
  label: string;
  names?: string[];
  steamIds?: string[];
  warningCode?: string;
};
export type QueryParams = Record<string, string | number | boolean | undefined>;

export type WorkshopQueryResult = {
  items: WorkshopItem[];
  total: number;
  totalPages: number;
  source: string;
  fallbackUsed: boolean;
  warningCode: string;
  diagnostics?: Record<string, unknown>;
};

export type RuntimeStatus = {
  revision?: string;
  platform: string;
  arch: string;
  termux: boolean;
  downloaderMode: string;
  effectiveDownloader: string;
  nsfwEnabled: boolean;
  runnerDir: string;
  downloadsDir: string;
  runtimeSetup?: {
    status?: string;
    progress?: number;
    message?: string;
    runnerDir?: string;
    downloadsDir?: string;
    requestedMode?: string;
    mode?: string;
  };
  steamCdn?: {
    currentHost?: string;
    currentVHost?: string;
    currentPort?: number;
    source?: string;
    mode?: string;
    strategy?: string;
    updatedAt?: number;
    recent?: Array<{
      host?: string;
      vhost?: string;
      port?: number;
      source?: string;
      mode?: string;
      strategy?: string;
      at?: number;
    }>;
  };
  steamAccess?: {
    enabled?: boolean;
    mode?: 'resolver' | 'hosts';
    resolverProtocol?: 'doh' | 'dot' | 'mixed' | 'hosts' | 'literal';
    resolverEndpoint?: string;
    resolverEndpoints?: string[];
    resolverHealth?: Array<{
      endpoint?: string;
      protocol?: 'doh' | 'dot';
      ok?: boolean;
      failures?: number;
      avgMs?: number;
      cooldownUntil?: number;
    }>;
    metrics?: Record<string, unknown>;
    connectionPool?: Record<string, unknown>;
    policy?: Record<string, unknown> | null;
    hosts?: {
      entries?: number;
      lastUpdatedAt?: number;
      lastError?: string;
      nextUpdateAt?: number;
    };
    dohEndpoint?: string;
    dohEndpoints?: string[];
    dotEndpoint?: string;
    dotEndpoints?: string[];
    webapiPool?: {
      host?: string;
      active?: number;
      cooling?: number;
      fastest?: string;
      rttMs?: number;
      lastRefreshAt?: number;
      nextRefreshAt?: number;
      lastError?: string;
      akamaiCidrMatched?: number;
      suspectDnsAnswers?: number;
      cdnDatabaseUpdatedAt?: number;
      cdnDatabaseSource?: string;
      direct?: boolean;
      connections?: Array<{
        host?: string;
        ip?: string;
        protocol?: string;
        sniMode?: string;
        state?: string;
        createdAt?: number;
        lastUsedAt?: number;
        requestCount?: number;
        reusedCount?: number;
        lastLocalPort?: number;
        connectionAgeMs?: number;
        lastError?: string;
        lastResetAt?: number;
        cooldownUntil?: number;
      }>;
      ech?: {
        host?: string;
        echSupported?: boolean;
        checkedAt?: number;
        error?: string;
      };
    };
    current?: {
      hostname?: string;
      port?: number;
      ip?: string;
      ips?: string[];
      source?: string;
      resolverProtocol?: 'doh' | 'dot' | 'mixed' | 'hosts' | 'literal';
      resolverEndpoint?: string;
      resolverEndpoints?: string[];
      dohEndpoint?: string;
      dohEndpoints?: string[];
      candidates?: number;
      reachable?: number;
      updatedAt?: number;
      sniMode?: string;
      sniHostname?: string;
      sniStrategies?: Array<Record<string, unknown>>;
      policy?: Record<string, unknown>;
    } | null;
    routes?: Array<{
      hostname?: string;
      port?: number;
      ip?: string;
      ips?: string[];
      source?: string;
      resolverProtocol?: 'doh' | 'dot' | 'mixed' | 'hosts' | 'literal';
      resolverEndpoint?: string;
      resolverEndpoints?: string[];
      dohEndpoint?: string;
      dohEndpoints?: string[];
      candidates?: number;
      reachable?: number;
      updatedAt?: number;
      sniMode?: string;
      sniHostname?: string;
      sniStrategies?: Array<Record<string, unknown>>;
      policy?: Record<string, unknown>;
    }>;
  };
};

export type RuntimeDiagnostics = {
  revision?: string;
  generatedAt?: number;
  runtimeSetup?: RuntimeStatus['runtimeSetup'];
  steamCdn?: RuntimeStatus['steamCdn'];
  steamAccess?: RuntimeStatus['steamAccess'];
  depotStream?: Record<string, unknown>;
};

export type QueueTask = {
  id?: string | number;
  cacheKey?: string;
  source?: 'cache' | 'queue';
  title?: string;
  name?: string;
  status?: string;
  progress?: number;
  progressIndeterminate?: boolean;
  progressStage?: string;
  progressStageMode?: 'loading' | 'progress' | string;
  livePaused?: boolean;
  downloaded?: number;
  total?: number;
  size?: number;
  speed?: number;
  coverUrl?: string;
  isVideo?: boolean;
  workshopType?: string;
  canPlay?: boolean;
  errorMsg?: string;
  errorCode?: string;
  requiresSteamLogin?: boolean;
  requiresSteamGuard?: boolean;
};

export type QueueResponse = {
  tasks: QueueTask[];
};

export type CachedItemsResponse = {
  items: QueueTask[];
};

export type MpkgPreparationResponse = {
  success?: boolean;
  id?: string;
  status?: 'preparing' | 'ready' | 'error' | string;
  elapsedMs?: number;
  fileName?: string;
  downloadUrl?: string;
  error?: string;
  code?: string;
  requiresSteamLogin?: boolean;
  requiresSteamGuard?: boolean;
};

export type SteamStatus = {
  loggedIn: boolean;
  username?: string | null;
  isPersistent?: boolean;
  pendingValidation?: boolean;
  pendingUsername?: string;
  backend?: string;
  requestedBackend?: string;
};

export type SteamAccessStaticCdnHostControl = {
  enhance: boolean;
  reuseConnection: boolean;
};

export type CacheSettings = {
  steamApiKey?: string;
  wallhubLogLevel?: 'info' | 'debug';
  mpkgTextureProfile?: 'fast' | 'compact';
  mpkgCompactAvailable?: boolean;
  mpkgCompactUnavailableReason?: string;
  useSteamApi?: boolean;
  downloadDir?: string;
  maxConcurrentDownloads?: number;
  steamCdnRouteStrategy?: 'nearest' | 'direct' | 'proxy';
  steamHttpProxyUrl?: string;
  steamKitMaxDownloads?: number;
  effectiveSteamKitMaxDownloads?: number;
  steamKitDepotStreaming?: boolean;
  workshopHtmlOrderMode?: boolean;
  wallhubSteamAccessEnhance?: boolean;
  wallhubSteamAccessDirectWebApi?: boolean;
  wallhubSteamWebApiRoute?: 'direct' | 'follow';
  wallhubSteamWebApiProtocol?: 'https' | 'http';
  wallhubSteamWebApiHost?: 'api.steampowered.com' | 'community.steam-api.com';
  wallhubSteamAccessMode?: 'resolver' | 'hosts';
  wallhubSteamAccessHosts?: string;
  wallhubSteamAccessHostsDeferred?: boolean;
  wallhubSteamAccessResolverProtocol?: 'doh' | 'dot';
  wallhubSteamAccessSelectedDohEndpoints?: string[];
  wallhubSteamAccessCustomDohEndpoints?: string[];
  wallhubSteamAccessSelectedDotEndpoints?: string[];
  wallhubSteamAccessCustomDotEndpoints?: string[];
  wallhubSteamAccessHostsUrl?: string;
  wallhubSteamAccessHostsAutoUpdateEnabled?: boolean;
  wallhubSteamAccessHostsUpdateIntervalHours?: number;
  wallhubSteamAccessHostsLastUpdatedAt?: number;
  wallhubSteamAccessHostsLastError?: string;
  wallhubSteamAccessDohEndpoint?: string;
  wallhubSteamAccessDohMode?: 'fastest' | 'fixed';
  wallhubSteamAccessDotEndpoint?: string;
  wallhubSteamAccessDotMode?: 'fastest' | 'fixed';
  wallhubSteamAccessExperimental?: {
    hiddenSniForAll?: boolean;
    fakeSniFallback?: boolean;
    compressedProxy?: boolean;
    http2Enabled?: boolean;
    disableNormalFallback?: boolean;
    verboseNetworkLogs?: boolean;
  };
  wallhubSteamAccessHostBlacklist?: string[];
  wallhubSteamAccessStaticCdnEnhance?: boolean;
  wallhubSteamAccessStaticCdnHosts?: {
    imagesSteamusercontent?: SteamAccessStaticCdnHostControl;
    sharedAkamaiSteamstatic?: SteamAccessStaticCdnHostControl;
  };
  depotStreamCacheMaxMb?: number;
  nsfwEnabled?: boolean;
};

async function parseJson<T>(res: Response): Promise<T> {
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || data.message || `HTTP ${res.status}`) as Error & {
      code?: string;
      requiresSteamLogin?: boolean;
      requiresSteamGuard?: boolean;
    };
    err.code = data.code || '';
    err.requiresSteamLogin = !!data.requiresSteamLogin;
    err.requiresSteamGuard = !!(data.requiresSteamGuard || data.needsSteamGuard);
    throw err;
  }
  return data as T;
}

export async function queryWorkshop(params: QueryParams, options: { signal?: AbortSignal } = {}): Promise<WorkshopQueryResult> {
  const res = await fetch('/api/steam/query', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ params }),
    signal: options.signal,
  });
  const data = await parseJson<{ response?: { publishedfiledetails?: WorkshopItem[]; total?: number; totalPages?: number }; totalPages?: number; source?: string; fallbackUsed?: boolean; warningCode?: string; diagnostics?: Record<string, unknown> }>(res);
  const response = data.response || {};
  const total = Number(response.total || response.publishedfiledetails?.length || 0);
  return {
    items: response.publishedfiledetails || [],
    total,
    totalPages: Number(data.totalPages || response.totalPages || (total ? Math.ceil(total / Number(params.numperpage || 30)) : 0)),
    source: data.source || '',
    fallbackUsed: !!data.fallbackUsed,
    warningCode: data.warningCode || '',
    diagnostics: data.diagnostics,
  };
}

export async function waitSteamAccessReady(options: { signal?: AbortSignal } = {}) {
  const res = await fetch('/api/steam/access/ready', { cache: 'no-store', signal: options.signal });
  return parseJson<{ enabled?: boolean; ready?: boolean; ok?: number; total?: number; timeout?: boolean }>(res);
}

export async function getDetails(id: string | number) {
  const res = await fetch(`/api/steam/details?id=${encodeURIComponent(String(id))}`);
  return parseJson<Details>(res);
}

export async function getPersonalSource(id: string | number, filter: string) {
  const qs = new URLSearchParams({ id: String(id), filter: String(filter || '') });
  const res = await fetch(`/api/steam/personal-source?${qs.toString()}`, { cache: 'no-store' });
  return parseJson<PersonalSourceResult>(res);
}

export async function getDetailsBatch(ids: Array<string | number>) {
  const res = await fetch('/api/steam/details/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  const data = await parseJson<{ items?: WorkshopItem[] }>(res);
  return data.items || [];
}

export async function getComments(id: string | number, start = 0, count = 50, ownerId = '') {
  const owner = String(ownerId || '').trim();
  const ownerQuery = owner ? `&owner=${encodeURIComponent(owner)}` : '';
  const res = await fetch(`/api/steam/comments?id=${encodeURIComponent(String(id))}&start=${encodeURIComponent(String(start))}&count=${encodeURIComponent(String(count))}${ownerQuery}`);
  return parseJson<CommentsPage>(res);
}

export async function getRuntime() {
  const res = await fetch('/api/server/runtime');
  return parseJson<RuntimeStatus>(res);
}

export async function getRuntimeDiagnostics() {
  const res = await fetch('/api/server/runtime/diagnostics', { cache: 'no-store' });
  return parseJson<RuntimeDiagnostics>(res);
}

export async function getQueue() {
  const res = await fetch('/api/queue', { cache: 'no-store' });
  return parseJson<QueueResponse>(res);
}

export async function getCachedItems() {
  const res = await fetch('/api/cache/list', { cache: 'no-store' });
  return parseJson<CachedItemsResponse>(res);
}

export async function queueAction(action: string, id?: string | number) {
  const res = await fetch('/api/queue/action', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, id }),
  });
  return parseJson<{ success: boolean }>(res);
}

export async function getSteamStatus() {
  const res = await fetch('/api/steam/status');
  return parseJson<SteamStatus>(res);
}

export async function loginSteam(payload: {
  username: string;
  password: string;
  steamGuardCode?: string;
  isRetry?: boolean;
}) {
  const res = await fetch('/api/steam/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson<{ success?: boolean; message?: string; needsSteamGuard?: boolean; username?: string }>(res);
}

export type SteamPasswordLoginSession = {
  id: string;
  status: 'starting' | 'validating' | 'waiting-phone' | 'needs-guard' | 'success' | 'error';
  username?: string;
  message?: string;
  error?: string;
  code?: string;
  needsSteamGuard?: boolean;
  requiresPhoneConfirmation?: boolean;
  updatedAt?: number;
};

export async function startSteamPasswordLogin(payload: {
  username: string;
  password: string;
  steamGuardCode?: string;
  isRetry?: boolean;
}) {
  const res = await fetch('/api/steam/login/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson<SteamPasswordLoginSession>(res);
}

export async function getSteamPasswordLoginStatus(id: string) {
  const res = await fetch(`/api/steam/login/status?id=${encodeURIComponent(id)}`, { cache: 'no-store' });
  return parseJson<SteamPasswordLoginSession>(res);
}

export type SteamQrLoginSession = {
  id: string;
  status: 'starting' | 'waiting' | 'validating' | 'success' | 'error' | 'cancelled';
  output: string;
  qrImage?: string;
  qrChallengeUrl?: string;
  username?: string;
  message?: string;
  error?: string;
  updatedAt?: number;
};

export async function startSteamQrLogin() {
  const res = await fetch('/api/steam/login/qr/start', { method: 'POST' });
  return parseJson<SteamQrLoginSession>(res);
}

export async function getSteamQrLoginStatus(id: string) {
  const res = await fetch(`/api/steam/login/qr/status?id=${encodeURIComponent(id)}`);
  return parseJson<SteamQrLoginSession>(res);
}

export async function cancelSteamQrLogin(id: string) {
  const res = await fetch('/api/steam/login/qr/cancel', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
  });
  return parseJson<{ success?: boolean }>(res);
}

export async function logoutSteam() {
  const res = await fetch('/api/steam/logout', { method: 'POST' });
  return parseJson<{ success: boolean; message?: string }>(res);
}

export async function getSettings() {
  const res = await fetch('/api/video/cache/settings');
  return parseJson<CacheSettings>(res);
}

export async function getSettingsDetails() {
  const res = await fetch('/api/video/cache/settings/details', { cache: 'no-store' });
  return parseJson<Pick<CacheSettings, 'wallhubSteamAccessHosts' | 'wallhubSteamAccessHostsDeferred'>>(res);
}

export async function saveSettings(settings: CacheSettings) {
  const res = await fetch('/api/video/cache/settings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  return parseJson<CacheSettings & { success?: boolean }>(res);
}

export async function fetchSteamAccessHosts(payload: { url: string; save?: boolean }) {
  const res = await fetch('/api/steam/access/hosts/fetch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  return parseJson<{
    success: boolean;
    hosts: string;
    validEntries?: number;
    ignoredEntries?: number;
    lastUpdatedAt?: number;
    error?: string;
  }>(res);
}

export async function clearDepotStreamCache() {
  const res = await fetch('/api/video/cache/stream/clear', { method: 'POST' });
  return parseJson<{ success: boolean; files?: number; bytes?: number; cacheDir?: string }>(res);
}

export async function restartServer() {
  const res = await fetch('/api/server/restart', { method: 'POST' });
  return parseJson<{ success: boolean; message?: string; logPath?: string }>(res);
}

export async function shutdownServer() {
  const res = await fetch('/api/server/shutdown', { method: 'POST' });
  return parseJson<{ success: boolean; message?: string }>(res);
}

function throwDownloadError(data: Record<string, unknown>, status: number) {
  const err = new Error(String(data.error || `HTTP ${status}`)) as Error & {
    code?: string;
    requiresSteamLogin?: boolean;
    requiresSteamGuard?: boolean;
  };
  err.code = String(data.code || '');
  err.requiresSteamLogin = !!data.requiresSteamLogin;
  err.requiresSteamGuard = !!(data.requiresSteamGuard || data.needsSteamGuard);
  throw err;
}

function downloadByNavigation(url: string) {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = '';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}

export function reportClientEvent(payload: Record<string, unknown>) {
  const body = JSON.stringify(Object.assign({ at: Date.now() }, payload));
  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([body], { type: 'application/json' });
      if (navigator.sendBeacon('/api/client/event', blob)) return;
    }
  } catch {}
  fetch('/api/client/event', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

export async function clientDownload(id: string | number, title: string) {
  const url = `/api/download?id=${encodeURIComponent(String(id))}&title=${encodeURIComponent(title)}`;
  const probe = await fetch(`${url}&probe=1`, { cache: 'no-store' });
  const data = await probe.json().catch(() => ({})) as { downloadUrl?: string } & Record<string, unknown>;
  if (!probe.ok) throwDownloadError(data, probe.status);
  downloadByNavigation(data.downloadUrl || url);
  return { streamed: true };
}

export async function mpkgDownload(
  id: string | number,
  title: string,
  options: { textureProfile?: 'fast' | 'compact'; onPreparing?: (preparation: MpkgPreparationResponse) => void } = {},
) {
  const profile = options.textureProfile === 'compact' ? 'compact' : 'fast';
  const params = new URLSearchParams({ id: String(id), title: String(title || ''), profile });
  const directUrl = `/api/mpkg/download?${params.toString()}`;
  const startedAt = Date.now();
  const notifyPreparing = (value: MpkgPreparationResponse) => {
    if (String(value.status || '') !== 'preparing' || !options.onPreparing) return;
    const elapsedMs = Number(value.elapsedMs);
    try {
      options.onPreparing({
        ...value,
        elapsedMs: Number.isFinite(elapsedMs) && elapsedMs >= 0 ? elapsedMs : Date.now() - startedAt,
      });
    } catch {}
  };
  const startRes = await fetch(`/api/mpkg/prepare?${params.toString()}`, { cache: 'no-store' });
  let preparation = await parseJson<MpkgPreparationResponse>(startRes);
  notifyPreparing(preparation);
  const deadline = Date.now() + 50 * 60 * 1000;
  let nextPollDelayMs = 0;

  while (preparation.status === 'preparing') {
    if (Date.now() >= deadline) {
      throw new Error('等待 MPKG 转换准备超时，请稍后重试');
    }
    if (nextPollDelayMs > 0) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, nextPollDelayMs));
    }
    const statusRes = await fetch(`/api/mpkg/prepare/status?${params.toString()}`, { cache: 'no-store' });
    preparation = await parseJson<MpkgPreparationResponse>(statusRes);
    notifyPreparing(preparation);
    nextPollDelayMs = 1000;
  }

  if (preparation.status !== 'ready') {
    const error = new Error(preparation.error || 'MPKG 准备失败') as Error & { code?: string };
    error.code = preparation.code || '';
    throw error;
  }
  downloadByNavigation(preparation.downloadUrl || directUrl);
  return { streamed: true };
}

export async function backgroundDownload(id: string | number, title: string) {
  const res = await fetch(`/api/download/background?id=${encodeURIComponent(String(id))}&title=${encodeURIComponent(title)}`);
  return parseJson<{ success?: boolean; message?: string }>(res);
}

export async function playVideo(id: string | number, title: string, signal?: AbortSignal) {
  const res = await fetch(`/api/video/play?id=${encodeURIComponent(String(id))}&title=${encodeURIComponent(title)}`, { signal });
  return parseJson<{ success: boolean; status: 'ready' | 'queued'; streamUrl?: string; cdnHost?: string }>(res);
}

export function releaseDepotVideoStream(streamUrl?: string) {
  const value = String(streamUrl || '').trim();
  if (!value || !value.includes('/api/video/depot')) return;
  let token = '';
  try {
    token = new URL(value, window.location.href).searchParams.get('token') || '';
  } catch {}
  if (!token) return;
  fetch(`/api/video/depot/release?token=${encodeURIComponent(token)}`, {
    method: 'POST',
    keepalive: true,
  }).catch(() => {});
}
