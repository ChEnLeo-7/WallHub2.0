export type ApiError = Error & {
  code?: string;
  requiresSteamLogin?: boolean;
  requiresSteamGuard?: boolean;
};

export type ApiErrorPayload = {
  error?: string;
  message?: string;
  code?: string;
  requiresSteamLogin?: boolean;
  requiresSteamGuard?: boolean;
  needsSteamGuard?: boolean;
};

export function createApiError(data: ApiErrorPayload, status: number): ApiError {
  const error = new Error(data.error || data.message || `HTTP ${status}`) as ApiError;
  error.code = data.code || '';
  error.requiresSteamLogin = !!data.requiresSteamLogin;
  error.requiresSteamGuard = !!(data.requiresSteamGuard || data.needsSteamGuard);
  return error;
}

export function createDownloadError(data: Record<string, unknown>, status: number): ApiError {
  const error = new Error(String(data.error || `HTTP ${status}`)) as ApiError;
  error.code = String(data.code || '');
  error.requiresSteamLogin = !!data.requiresSteamLogin;
  error.requiresSteamGuard = !!(data.requiresSteamGuard || data.needsSteamGuard);
  return error;
}
