import { describe, expect, test } from 'vitest';

import { parseJson } from './request';

function response(ok: boolean, status: number, json: () => Promise<unknown>): Response {
  return { ok, status, json } as Response;
}

describe('parseJson', () => {
  test('returns a successful JSON response', async () => {
    const data = await parseJson<{ value: string }>(response(true, 200, async () => ({ value: 'ok' })));
    expect(data).toEqual({ value: 'ok' });
  });

  test('preserves the empty-object fallback for invalid JSON', async () => {
    const data = await parseJson<Record<string, unknown>>(response(true, 204, async () => {
      throw new SyntaxError('Unexpected end of JSON input');
    }));
    expect(data).toEqual({});
  });

  test('creates an API error with Steam login metadata', async () => {
    const result = parseJson(response(false, 401, async () => ({
      message: 'Sign in required',
      code: 'STEAM_LOGIN_REQUIRED',
      requiresSteamLogin: true,
      needsSteamGuard: true,
    })));

    await expect(result).rejects.toMatchObject({
      message: 'Sign in required',
      code: 'STEAM_LOGIN_REQUIRED',
      requiresSteamLogin: true,
      requiresSteamGuard: true,
    });
  });

  test('falls back to the HTTP status for an empty error response', async () => {
    await expect(parseJson(response(false, 503, async () => {
      throw new SyntaxError('Invalid JSON');
    }))).rejects.toThrow('HTTP 503');
  });
});
