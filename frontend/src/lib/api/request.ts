import { createApiError, type ApiErrorPayload } from './errors';

export async function parseJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => ({})) as T & ApiErrorPayload;
  if (!response.ok) throw createApiError(data, response.status);
  return data as T;
}
